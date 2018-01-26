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
var notifier = chai.spy.on(Test,"notifyRegisteredClients");
var app = test_context.app;
var seamless = test_context.SeamlessBackend;
var testproto = {type:"review",count:1,hoverable:false,message:"Foo!",addresee:"Bob"};
var test2;

function timePad(time){
  return new Promise(function(resolve,reject){
    setTimeout(function(){
      resolve();
    },time);
  });
}

describe.skip("Seamless Mongoose Plugin express middleware for HTTP",function(){
  this.slow(500);
  var test;
  before(function(){
    this.timeout(5000);
    return Test.create(testproto)
      .then(function(doc){
        test = doc;
      });
  });

  after(function(){
    test.remove();
  });

  it(
    "accepts immediate (nopoll) GET requests and answers them right away",
    function(){
      return request(app)
              .get(`/gtest/${test._id.toString()}?nopoll=true`)
              .set('Accept','application/json')
              .expect(200)
              .then(function(resp){
                console.log(resp.body);
                return expect(resp.body.length).to.equal(1) &&
                  expect(resp.body[0]._id).to.equal(test._id.toString());
              }).catch(console.error);
    }
  );
  it(
    "accepts POST requests and returns changed objects",
    function(){
      var change = Object.assign({},testproto);
      change.count = 2;
      change._id = test._id.toString();
      return request(app)
        .post("/gtest/"+test._id.toString())
        .set('Content-Type','application/json')
        .set('Accept','application/json')
        .send(change)
        .expect(200)
        .then(function(resp){
          console.log(resp.body);
          return expect(resp.body.length).to.equal(1) &&
            expect(resp.body[0]._id).to.equal(change._id) &&
            expect(resp.body[0].count).to.equal(2);
        }).catch(console.error)
    }
  );
  it(
    "accepts polling GETS: holds for 29 secs and returns happy nothing",
    function(){
      this.timeout(35000);
      this.slow(30000);
      return request(app)
              .get("/gtest/"+test._id.toString())
              .set('Accept','application/json')
              .expect(200)
              .then(function(resp){
                console.log(resp.body);
                return expect(resp.body).to.be.empty;
              }).catch(console.error);
    }
  );
  it(
    "accepts polling GETS: if background change happens - it is returned",
    function(){
      this.timeout(5000);
      this.slow(3000);

      var change = timePad(1000)
      .then(function(){
        test.count = 3;
        return test.save();
      })
      .then(function(res){
        return expect(notifier).to.be.called();
      });
      var req = request(app)
              .get(`/gtest/${test._id.toString()}`)
              .set('Accept','application/json')
              .expect(200)
              .then(function(resp){
                console.log(resp.body);
                return expect(resp.body[0]._id).to.deep.equal(test._id.toString()) &&
                      expect(resp.body[0].count).to.equal(3);
              });
      return Promise.all([change,req]).catch(console.error);
    }
  );
  it(
    "accepts polling GETS: if parallel POST change happens - it is returned to the POST and polling GET",
    function(){
      this.timeout(35000);
      this.slow(3000);
      function Tests(resp){
        console.log(resp.body);
        return expect(resp.body[0]._id).to.deep.equal(test._id.toString()) &&
              expect(resp.body[0].count).to.equal(2);
      }
      var notifier = chai.spy.on(Test,"notifyRegisteredClients");
      var change = timePad(2000)
      .then(function(){
        var t = Object.assign({},testproto);
        t.count = 2;
        t._id = test._id.toString();
        return request(app)
          .post(`/gtest/${test._id.toString()}`)
          .set('Content-Type','application/json')
          .set('Accept','application/json')
          .send(t)
          .expect(200)
          .then(function(res){
            return expect(notifier).to.be.called() && Tests(res);
          })
          .catch(console.error);
      })
      .catch(console.error);
      var req = request(app)
              .get(`/gtest/${test._id.toString()}`)
              .set('Accept','application/json')
              .expect(200)
              .then(function(res){
                return Tests(res);
              })
              .catch(console.error);
      return Promise.all([change,req]).catch(console.error);
    }
  );
});
