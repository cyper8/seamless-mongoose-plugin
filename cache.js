module.exports = function Cache(options){
    var databuf = {name:"data"}, // buffer with stringified responses - per reqid
      queries = {name:"queries"}, // buffer with query strings - per reqid
      requests = {name:"requests"}, // buffer with reqids - per document
      timestamp = {name:"timestamps"}; // buffer with timestamps of requests - per reqid

    var BUFFER_TTL = 40000;

    // buffer maintenance timer
    var _garbageCollector = setInterval(function() {
      var i, c = 0;
      for (i in timestamp) {
        if ((Date.now() - timestamp[i]) > BUFFER_TTL) {
          delete databuf[i];
          delete timestamp[i];
          // TODO: need to clear requests
        }
        else c++;
      }
      BUFFER_TTL = (-3 * c) + 40000;
    }, BUFFER_TTL);

    // atomic ops - async
    function _get(table,key){
      if (key && (table[key !== undefined])) return Promise.resolve(table[key]);
      else return Promise.reject(new Error("requested key \""+key+"\" in table \""+table.name+"\" is not found"));
    }
    function _set(table,key,value){
      if (value){
        table[key] = value;
        return Promise.resolve(value);
      }
      else {
        delete table[key];
        return Promise.resolve(undefined);
      }
    }
    function _tsreset(id){
      return function(cond){
        if (cond) timestamp[id] = Date.now();
        else delete timestamp[id];
        return cond;
      }
    }

    return { // API - async
      get(id,key){
        switch (key){
          case "data":
            return _get(databuf,id).then(_tsreset(id));
          case "query":
            return _get(queries,id).then(_tsreset(id));
          case "requests":
            return _get(requests,id);
        }
        return Promise.reject(new Error("unknown table "+key));
      },
      set(id,key,v){
        switch (key){
          case "data":
            return _set(databuf,id,v).then(_tsreset(id));
          case "query":
            return _set(queries,id,v).then(_tsreset(id));
          case "requests":
            return _set(requests,id,v);
        }
        return Promise.reject(new Error("table "+key+" is not found"));
      }
    }
  }
