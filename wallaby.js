module.exports = function () {
  return {
    files: [
      './examples/server.js',
      'seamless-mongoose-plugin.js',
      'cache.js',
      'uuid.js'
    ],

    tests: [
      'test/*.test.js'
    ],

    env: {
      type: 'node',
      runner: 'node'  // or full path to any node executable
    }
  };
};
