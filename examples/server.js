var express = require('express'),
  bodyParser = require("body-parser"),
  jsonParser = bodyParser.json(),
  app = express(),
  expressWs = require("express-ws")(app),
  db = process.env.TEST_DB_URL || "mongodb://localhost/test",
  mongoose = require("mongoose"),
  SeamlessBackend = require("../seamless-mongoose-plugin.js");

mongoose.connect(db);

var testSchema = mongoose.Schema({
  "type": String,
  "count": Number,
  "hoverable": Boolean,
  "message": String,
  "addresee": String
});

testSchema.plugin(SeamlessBackend);

var Test = mongoose.model(testSchema);

app.use(require("helmet")());
app.use(jsonParser);
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use('/gtest/:_id', SeamlessBackend.SeamlessHTTPEndpointFor(Test));

app.ws('/test/:_id', SeamlessBackend.SeamlessWSEndpointFor(Test));

app.use(express.static(`${__dirname}`, {
  maxAge: 1000
}));
app.use(express.static(`${__dirname}/../bin`, {
  maxAge: 1000
}));

app.listen(process.env.PORT, process.env.IP, function() {
  console.log('Listening on ' + process.env.PORT)
});

module.exports = {
  app,
  Test,
  SeamlessBackend
}