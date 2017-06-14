module.exports = exports = function SeamlessMongoosePlugin(schema) {
  var schema = schema;
  var buffer = {},
    ts = {},
    cl = {};
  var BUFFER_TTL = 21000;

  SeamlessMongoosePlugin._garbageCollector = setInterval(function() {
    console.log("GC: " + BUFFER_TTL);
    var i, c = 0;
    for (i in ts) {
      if ((Date.now() - ts[i]) > BUFFER_TTL) {
        console.log(">>> Clearing " + i);
        delete buffer[i];
        delete ts[i];
      }
      else c++;
    }
    console.log(">>> " + c + " buffer records inspected");
    BUFFER_TTL = (-3 * c) + 21000;
  }, BUFFER_TTL);

  function sData(data) {
    if (data.length && data.length == 1) return JSON.stringify(data[0]);
    else {
      if (data._doc) return JSON.stringify(data._doc);
      else return JSON.stringify(data);
    }
  }

  function updateBuffer(id, docs) {

    buffer[id] = sData(docs);
    new Promise(function() {
      if (cl[id] && cl[id].length) {
        cl[id].forEach(function(e, i, a) {
          e.send(buffer[id]);
        });
      }
    });
    return buffer[id];
  }

  SeamlessMongoosePlugin.registerClient = function(id, peer) {
    if (cl[id] instanceof Array) {
      cl[id] = cl[id].concat(peer);
    }
    else cl[id] = [peer];
  };

  SeamlessMongoosePlugin.deregisterClient = function(id, peer) {
    if (cl[id] && cl[id].length) {
      var pos = cl[id].indexOf(peer);
      if (pos >= 0) {
        cl[id].splice(pos, 1);
        if (!cl[id].length) {
          delete cl[id];
        }
      }
    }
  };

  schema.statics.seamlessDataLink = function(req, res, next) {

    var id = req.originalUrl;
    ts[id] = Date.now();

    function Fail(err) {
      if (res.status) {
        res.status(500).send('Error querying: ' + err.toString());
      }
      else res.close(500, 'Error querying: ' + err.toString());
      console.error(err);
      return;
    }

    function Respond(docs) {
      var ds;
      res.send(updateBuffer(id, docs));
    }

    if (buffer[id] && (req.method === "GET")) {
      res.send(buffer[id]);
    }
    else {
      if (req.method === "GET") {
        return this.find(req.params).then(Respond).catch(Fail);
      }
      else if ((req.method === "POST") && req.body) {
        if (req.body instanceof Array) {
          return this.bulkWrite(req.body.map(function(e) {
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
          })).then(
            function(bwres) {
              this.where('_id').in(req.body.map(function(e) {
                if (e._id) {
                  return e._id;
                }
              })).then(Respond).catch(Fail);
            }).catch(Fail);
        }
        else {
          if (req.body._id) {
            return this.findByIdAndUpdate(req.body._id, req.body, {
                new: true
              })
              .then(Respond).catch(Fail);
          }
          return this.findOneAndUpdate(req.params, req.body, {
              new: true
            })
            .then(Respond).catch(Fail);
        }
      }
    }
    next();
  };


};
