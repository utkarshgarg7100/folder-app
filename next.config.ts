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

  // Everything pdfjs needs at runtime that static tracing cannot see, because
  // each is resolved from a path built at runtime rather than imported:
  //
  //  - @napi-rs/canvas picks its native .node binary with a platform-specific
  //    require, so the JS would otherwise ship without its addon.
  //  - pdf.worker.mjs is spawned by filename by the worker setup.
  //  - standard_fonts/ and cmaps/ are read through pdf-to-img's
  //    standardFontDataUrl / cMapUrl, both built from a resolved package path.
  //  - wasm/ backs pdfjs's JPEG2000 and JBIG2 decoders, which scanned lab
  //    reports do hit.
  //
  // Listed file-by-file rather than sweeping in legacy/build, which is 16 MB
  // and mostly source maps. Total added here is roughly 5 MB.
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
    ],
  },
};

export default nextConfig;
