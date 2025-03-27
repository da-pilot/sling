module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: {
        node: 'current'
      }
    }]
  ],
  assumptions: {
    privateFieldsAsProperties: true
  }
}; 