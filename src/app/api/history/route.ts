import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ResultStatus, SavedReport } from "@/lib/types";

// Shapes as they come back from Postgres (snake_case columns), before the
// camelCase mapping the client-facing SavedReport type uses.
interface SavedResultRow {
  id: string;
  test_name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  status: string;
  note: string | null;
}

interface SavedReportRow {
  id: string;
  file_name: string;
  doctor: string | null;
  clinic: string | null;
  report_date: string | null;
  created_at: string;
  saved_results: SavedResultRow[] | null;
}

export async function GET() {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    // The thrown message names env vars; keep it server-side only.
    return NextResponse.json(
      { error: "History is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS already scopes both tables to auth.uid(); the explicit user_id filter
  // is belt-and-braces and lets the index do the work.
  const { data, error } = await supabase
    .from("saved_reports")
    .select(
      "id, file_name, doctor, clinic, report_date, created_at, saved_results(id, test_name, value, unit, reference_range, status, note)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/history] saved_reports query failed:", error);
    return NextResponse.json(
      { error: "Could not load your history. Please try again." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as unknown as SavedReportRow[];

  const reports: SavedReport[] = rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    doctor: row.doctor,
    clinic: row.clinic,
    date: row.report_date,
    savedAt: row.created_at,
    // A report with no results must render as an empty list, not crash.
    results: (row.saved_results ?? []).map((r) => ({
      id: r.id,
      test: r.test_name,
      value: r.value,
      unit: r.unit,
      referenceRange: r.reference_range,
      // The status column is CHECK-constrained to the ResultStatus union.
      status: r.status as ResultStatus,
      note: r.note,
    })),
  }));

  return NextResponse.json({ reports });
}
