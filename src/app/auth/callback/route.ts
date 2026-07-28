import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Magic-link / OAuth redirect target: exchanges the auth code for a session cookie. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // Only allow same-origin relative redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    try {
      const supabase = await createServerSupabaseClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${safeNext}`);
      }
    } catch {
      // falls through to the error redirect below
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
