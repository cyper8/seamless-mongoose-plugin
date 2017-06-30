var test_context = require("../examples/server.js");
var request = require("supertest");

var Test = test_context.Test; // model
var app = test_context.app;
var seamless = test_context.SeamlessBackend;

describe("Seamless Mongoose Plugin",function(){
  it("shold register itself against model as plugin", function(){
    expect(Test.notifyRegisteredClients).isDefined();
    expect(Test.getData).isDefined();
    expect(Test.postData);
  })
})
