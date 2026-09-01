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
    alias: {
    }
  }
};
