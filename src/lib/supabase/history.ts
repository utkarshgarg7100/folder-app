import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultStatus, TestTrend, TrendPoint } from "@/lib/types";

// How many saved_results rows we are willing to pull for one analyze request.
// A heavy user can accumulate five figures of rows (a prior measurement in this
// project put a plausible user at ~10.5k), and this runs on every analyze, so an
// unbounded select is a latency and memory problem. 2000 rows covers roughly
// 60-100 saved reports' worth of results — far more history than a trend chart
// can usefully show — while keeping the payload small.
const MAX_RESULT_ROWS = 2000;

/**
 * Shape of a row as it comes back from Postgres. The embedded relation is typed
 * as object-or-array because PostgREST returns an object when it infers a
 * to-one relationship and a single-element array otherwise.
 */
interface SavedResultRow {
  test_name: string;
  value: string;
  unit: string | null;
  status: string;
  created_at: string;
  saved_reports:
    | { report_date: string | null }
    | { report_date: string | null }[]
    | null;
}

/**
 * Prior saved history for the given test names, grouped one TestTrend per test,
 * points oldest -> newest.
 *
 * Best-effort by design: trends decorate an analyze response and must never be
 * able to fail it, so every failure path returns [] (after logging server-side)
 * rather than throwing or surfacing database text to the caller.
 */
export async function fetchTestHistory(
  supabase: SupabaseClient,
  userId: string,
  testNames: string[]
): Promise<TestTrend[]> {
  if (testNames.length === 0) return [];

  try {
    // RLS already scopes saved_results to auth.uid(); the explicit user_id
    // filter is belt-and-braces and lets the (user_id, test_name, created_at)
    // index do the work.
    //
    // Ordering is DESCENDING here purely so that a user over MAX_RESULT_ROWS
    // keeps their most RECENT rows; the rows are reversed to oldest -> newest in
    // JS below. Ordering ascending with a limit would truncate from the wrong
    // end and leave a trend that stops years ago.
    const { data, error } = await supabase
      .from("saved_results")
      .select("test_name, value, unit, status, created_at, saved_reports(report_date)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_RESULT_ROWS);

    if (error) {
      console.error("[lib/history] saved_results query failed:", error);
      return [];
    }

    const rows = (data ?? []) as unknown as SavedResultRow[];

    // Test names are matched in JS, NOT server-side. Do not "optimise" this into
    // .or("test_name.ilike.…") built from testNames: those names come from LLM
    // extraction of arbitrary user-uploaded PDFs, and commas, parentheses and
    // dots are all PostgREST filter syntax — interpolating them into a filter
    // string is a filter-injection surface. JS matching has no such surface.
    const wanted = new Set(testNames.map((name) => name.toLowerCase()));

    // Grouping is case-insensitive, but the returned testName takes the casing
    // of the first row seen for that key. "Hemoglobin" and "HEMOGLOBIN" saved
    // from two different reports collapse into one trend, labelled with
    // whichever casing appeared first.
    const trends = new Map<string, TestTrend>();

    // Reversed: the query returned newest -> oldest, points must be oldest ->
    // newest.
    for (const row of [...rows].reverse()) {
      const key = row.test_name.toLowerCase();
      if (!wanted.has(key)) continue;

      const reportRelation = Array.isArray(row.saved_reports)
        ? row.saved_reports[0]
        : row.saved_reports;

      const point: TrendPoint = {
        value: row.value,
        unit: row.unit,
        // The status column is CHECK-constrained to the ResultStatus union.
        status: row.status as ResultStatus,
        reportDate: reportRelation?.report_date ?? null,
        savedAt: row.created_at,
      };

      const existing = trends.get(key);
      if (existing) {
        existing.points.push(point);
      } else {
        trends.set(key, { testName: row.test_name, points: [point] });
      }
    }

    return [...trends.values()];
  } catch (err) {
    // Network failure, malformed row, anything: the caller gets [] regardless.
    console.error("[lib/history] fetchTestHistory failed:", err);
    return [];
  }
}
