import { NextResponse } from "next/server";
import { pdfToPngPages } from "@/lib/pdf";
import { extractDocument, synthesizeSummary } from "@/lib/groq";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchTestHistory } from "@/lib/supabase/history";
import type { AnalyzeResponse, ExtractedDocument, TestTrend } from "@/lib/types";

export const runtime = "nodejs";
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

    // Only rasterize the pages we will actually send. Rendering is the most
    // expensive non-model step, and this request runs near the serverless
    // timeout, so a long PDF must not pay for pages it will never use.
    const rasterStart = Date.now();
    let allPages: { mimeType: string; base64: string }[];
    let totalPages: number;

    if (file.type === "application/pdf") {
      const rendered = await pdfToPngPages(buffer, MAX_PAGES_PER_DOCUMENT);
      allPages = rendered.pages.map((png) => ({
        mimeType: "image/png",
        base64: png.toString("base64"),
      }));
      totalPages = rendered.totalPages;
    } else {
      allPages = [{ mimeType: file.type, base64: buffer.toString("base64") }];
      totalPages = 1;
    }
    console.log(
      `[analyze] rasterized ${allPages.length}/${totalPages} page(s) of ${file.name} in ${Date.now() - rasterStart}ms`
    );

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

    const pages = allPages;
    const truncatedNote =
      totalPages > MAX_PAGES_PER_DOCUMENT
        ? [
            `This document has ${totalPages} pages, but only the first ${MAX_PAGES_PER_DOCUMENT} were analyzed (model limit).`,
          ]
        : [];

    const extractStart = Date.now();
    const extracted = await extractDocument(file.name, pages);
    console.log(
      `[analyze] extracted ${file.name} in ${Date.now() - extractStart}ms`
    );
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

  // Trend history is decoration on top of the analysis: a signed-out user, an
  // unconfigured Supabase, or a failed history read must all degrade to [] and
  // let the analysis itself succeed.
  //
  // The client here MUST be the cookie-bound one from
  // createServerSupabaseClient() — RLS on saved_results is the authorization
  // boundary that keeps one user's history out of another's response. Never
  // swap in createAdminSupabaseClient(), which bypasses RLS.
  let trends: TestTrend[] = [];
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const testNames = [
        ...new Set(usableDocuments.flatMap((d) => d.results.map((r) => r.test))),
      ];
      trends = await fetchTestHistory(supabase, user.id, testNames);
    }
  } catch (err) {
    console.error("[api/analyze] history lookup failed:", err);
    trends = [];
  }

  let overallSummary = "";
  let crossDocumentRelation: AnalyzeResponse["crossDocumentRelation"] = {
    found: false,
    description: null,
    involvedTests: [],
  };

  if (usableDocuments.length > 0) {
    try {
      const synthStart = Date.now();
      const synthesis = await synthesizeSummary(documents, trends);
      console.log(`[analyze] synthesized in ${Date.now() - synthStart}ms`);
      overallSummary = synthesis.overallSummary;
      crossDocumentRelation = synthesis.crossDocumentRelation;
    } catch (err) {
      // The real error goes to the server log only. Raw SDK errors can carry
      // API-key, rate-limit and connection detail, and this string is shown
      // verbatim to a patient — so the user-facing copy is fixed text with no
      // interpolation.
      console.error("[api/analyze] synthesizeSummary failed:", err);
      overallSummary =
        "We extracted the test values below, but couldn't generate a plain-language summary right now. Please try again in a moment.";
    }
  } else {
    overallSummary =
      "None of the uploaded files could be read. See the notes below for details.";
  }

  const response: AnalyzeResponse = {
    documents,
    overallSummary,
    crossDocumentRelation,
    trends,
  };

  return NextResponse.json(response);
}
