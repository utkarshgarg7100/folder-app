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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidResult(value: unknown): value is TestResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.test === "string" &&
    typeof r.value === "string" &&
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
    typeof b.fileName === "string" &&
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
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "History is not configured on this deployment.",
      },
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
    return NextResponse.json(
      { error: reportError?.message ?? "Could not save this report." },
      { status: 500 }
    );
  }

  if (body.results.length > 0) {
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
      // Don't leave a half-saved report behind.
      await supabase.from("saved_reports").delete().eq("id", report.id);
      return NextResponse.json({ error: resultsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: report.id });
}
