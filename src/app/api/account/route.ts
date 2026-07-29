import { NextResponse } from "next/server";
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server";

export async function DELETE() {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    console.error("[DELETE /api/account] Supabase client unavailable:", err);
    return NextResponse.json(
      { error: "Account deletion is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let admin;
  try {
    // The only place in the app that bypasses RLS: deleting an auth user is
    // not something the anon key can do.
    admin = createAdminSupabaseClient();
  } catch (err) {
    console.error("[DELETE /api/account] admin client unavailable:", err);
    return NextResponse.json(
      { error: "Account deletion is not configured on this deployment." },
      { status: 501 }
    );
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    console.error("[api/account] deleteUser failed:", error);
    return NextResponse.json(
      { error: "Could not delete your account. Please try again." },
      { status: 500 }
    );
  }

  // profiles, saved_reports and saved_results all go with it via the
  // `on delete cascade` chain rooted at auth.users.

  // The browser still holds auth cookies for a user that no longer exists.
  // Local scope only: a server-side revoke would call the auth API with a token
  // whose user is already gone, and its failure must not fail the deletion.
  const { error: signOutError } = await supabase.auth.signOut({
    scope: "local",
  });
  if (signOutError) {
    console.error("[api/account] local sign-out after deletion:", signOutError);
  }

  return NextResponse.json({ ok: true });
}
