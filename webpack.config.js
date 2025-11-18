import path from "path";
import { fileURLToPath } from "url";
import webpack from "webpack";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env
const env = dotenv.config().parsed || {};

// Convert env to webpack DefinePlugin format
const envKeys = Object.keys(env).reduce((prev, next) => {
  prev[`process.env.${next}`] = JSON.stringify(env[next]);
  return prev;
}, {});

export default {
  mode: "production",
  target: "node",
  entry: "./server.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "server.bundle.cjs",
    library: {
      type: "commonjs2",
    },
  },
  externals: {
    // Don't bundle built-in Node.js modules
    dotenv: "commonjs2 dotenv",
  },
  plugins: [
    // Inject environment variables
    new webpack.DefinePlugin(envKeys),
    // Add shebang for direct execution
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true,
    }),
  ],
  optimization: {
    minimize: true,
  },
  resolve: {
    extensions: [".js"],
  },
};
