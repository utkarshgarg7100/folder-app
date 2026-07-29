import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // @napi-rs/canvas supplies the DOMMatrix/ImageData/Path2D globals that
  // pdfjs-dist needs in Node. pdfjs pulls it in via a runtime
  // createRequire()("@napi-rs/canvas"), which static file tracing cannot see,
  // so on a serverless deploy it was never bundled. pdfjs warns and continues
  // when that require fails, then evaluates `new DOMMatrix()` at module scope
  // regardless — so the whole module failed to load and every /api/analyze
  // request returned 500. Listing it here keeps it external and traced into
  // the function bundle. It is also a direct dependency in package.json so
  // nothing depends on it staying a transitive one.
  serverExternalPackages: ["pdf-to-img", "pdfjs-dist", "@napi-rs/canvas"],

  // @napi-rs/canvas picks its native .node binary with a platform-specific
  // require built at runtime, so tracing cannot see the binary either — the JS
  // would ship without the addon it needs. Name the packages explicitly so the
  // Linux build the deploy actually runs on is uploaded with the function.
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
    ],
  },
};

export default nextConfig;
