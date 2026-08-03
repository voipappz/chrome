const { join } = require('path');

module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: {
    contentPage: join(__dirname, 'src/contentPage.ts'),
    backgroundPage: join(__dirname, 'src/backgroundPage.ts')
  },
  output: {
    path: join(__dirname, '../angular/dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        exclude: /node_modules/,
        test: /\.ts?$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: join(__dirname, 'tsconfig.json'),
            // TS 4.0 can't type-check nats.ws's newer type definitions;
            // transpile only and let the Angular build do project checking.
            transpileOnly: true
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Use the ES5-safe CJS build — webpack 4's parser can't read the
    // optional chaining in nats.ws's esm build.
    alias: {
      'nats.ws': join(__dirname, '../node_modules/nats.ws/cjs/nats.js')
    }
  }
};
