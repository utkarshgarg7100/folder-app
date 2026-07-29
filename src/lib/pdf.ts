// Imported statically for two reasons, both load-bearing on a serverless
// deploy. First, it makes the dependency visible to Next's file tracing:
// pdfjs-dist reaches for this package through a runtime
// createRequire()("@napi-rs/canvas"), which tracing cannot see, so the package
// was never bundled and the function crashed on cold start. Second, it lets us
// install the globals ourselves below rather than trusting pdfjs to do it.
import * as canvas from "@napi-rs/canvas";

/**
 * pdfjs-dist expects DOM drawing globals to exist in Node. It tries to polyfill
 * them itself, but on failure it only calls warn() and keeps going — then
 * evaluates `new DOMMatrix()` at module scope anyway, throwing a bare
 * "DOMMatrix is not defined" that takes the whole module down. Setting them
 * here makes the outcome explicit instead of dependent on that swallowed path.
 *
 * This must run BEFORE pdfjs is evaluated, which is why pdf-to-img is imported
 * lazily inside the function below rather than at the top of this file: ESM
 * hoists static imports, so a top-level `import "pdf-to-img"` would evaluate
 * pdfjs before any of this executed.
 */
const globals = globalThis as unknown as Record<string, unknown>;
globals.DOMMatrix ??= canvas.DOMMatrix;
globals.ImageData ??= canvas.ImageData;
globals.Path2D ??= canvas.Path2D;

/**
 * Renders a PDF buffer to PNG page images.
 *
 * Vision models only accept images, so PDFs must be rasterized first.
 *
 * `maxPages` exists because rasterizing is expensive and the caller only ever
 * sends the first few pages to the model. Rendering a 10-page report just to
 * discard 7 of the images is pure latency on a request that already runs close
 * to the serverless timeout, so stop as soon as we have what was asked for.
 * `totalPages` is still reported accurately, so the caller can tell the user
 * their document was truncated.
 *
 * scale 2 (~144 DPI) is deliberate: lab printouts set reference ranges in small
 * type, and lowering it risks extraction accuracy. Tune only against real
 * reports, never synthetic ones.
 */
export async function pdfToPngPages(
  buffer: Buffer,
  maxPages = Number.POSITIVE_INFINITY
): Promise<{ pages: Buffer[]; totalPages: number }> {
  // Lazy so the globals above are in place before pdfjs evaluates. See note there.
  const { pdf } = await import("pdf-to-img");

  const doc = await pdf(buffer, { scale: 2 });
  const pages: Buffer[] = [];

  for await (const page of doc) {
    pages.push(page);
    if (pages.length >= maxPages) break;
  }

  return { pages, totalPages: doc.length };
}
