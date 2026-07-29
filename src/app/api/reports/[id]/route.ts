import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// `id` goes straight into a uuid column; a non-uuid string reaches Postgres as
// `22P02 invalid input syntax for type uuid` and would surface as a 500.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One response for "no such report" and for "someone else's report", so the
// endpoint can't be used to probe which report ids exist.
const NOT_FOUND = "That report is no longer in your history.";

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/reports/[id]">
) {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    console.error("[DELETE /api/reports/[id]] Supabase client unavailable:", err);
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

  const { id } = await ctx.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  // RLS already scopes deletes to auth.uid(); the explicit user_id filter is
  // belt-and-braces. `.select` is what makes a zero-row delete detectable —
  // Postgres does not error when a delete matches nothing.
  const { data, error } = await supabase
    .from("saved_reports")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    console.error("[api/reports/[id]] saved_reports delete failed:", error);
    return NextResponse.json(
      { error: "Could not delete this report. Please try again." },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  // saved_results rows go with it via `on delete cascade`.
  return NextResponse.json({ ok: true });
}
