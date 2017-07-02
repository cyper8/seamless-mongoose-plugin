var test_context = require("../examples/server.js");
var chai = require("chai");
var spies = require("chai-spies");
var chaiAsPromised = require("chai-as-promised");
chai.use(spies);
chai.use(chaiAsPromised);
var request = require("supertest");
var expect = chai.expect;
//var assert = chai.assert;

var Test = test_context.Test; // model
var app = test_context.app;
var seamless = test_context.SeamlessBackend;
var testproto = {type:"review",count:1,hoverable:false,message:"Foo!",addresee:"Bob"};
var test;

before(function(){
  return Test.create(testproto)
    .then(function(doc){
      test = doc;
    })
})

after(function(){
  test.remove();
})

describe("Seamless Mongoose Plugin",function(){
  this.slow(500);
  describe("express middleware for HTTP",function(){
    it.skip(
      "accepts immediate (nopoll) GET requests and answers them right away",
      function(){
        return request(app)
                .get(`/gtest/${test._id}?nopoll=true`)
                .set('Accept','application/json')
                .expect(200)
                .then(function(resp){
                  return expect(resp.body).to.deep.include(testproto);
                });
      }
    )
    it.skip(
      "accepts polling GETS: holds for 29 secs and returns happy nothing",
      function(){
        this.timeout(30000);
        this.slow(30000);
        return request(app)
                .get(`/gtest/${test._id}`)
                .set('Accept','application/json')
                .expect(200)
                .then(function(resp){
                  return expect(resp.body).to.be.empty;
                });
      }
    )
    it(
      "accepts polling GETS: if change happens - it is returned",
      function(){
        this.timeout(30000);
        this.slow(3000);
        var notifier = chai.spy.on(Test,"notifyRegisteredClients");
        var change = new Promise(function(resolve,reject){
          setTimeout(function(){
            resolve();
          },2000);
        })
        .then(function(){test.count = 2;return test.save()})
        .then(function(res){
          return expect(notifier).to.be.called();
        })
        var req = request(app)
                .get("/gtest/"+test._id.toString())
                .set('Accept','application/json')
                .expect(200)
                .then(function(resp){
                  console.log(resp.body);
                  return expect(resp.body._id).to.deep.equal(test._id) &&
                        expect(resp.body.count).to.equal(2);
                });
        return Promise.all([change,req]);
      }
    )
  })
})
