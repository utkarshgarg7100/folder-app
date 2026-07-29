import { NextResponse } from "next/server";
import { pdfToPngPages } from "@/lib/pdf";
import { extractDocument, synthesizeSummary } from "@/lib/groq";
import type { AnalyzeResponse, ExtractedDocument } from "@/lib/types";

export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_PAGES_PER_DOCUMENT = 3; // Qwen 3.6 27B (vision) accepts at most 3 images per request

async function extractOne(file: File): Promise<ExtractedDocument> {
  const base: Pick<ExtractedDocument, "fileName"> = { fileName: file.name };

  if (!ACCEPTED_TYPES.has(file.type)) {
    return {
      ...base,
      doctor: null,
      clinic: null,
      date: null,
      results: [],
      unclearNotes: [],
      error: `Unsupported file type "${file.type || "unknown"}". Only PDF, JPG, and PNG are accepted.`,
    };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      ...base,
      doctor: null,
      clinic: null,
      date: null,
      results: [],
      unclearNotes: [],
      error: "File is too large (max 15 MB).",
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const allPages =
      file.type === "application/pdf"
        ? (await pdfToPngPages(buffer)).map((png) => ({
            mimeType: "image/png",
            base64: png.toString("base64"),
          }))
        : [{ mimeType: file.type, base64: buffer.toString("base64") }];

    if (allPages.length === 0) {
      return {
        ...base,
        doctor: null,
        clinic: null,
        date: null,
        results: [],
        unclearNotes: [],
        error: "Could not read any pages from this file.",
      };
    }

    const pages = allPages.slice(0, MAX_PAGES_PER_DOCUMENT);
    const truncatedNote =
      allPages.length > MAX_PAGES_PER_DOCUMENT
        ? [
            `This document has ${allPages.length} pages, but only the first ${MAX_PAGES_PER_DOCUMENT} were analyzed (model limit).`,
          ]
        : [];

    const extracted = await extractDocument(file.name, pages);
    return {
      ...base,
      ...extracted,
      unclearNotes: [...truncatedNote, ...extracted.unclearNotes],
      error: null,
    };
  } catch (err) {
    return {
      ...base,
      doctor: null,
      clinic: null,
      date: null,
      results: [],
      unclearNotes: [],
      error:
        err instanceof Error
          ? err.message
          : "Something went wrong reading this file.",
    };
  }
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not read the uploaded files. Please try again." },
      { status: 400 }
    );
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files were uploaded." },
      { status: 400 }
    );
  }

  const documents = await Promise.all(files.map(extractOne));

  const usableDocuments = documents.filter((d) => !d.error);

  let overallSummary = "";
  let crossDocumentRelation: AnalyzeResponse["crossDocumentRelation"] = {
    found: false,
    description: null,
    involvedTests: [],
  };

  if (usableDocuments.length > 0) {
    try {
      const synthesis = await synthesizeSummary(documents);
      overallSummary = synthesis.overallSummary;
      crossDocumentRelation = synthesis.crossDocumentRelation;
    } catch (err) {
      overallSummary =
        "We extracted the test values below, but couldn't generate a plain-language summary right now. " +
        (err instanceof Error ? err.message : "Please try again.");
    }
  } else {
    overallSummary =
      "None of the uploaded files could be read. See the notes below for details.";
  }

  const response: AnalyzeResponse = {
    documents,
    overallSummary,
    crossDocumentRelation,
    // Placeholder to satisfy the now-required field; Task 12 populates this
    // from fetchTestHistory().
    trends: [],
  };

  return NextResponse.json(response);
}
