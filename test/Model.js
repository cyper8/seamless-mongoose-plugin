var test_context = require("../examples/server.js");
var chai = require("chai");
var expect = chai.expect;

var Test = test_context.Test; // model

describe.skip("Seamless Mongoose Plugin",function(){
  describe("Model with plugin", function(){
    it("should have changes notifier", function(){
      expect(Test).to.have.a.property("notifyRegisteredClients");
    });
    it("should provide data source",function(){
      expect(Test).to.have.a.property("getData");
    });
    it("should provide data sink", function(){
      expect(Test).to.have.a.property("postData");
    });
  });
});
