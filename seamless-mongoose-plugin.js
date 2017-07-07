module.exports = exports = function SeamlessMongoosePlugin(schema){
  var buffer = Buffer();

  // data buffer abstraction - to move it under redis and make plugin stateless
  // and work in multithreaded envs
  function Buffer(){
    var databuf = {}, // buffer with stringified responses - per reqid
      queries = {}, // buffer with queries - per reqid
      clients = {}, // buffer with clients subscribed for a changes - per reqid
      requests = {}, // buffer with reqids - per document
      timestamp = {}; // buffer with timestamps of requests - per reqid

    var BUFFER_TTL = 40000;

    // buffer maintenance
    var _garbageCollector = setInterval(function() {
      var i, c = 0;
      for (i in timestamp) {
        if (((Date.now() - timestamp[i]) > BUFFER_TTL) &&
              !clients[i].length) {
          delete databuf[i];
          delete queries[i];
          delete clients[i];
          delete timestamp[i];
          // TODO: need to clear requests
        }
        else c++;
      }
      BUFFER_TTL = (-3 * c) + 40000;
    }, BUFFER_TTL);

    return {
      get(id,key){
        switch (key){
          case "data":
            return id?databuf[id]:databuf;
          case "query":
            return id?queries[id]:queries;
          case "clients":
            return id?clients[id]:clients;
          case "requests":
            return id?requests[id]:requests;
          case "timestamp":
            return id?timestamp[id]:timestamp;
          default:
            return (BUFFER_TTL-21000)/(-3); // count of unique requests
        }
      },
      set(id,key,v){
        switch (key){
          case "data":
            return v?databuf[id]=v:delete databuf[id];
          case "query":
            return v?queries[id]=v:delete queries[id];
          case "clients":
            return v?clients[id]=v:delete clients[id];
          case "requests":
            return v?requests[id]=v:delete requests[id];
          case "timestamp":
            return v?timestamp[id]=v:delete timestamp[id];
        }
      }
    }
  }

  function _resAdapter(data){
    data = (data instanceof Array)?data:[data];
    return data.filter(function(d){return !!(d._id || d._doc)})
      .map(function(d){ return d._doc || d });
  }

  function strfy(docs){
    return JSON.stringify((docs.length == 1)?docs[0]:docs);
  }

  function mapall(A,B){
    return (A||[]).reduce(function(C,a){
      return (B[a]||[]).reduce(function(c,b){
        return (c.indexOf(b)==-1)?(c.concat(b)):c;
      },C);
    },[]);
  }

  function RespondTo(responses,reqid){
    if (responses.send) responses = [responses];
    return function(docs){
      var data;
      if (typeof docs === "string"){
        data = docs;
      }
      else {
        docs = _resAdapter(docs);
        data = buffer.set(reqid,"data",strfy(docs));
      }
      responses.forEach(function(r){
        r.send(data);
      });
      docs.forEach(function(doc){
        var r = buffer.get(doc._id,"requests") || [];
        if (r.indexOf(reqid) == -1) {
          r.push(reqid);
          buffer.set(doc._id,"requests",r);
        }
      });
      responses.forEach(function(r){
        if (!r.isWebsocket) SeamlessMongoosePlugin.deregisterClient(reqid,r);
      });
      return docs;
    };
  }

  function HandleErrTo(response,reqid) {
    return function(err){
      SeamlessMongoosePlugin.deregisterClient(reqid,response);
      if (response.status) {
        response.status(500).send('Error querying: ' + err.toString());
      }
      else response.close(500, 'Error querying: ' + err.toString());
      return console.error(err);
    };
  }

  SeamlessMongoosePlugin.registerClient = function(rid, peer) {
    var c = buffer.get(rid,"clients") || [];
    c.push(peer);
    buffer.set(rid,"clients",c);
    return peer;
  };

  SeamlessMongoosePlugin.deregisterClient = function(rid, response) {
    var c;
    if (c = buffer.get(rid,"clients")) {
      var i;
      while((i=c.indexOf(response))!=-1){
        c.splice(i,1);
      }
      buffer.set(rid,"clients",c);
    }
    return response;
  };

  schema.statics.notifyRegisteredClients = function(changed_docs_ids){
    var model = this;
    var changedreqs = mapall(changed_docs_ids,buffer.get(undefined,"requests"));
    var results = [];
    if (changedreqs.length) { 
      results = changedreqs.map(function (rid){
        var q;
        if (q=buffer.get(rid,"query")){
          return model.find(q).exec()
            .then(RespondTo(buffer.get(rid,"clients"),rid))
            .catch(console.error);
        }
      })
    }
    else {
      var qs = buffer.get(undefined,"query");
      var rid;
      for (rid in qs){
        results.push(
          model.find(qs[rid]).exec()
          .then(RespondTo(buffer.get(rid,"clients"),rid))
          .catch(console.error)
        )
      }
    }
    return Promise.all(results);
  }; // returns an array of promises

  schema.statics.getData = function(reqid,query){
    var b;
    if (b=buffer.get(reqid,"data")) return Promise.resolve(b);
    else {
      return this.find(query).exec();
    }
  } // return promise of data

  schema.statics.postData = function(reqid,query,body){
    body = (body instanceof Array)?body:[body];
    var Model = this;
    return this.bulkWrite(body.map(function(e) {
      if (e._id) {
        return {
          updateOne: {
            filter: {
              _id: e._id
            },
            update: e
          }
        };
      }
    })).then(function(bwres) {
      return Model.find()
        .where(query)
        .nin('_id',body.map(function(e) {
          if (e._id) {
            return e._id.toString();
          }
        }))
        .remove();
    })
    .then(function(wopres){
      return Model.find(query);
    });
  } // return promise of changed data

  SeamlessMongoosePlugin.SeamlessHTTPEndpointFor = function (Model){
    return function(req,res,next){
      var reqid = req.baseUrl+req.path;
      var query = buffer.set(reqid,"query",req.params);
      switch (req.method){
        case "GET":
          res.timestamp = buffer.set(reqid,"timestamp",Date.now());
          res.type('json');
          res.isWebsocket = false;
          if (req.query.nopoll) {
            return Model.getData(reqid,query)
              .then(RespondTo(res,reqid))
              .catch(HandleErrTo(res,reqid));
          }
          else {
            res.status(200);
            SeamlessMongoosePlugin.registerClient(reqid,res);
            return new Promise(function(resolve,reject){
              setTimeout(function(){
                if (!res.finished){
                  resolve(SeamlessMongoosePlugin.deregisterClient(reqid,res).end());
                }
                else {
                  resolve();
                }
              },29000);
            }).catch(console.error);
          }
          break;
        case "POST":
          res.timestamp = buffer.set(reqid,"timestamp",Date.now());
          res.type('json');
          res.isWebsocket = false;
          SeamlessMongoosePlugin.registerClient(reqid,res);
          return Model.postData(reqid,query,req.body)
            .then(function(docs){
              return Model.notifyRegisteredClients(
                docs.map(function(d){
                  return d._id+"";
                })
              );
            })
            .catch(HandleErrTo(res,reqid));
          break;
        default:
          return next();
      }
    };
  };

  SeamlessMongoosePlugin.SeamlessWSEndpointFor = function(Model){
    return function(ws,req){
      var reqid = req.baseUrl+req.path;
      var query = buffer.set(reqid,"query",req.params);
      ws.timestamp = buffer.set(reqid,"timestamp",Date.now());
      ws.isWebsocket = true;
      SeamlessMongoosePlugin.registerClient(reqid,ws);
      ws.on('message',function(message,flags){
        if (!flags.binary){
          Model.postData(reqid,query,JSON.parse(message))
          .then(function(docs){
            return Model.notifyRegisteredClients(
              docs.map(function(d){
                return d._id+"";
              })
            );
          })
          .catch(HandleErrTo(ws,reqid));
        }
      });
      ws.on('close',function(code,reason){
        SeamlessMongoosePlugin.deregisterClient(reqid,ws);
      });
      ws.on('error',function(error){
        console.error(error);
        ws.close(500,error);
      });
      Model.getData(reqid,query)
      .then(RespondTo(ws,reqid))
      .catch(HandleErrTo(ws,reqid));
    };
  };

  // document middleware
  function _DM_(docs){
    docs = _resAdapter(docs).map(function(d){return d._id.toString()});
    var model;
    if (this.model.notifyRegisteredClients){
      model = this.model;
    }
    else if (this.constructor.notifyRegisteredClients) {
      model = this.constructor;
    }
    else if (this.notifyRegisteredClients) {
      model = this;
    }
    else return;
    model.notifyRegisteredClients(docs)
    .catch(console.error);
  }

  // query middleware
  function _QM_(result){
    var Model = this.model;
    this.find()
    .then(function(docs){
      docs = _resAdapter(docs).map(function(d){return d._id.toString()});
      Model.notifyRegisteredClients(docs)
      .catch(console.error);
    });
  }

  ['save','remove','insertMany','findOneAndRemove']
  .forEach(function(hook){
    schema.post(hook,_DM_);
  });

  ['findOneAndUpdate','update']
  .forEach(function(hook){
    schema.post(hook,_QM_);
  });
}
