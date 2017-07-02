var test_context = require("../examples/server.js");
var chai = require("chai");
//var chaiAsPromised = require("chai-as-promised");
//chai.use(chaiAsPromised);
//var request = require("supertest");
var expect = chai.expect;
//var assert = chai.assert;

var Test = test_context.Test; // model
var app = test_context.app;
var seamless = test_context.SeamlessBackend;
var test;

// beforeEach(function(){
//   test = Test.findOne({}).exec();
// });
// afterEach(function(){
//   test = null;
// });
describe("Seamless Mongoose Plugin",function(){
  describe("Model with plugin", function(){
    it("should have changes notifier", function(){
      //expect(test).to.be.fulfilled;
      //expect(test).to.eventually.have.property("notifyRegisteredClients");
      expect(Test).to.have.a.property("notifyRegisteredClients");
    });
    it("should provide data source",function(){
      // expect(test).to.be.fulfilled;
      // expect(test).to.eventually.have.property("getData");
      expect(Test).to.have.a.property("getData");
    });
    it("should provide data sink", function(){
      // expect(test).to.be.fulfilled;
      // expect(test).to.eventually.have.property("postData");
      expect(Test).to.have.a.property("postData");
    });
  });
});
