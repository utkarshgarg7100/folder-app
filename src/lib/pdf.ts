import { pdf } from "pdf-to-img";

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
  const doc = await pdf(buffer, { scale: 2 });
  const pages: Buffer[] = [];

  for await (const page of doc) {
    pages.push(page);
    if (pages.length >= maxPages) break;
  }

  return { pages, totalPages: doc.length };
}
