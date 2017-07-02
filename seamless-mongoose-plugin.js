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

    var BUFFER_TTL = 21000;

    // buffer maintenance
    var _garbageCollector = setInterval(function() {
      var i, c = 0;
      for (i in timestamp) {
        if ((Date.now() - timestamp[i]) > BUFFER_TTL) {
          delete databuf[i];
          delete queries[i];
          delete clients[i];
          delete timestamp[i];
          // TODO: need to clear requests
        }
        else c++;
      }
      BUFFER_TTL = (-3 * c) + 21000;
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
    console.log(responses);
    return function(docs){
      var data;
      if (typeof docs === "string"){
        data = docs;
      }
      else {
        docs = _resAdapter(docs);
        data = buffer.set(reqid,"data",strfy(docs));
      }
      responses.forEach(function(res){
        if (res.type) res.type('application/json');
        res.send(data);
        if (!res.isWebsocket)
          SeamlessMongoosePlugin.deregisterClient(reqid,res);
      });
      if (docs instanceof Array) {
        docs.forEach(function(doc){
          var r = buffer.get(doc._id,"requests");
          if (r && r.indexOf && (r.indexOf(reqid) == -1)) {
            buffer.set(doc._id,"requests",r.push(reqid));
          }
        });
      }
    };
  }

  function HandleErrTo(response,reqid) {
    return function(err){
      SeamlessMongoosePlugin.deregisterClient(reqid,response);
      if (response.status) {
        response.status(500).send('Error querying: ' + err.toString());
      }
      else response.close(500, 'Error querying: ' + err.toString());
      console.error(err);
      return;
    };
  }

  SeamlessMongoosePlugin.registerClient = function(id, peer) {
    var c = buffer.get(id,"clients");
    if (c instanceof Array) {
      if (c.indexOf(peer) == -1) {
        c = c.concat(peer);
        buffer.set(id,"clients",c);
        return true;
      }
      return false;
    }
    else {
      c = [peer];
      console.log("add: "+buffer.set(id,"clients",c));
      return true;
    }
  };

  SeamlessMongoosePlugin.deregisterClient = function(id, peer) {
    var c = buffer.get(id,"clients");
    if (c && c.length) {
      var pos = c.indexOf(peer);
      if (pos >= 0) {
        c.splice(pos, 1);
        if (!c.length) {
          c=null;
        }
        console.log("remove: "+buffer.set(id,"clients",c));
        return true;
      }
    }
    return false;
  };

  schema.statics.notifyRegisteredClients = function(changed_docs_ids){
    var Model = this;
    console.log("changed",Date.now());
    return Promise.all(mapall(changed_docs_ids,buffer.get(undefined,"requests"))
    .map(function(reqid){ // get requests objects
      var q;
      console.log(reqid);
      if (q=buffer.get(reqid,"queries")){
        console.log(q);
        return Model.find(q)
          .then(RespondTo(buffer.get(reqid,"clients"),reqid));
      }
    }));
  }; // returns an array of promises

  schema.statics.getData = function(reqid,query){
    var b;
    if (b=buffer.get(reqid,"data")) return new Promise.resolve(b);
    else {
      return this.find(query);
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
      return Model.find(query)
        .where('_id')
        .nin(body.map(function(e) {
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
      res.isWebsocket = false;
      console.log(reqid,buffer.set(reqid,"timestamp",Date.now()));
      switch (req.method){
        case "GET":
          return (
            (req.query.nopoll)?
            (Model.getData(reqid,query)
              .then(RespondTo(res,reqid))
              .catch(HandleErrTo(res,reqid))):
            (
              res.writeHead(200),
              SeamlessMongoosePlugin.registerClient(reqid,res),
              setTimeout(function(){
                if (SeamlessMongoosePlugin.deregisterClient(reqid,res)){
                  res.end();
                };
              },29000)
            )
          );
        case "POST":
          SeamlessMongoosePlugin.registerClient(reqid,res);
          return Model.postData(reqid,query,req.body)
          .then(RespondTo(buffer.get(reqid,"clients"),reqid))
          .catch(HandleErrTo(res,reqid));
        default:
          return next();
      }
    };
  };

  SeamlessMongoosePlugin.SeamlessWSEndpointFor = function(Model){
    return function(ws,req){
      var reqid = req.baseUrl+req.path;
      var query = buffer.set(reqid,"querie",req.params);
      buffer.set(reqid,"timestamp",Date.now());
      SeamlessMongoosePlugin.registerClient(reqid,ws);
      ws.on('message',function(message,flags){
        if (!flags.binary){
          Model.postData(reqid,query,JSON.parse(message))
          .then(RespondTo(ws,reqid))
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
    var notify = (this.notifyRegisteredClients||
                  this.constructor.notifyRegisteredClients||
                  this.model.notifyRegisteredClients);
    notify(docs)
    .catch(function(reason){
      console.error(reason);
    });
  }

  // query middleware
  function _QM_(result){
    var Model = this.model;
    this.find().then(function(docs){
      docs = _resAdapter(docs).map(function(d){return d._id.toString()});
      Model.notifyRegisteredClients(docs)
      .catch(function(reason){
        console.error(reason);
      });
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
