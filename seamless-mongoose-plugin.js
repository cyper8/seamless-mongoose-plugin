const murmur = require("murmurhash-js").murmur2;
const uuid = require("./uuid.js");
const Cache = require("./cache.js");

module.exports = exports = function SeamlessMongoosePlugin(schema){
  
  var buffer = Cache();
  var clients = {};
  
  function _hash(q){
    if (typeof q === "object") {
      try {
        q = JSON.stringify(q);
      }
      catch (err) {
        throw err;
      }
    }
    if (typeof q === "string") return murmur(q||"");
    else throw new TypeError("argument is not convertible to string");
  }
  
  function wrapA(value){
    if (Array.isArray(value)){
      return value;
    }
    else {
      return [value];
    }
  }
  
  function unwrapFirstFromA(arr){
    if (Array.isArray(arr) || (arr[0] != undefined)){
      return arr[0];
    }
    else {
      return arr;
    }
  }

  function getDocsFrom(data){
    return wrapA(data).filter(function(d){return !!(d._id || d._doc)})
      .map(function(d){ return d._doc || d });
  }

  function CacheData(reqid){
    return function (docs){
      try {
        buffer.set(reqid,"data",JSON.stringify(docs));
      }
      catch(error){
        console.error(error);
      }
      finally{
        return docs
      }
    }
  }
  
  function CacheReqsByDocs(reqid){
    return function(docs){
      Promise.all(
        docs
        .map(function(d){return d._id.toString()})
        .map(function(did){
          return buffer.get(did,"requests")
            .then(function(r){
              if (r.indexOf(reqid) == -1) {
                r.push(reqid);
                return buffer.set(did,"requests",r);
              }
            });
        })
      );
      return docs;
    }
  }
  
  function CacheQuery(reqid,query){
    if (typeof query === "object") query = JSON.stringify(query);
    return buffer.set(reqid,"query",query);
  }
  
  function RespondTo(responses,reqid){
    responses = wrapA(responses);
    return function(docs){
      responses.forEach(function(r){
        r.type('json');
        r.send(docs);
        if (!r.isWebsocket){
          deregisterClient(reqid,r.id);
        }
      });
      return docs;
    };
  }

  function HandleErrTo(responses,reqid) {
    responses = wrapA(responses)
    return function(err){
      responses.forEach(function(r){
        if (r.status) {
          r.status(500).send('Error querying: ' + err.toString());
        }
        else r.close(500, 'Error querying: ' + err.toString());
        deregisterClient(reqid,r);
      });
    };
  }
  
  // document middleware
  function _DM_(docs){
    var docids = getDocsFrom(docs).map(function(d){return d._id.toString()});
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
    model.notifyRegisteredClients(docids)
    .catch(console.error);
  }

  // query middleware
  function _QM_(result){
    var Model = this.model;
    this.find().exec()
    .then(getDocsFrom)
    .then(function(docs){
      Model.notifyRegisteredClients(docs.map(function(d){return d._id.toString()}))
      .catch(console.error);
    });
  }

  function registerClient(rid, peer) {
    if (!clients[rid]) clients[rid] = {};
    var id = peer.id = uuid();
    clients[rid][id] = peer;
    return id;
  };

  function deregisterClient(rid, peerid) {
    if (clients[rid]){
      if (clients[rid][peerid]){
        delete clients[rid[peerid]];
      }
    }
  };

  schema.statics.registerClient = registerClient;
  
  schema.statics.deregisterClient = deregisterClient;

  schema.statics.notifyRegisteredClients = function(changed_docs_ids){
    var model = this;
    console.log(changed_docs_ids);
    return Promise.all(wrapA(changed_docs_ids).map(function(did){
      return buffer.get(did,"requests")
    }))
    .then(function(reqids){
      console.log(reqids);
      reqids = [].concat.apply([],reqids) // flatten 2 layer deep array of change-affected reqids to 1 layer 
        .filter(function(e,i,a){return a.indexOf(e) === i}); // and filter unique
      return Promise.all(reqids.map(function (rid){
        return buffer.get(rid,"query") //get a query string for each reqid
          .then(function(q){
            if (q) { // if there is a query cached for this reqid - perform it and
              return model.find(q).exec()
                .then(getDocsFrom)
                .then(RespondTo(clients[rid],rid),HandleErrTo(clients[rid],rid)) // respond to all registered clients of this reqid
                .then(CacheData(rid)) // Cache responses
                .then(CacheReqsByDocs(rid))
                .catch(console.error);
            }
          })
          .catch(console.error);
      }));
    })
    .catch(console.error);
  };

  schema.statics.getData = function(rid,query,response){
    var Model = this;
    return buffer.get(rid,"data")
      .then(function(data){
        return JSON.parse(data);
      })
      .then(RespondTo(response,rid))
      .catch(function(){
        return Model.find(query).exec()
          .then(getDocsFrom)
          .then(RespondTo(response,rid),HandleErrTo(response, rid))
          .then(CacheData(rid))
          .then(CacheReqsByDocs(rid))
          .then(function(){
            CacheQuery(rid,query);
          })
          .catch(console.error);
      });
  }
  
  schema.statics.pollData = function(rid,query,response){
    response.status(200);
    return CacheQuery(rid,query)
    .then(function(){
      var id = registerClient(rid,response);
      return new Promise(function(resolve,reject){
        setTimeout(function(){
          if (!response.finished){
            response.end();
          }
          deregisterClient(rid,id);
          resolve();
        },29000);
      }).catch(console.error);
    })
  }

  schema.statics.postData = function(reqid,query,body,response){
    body = wrapA(body);
    var docids;
    var Model = this;
    if (response) Model.registerClient(reqid,response);
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
      else {
        return {
          insertOne: {
            document: e
          }
        }
      }
    }))
    .then(function(bwres) {
      docids = body.map(function(e){return e._id}).concat(Object.values(bwres.insertedIds));
      return Model.find(query)
        .where('_id')
        .nin(docids)
        .remove()
        .exec()
        .then(function(){
          Model.notifyRegisteredClients(docids);
        });
    })
    .catch(console.error);
  }

  // HTTP endpoint middleware factory
  SeamlessMongoosePlugin.SeamlessHTTPEndpointFor = function (Model){
    return function(req,res,next){
      var reqid = _hash(req.baseUrl+req.path);
      var query = req.params;
      res.isWebsocket = false;
      switch (req.method){
        case "GET":
          if (req.query.nopoll) {
            return Model.getData(reqid,query,res);
          }
          else {
            return Model.pollData(reqid,query,res);
          }
        case "POST":
          return Model.postData(reqid,query,req.body,res);
        default:
          return next();
      }
    };
  };

  // Web Socket endpoint middleware factory
  SeamlessMongoosePlugin.SeamlessWSEndpointFor = function(Model){
    return function(ws,req){
      var reqid = _hash(req.baseUrl+req.path);
      var query = req.params;
      ws.isWebsocket = true;
      var wsid = Model.registerClient(reqid,ws);
      ws.on('message',function(message,flags){
        if (!flags.binary){
          Model.postData(reqid,query,JSON.parse(message));
        }
      });
      ws.on('close',function(code,reason){
        Model.deregisterClient(reqid,wsid);
      });
      ws.on('error',function(error){
        console.error(error);
        ws.close(500,error);
      });
      Model.getData(reqid,query,ws);
    };
  };


  // setting hooks
  
  ['save','remove','insertMany','findOneAndRemove']
  .forEach(function(hook){
    schema.post(hook,_DM_);
  });

  ['findOneAndUpdate','update']
  .forEach(function(hook){
    schema.post(hook,_QM_);
  });
}
