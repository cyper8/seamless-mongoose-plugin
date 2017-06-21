module.exports = exports = function SeamlessMongoosePlugin(schema){
  var databuf = {},
    queries = {},
    clients = {},
    requests = {},
    timestamp = {};
  
  var BUFFER_TTL = 21000;

  // buffer maintenance 
  SeamlessMongoosePlugin._garbageCollector = setInterval(function() {
    console.log("GC: " + BUFFER_TTL);
    var i, c = 0;
    for (i in timestamp) {
      if ((Date.now() - timestamp[i]) > BUFFER_TTL) {
        console.log(">>> Clearing " + i);
        delete databuf[i];
        delete queries[i];
        delete clients[i];
        delete timestamp[i];
        // TODO: need to clear requests
      }
      else c++;
    }
    console.log(">>> " + c + " buffer records inspected");
    BUFFER_TTL = (-3 * c) + 21000;
  }, BUFFER_TTL);

  function _resAdapter(data){
    data = data._doc || data;
    data = (data instanceof Array) ? data : [data];
    return data;
  }
  
  function strfy(docs){
    return JSON.stringify((docs.length == 1)?docs[0]:docs);
  }
  
  function mapall(A,B){
    return A.reduce(function(C,a){
      return B[a].reduce(function(c,b){
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
        data = databuf[reqid] = strfy(docs);
      }
      responses.forEach(function(res){
        if (res.type) res.type('application/json');
        res.send(data);
        if (!res.isWebsocket)
          SeamlessMongoosePlugin.deregisterClient(reqid,res);
      });
      if (docs instanceof Array) {
        docs.forEach(function(doc){
          if (requests[doc._id].indexOf(reqid) == -1) requests[doc._id].push(reqid);
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
    if (clients[id] instanceof Array) {
      if (clients[id].indexOf(peer) == -1) {
        clients[id] = clients[id].concat(peer);
        return true;
      }
      return false;
    }
    else {
      clients[id] = [peer];
      return true;
    }
  };
  
  SeamlessMongoosePlugin.deregisterClient = function(id, peer) {
    if (clients[id] && clients[id].length) {
      var pos = clients[id].indexOf(peer);
      if (pos >= 0) {
        clients[id].splice(pos, 1);
        if (!clients[id].length) {
          delete clients[id];
        }
      }
    }
  };
  
  schema.statics.notifyRegisteredClients = function(changed_docs_ids){
    var Model = this;
    return mapall(changed_docs_ids,requests)
    .map(function(reqid){ // get requests objects
      if (queries[reqid]) return Model.find(queries[reqid])
        .then(RespondTo(clients[reqid],reqid));
    });
  }; // returns an array of promises
  
  schema.statics.getData = function(reqid,query){
    if (databuf[reqid]) return new Promise.resolve(databuf[reqid]);
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
            return e._id;
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
      var reqid = req.path;
      var query = queries[reqid] = req.params;
      timestamp[reqid] = Date.now();
      switch (req.method){
        case "GET":
          return (
            (req.query.nopoll)?
            (Model.getData(reqid,query)):
            (new Promise(function(resolve,reject){
                res.isWebsocket = false;
                SeamlessMongoosePlugin.registerClient(reqid,res);
                var timeout = setTimeout(function(){
                  clearTimeout(timeout);
                  resolve();
                },29000);
              }).then(function(){return Model.getData(reqid,query)}))
          )
          .then(RespondTo(res,reqid))
          .catch(HandleErrTo(res,reqid));
        case "POST":
          SeamlessMongoosePlugin.registerClient(reqid,res);
          return Model.postData(reqid,query,req.body)
          .then(RespondTo(clients[reqid],reqid))
          .catch(HandleErrTo(res,reqid));
        default:
          return next();
      }
    };
  };
  
  SeamlessMongoosePlugin.SeamlessWSEndpointFor = function(Model){
    return function(ws,req){
      var reqid = req.path;
      var query = queries[reqid] = req.params;
      timestamp[reqid] = Date.now();
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
  
  // TODO: define middleware hooks
}
