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
var test;

function TestClient(exapp){
  var connection = null;
  var stoppoll = false;
  const request = request;
  this.state = 0;
  this.data = null;
  this.connect = function(url){
    var self = this;
    self.state = (!self.data)?1:2;
    self.data = request(exapp)
    .get((!self.data)?url+'?nopoll=true':url)
    .set('Accept','application/json')
    .expect(200)
    .then(function(resp){
      if (!stoppoll) self.connect(url);
      else self.state = 4;
      return resp.body;
    });
    self.data.terminate = self.terminate;
    return self.data;
  }.bind(this);
  this.terminate = function(){
    stoppoll = true;
    this.state = 3;
  }.bind(this);
}

function timePad(time){
  return new Promise(function(resolve,reject){
    setTimeout(function(){
      resolve();
    },time);
  });
}

function* hooksGen(){
  test.message="Wow!";
  yield test.save();                 // save
  yield Test.insertMany([
    {type:"review",count:1,hoverable:false,message:"Boo!",addresee:"Bob"},
    {type:"review",count:1,hoverable:false,message:"Soo?",addresee:"Bob"},
    {type:"review",count:1,hoverable:false,message:"Noo!",addresee:"Bob"}
  ]);                                    // insertMany
  yield Test.findOneAndRemove({message:"Boo!"});              // findOneAndRemove
  yield Test.findOneAndUpdate({message:"Wow!"},{count:2},{new:true});                              // findOneAndUpdate
  yield Test.update({addresee:"Bob"},{count:2},{multi:true}).exec();    // update
  yield test.remove();                              // remove
}

function* requestGen(){
  var first = null;
  yield request(app)
    .get('/gtest/for/Bob?nopoll=true')
    .set('Accept','application/json')
    .expect(200)
    .then(function(resp){
      return first = resp.body;
    });
  while(true){
    yield request(app)
      .get('/gtest/for/Bob')
      .set('Accept','application/json')
      .expect(200)
      .then(function(resp){
        if (resp.body === {}) return first;
        else {
          return first = resp.body;
        }
      });
  }
}

var testcasegen = hooksGen();
var testsgen = requestGen();

describe("Mongoose hooks trigger responses", function(){
  before(function(){
    this.timeout(5000);
    return Test.create(testproto)
      .then(function(doc){
        return test = doc;
      });
  });

  after(function(){
    Test.remove({},console.error);
  });

  it("initiall no-polling GET request returns test document",function(){
    return testsgen.next().value
      .then(function(res){
        return expect(res.length).to.equal(1) &&
          expect(res[0]._id).to.equal(test._id.toString()) &&
          expect(res[0].message).to.equal(test.message);
      })
  });

  ['save','insertMany','findOneAndRemove','findOneAndUpdate','update','remove']
  .forEach(function(task){
    it(task,function(){
      return Promise.all([
        timePad(500)
          .then(function(){return testcasegen.next().value})
          .then(function(){
            return Test.find({addresee:"Bob"}).exec();
          })
          .then(seamless.getDocsFrom),
        testsgen.next().value
      ])
      .then(function(testset){
        console.log("------------>"+task+" success");
        return console.log(testset);
      })
      .catch(function(err){console.log(task+" fail");console.error(err);});
    });
  });
});
