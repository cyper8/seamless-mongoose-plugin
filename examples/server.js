
var express = require('express'),
  bodyParser = require("body-parser"),
  jsonParser = bodyParser.json(),
  app = express(),
  //expressWs = require("express-ws")(app),
  db = process.env.TEST_DB_URL || "mongodb://localhost/test",
//  dbseed = require("./seed.json"),
  mongoose = require("mongoose"),
  SeamlessBackend = require("../seamless-mongoose-plugin.js");

mongoose.Promise = global.Promise;
mongoose.connect(db,{useMongoClient: true},function(ignore,connection){
  connection.onOpen();
});

var testSchema = mongoose.Schema({
  "type": String,
  "count": Number,
  "hoverable": Boolean,
  "message": String,
  "addresee": {
    type:String,
    index: true
  }
});

testSchema.plugin(SeamlessBackend);

var Test = mongoose.model("Test",testSchema);

// Test.deleteMany({}).exec().then(function() {
//   return Test.create(dbseed);
// })
// .then(function(docs) {
//   // console.log("DB seeded",docs);
// });

//app.use(require("helmet")());
app.use(jsonParser);
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use('/gtest/:_id', SeamlessBackend.SeamlessHTTPEndpointFor(Test));

app.use('/gtest/for/:addresee', SeamlessBackend.SeamlessHTTPEndpointFor(Test));

//app.ws('/test/:_id', SeamlessBackend.SeamlessWSEndpointFor(Test));

// app.use(express.static(`${__dirname}`, {
//   maxAge: 1000
// }));
// app.use(express.static(`${__dirname}/../bin`, {
//   maxAge: 1000
// }));

app.listen(process.env.PORT || 3000, process.env.IP || "127.0.0.1", function() {
  console.log('Listening on ' + (process.env.PORT || 3000));
});

module.exports = {
  app,
  Test,
  SeamlessBackend
};

// Test.insertMany([{type:"review",count:1,hoverable:false,message:"Foo!",addressee:"Bob"},
//   {type:"review",count:1,hoverable:false,message:"Nice!",addressee:"Bob"},
//   {type:"review",count:1,hoverable:false,message:"Couldn't finish!",addressee:"Bob"}])
//   .then(function(res){
//     console.log(res);
//   });;
