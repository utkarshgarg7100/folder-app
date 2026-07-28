import { pdf } from "pdf-to-img";

/**
 * Renders every page of a PDF buffer to a PNG image buffer.
 * Vision models only accept images, so PDFs must be rasterized first.
 */
export async function pdfToPngPages(buffer: Buffer): Promise<Buffer[]> {
  const doc = await pdf(buffer, { scale: 2 });
  const pages: Buffer[] = [];
  for await (const page of doc) {
    pages.push(page);
  }
  return pages;
}
