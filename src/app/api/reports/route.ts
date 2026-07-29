import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ResultStatus, TestResult } from "@/lib/types";

interface SaveReportBody {
  fileName: string;
  doctor: string | null;
  clinic: string | null;
  date: string | null;
  results: TestResult[];
}

const VALID_STATUSES: ReadonlySet<string> = new Set<ResultStatus>([
  "in_range",
  "out_of_range",
  "unclear",
]);

// A real lab report has tens of results, not thousands; 200 leaves generous
// headroom for a large multi-panel report while bounding write volume.
const MAX_RESULTS = 200;
// Longest realistic field is a free-text note; 2000 chars is far past any
// legitimate test name, value, unit, range, doctor, clinic, date or file name.
const MAX_TEXT_CHARS = 2000;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_CHARS;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isValidResult(value: unknown): value is TestResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    isText(r.test) &&
    isText(r.value) &&
    isNullableString(r.unit) &&
    isNullableString(r.referenceRange) &&
    typeof r.status === "string" &&
    VALID_STATUSES.has(r.status) &&
    isNullableString(r.note)
  );
}

function isValidBody(body: unknown): body is SaveReportBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    isText(b.fileName) &&
    isNullableString(b.doctor) &&
    isNullableString(b.clinic) &&
    isNullableString(b.date) &&
    Array.isArray(b.results) &&
    b.results.every(isValidResult)
  );
}

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    console.error("[POST /api/reports] Supabase client unavailable:", err);
    return NextResponse.json(
      { error: "History is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in to save reports." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);

  // Cheap length checks first, so an oversized array is rejected before the
  // per-element validation walks it.
  const rawResults = (body as { results?: unknown } | null)?.results;
  if (Array.isArray(rawResults)) {
    if (rawResults.length > MAX_RESULTS) {
      return NextResponse.json(
        { error: `Too many results in this report (max ${MAX_RESULTS}).` },
        { status: 400 }
      );
    }
    if (rawResults.length === 0) {
      return NextResponse.json(
        { error: "This report has no results to save." },
        { status: 400 }
      );
    }
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Malformed report payload." },
      { status: 400 }
    );
  }

  const { data: report, error: reportError } = await supabase
    .from("saved_reports")
    .insert({
      user_id: user.id,
      file_name: body.fileName,
      doctor: body.doctor,
      clinic: body.clinic,
      report_date: body.date,
    })
    .select("id")
    .single();

  if (reportError || !report) {
    console.error("[api/reports] saved_reports insert failed:", reportError);
    return NextResponse.json(
      { error: "Could not save this report. Please try again." },
      { status: 500 }
    );
  }

  {
    const rows = body.results.map((r) => ({
      saved_report_id: report.id,
      user_id: user.id,
      test_name: r.test,
      value: r.value,
      unit: r.unit,
      reference_range: r.referenceRange,
      status: r.status,
      note: r.note,
    }));

    const { error: resultsError } = await supabase
      .from("saved_results")
      .insert(rows);

    if (resultsError) {
      console.error("[api/reports] saved_results insert failed:", resultsError);
      // Don't leave a half-saved report behind.
      const { error: cleanupError } = await supabase
        .from("saved_reports")
        .delete()
        .eq("id", report.id);
      if (cleanupError) {
        console.error(
          "[api/reports] compensating delete failed for report",
          report.id,
          cleanupError
        );
      }
      return NextResponse.json(
        { error: "Could not save this report. Please try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ id: report.id });
}
