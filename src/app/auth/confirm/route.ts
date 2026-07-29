import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Email-link verification via `token_hash`.
 *
 * Supabase's default email templates link to `/auth/v1/verify`, which returns
 * the session in a URL *fragment* (`#access_token=...`). Fragments are never
 * sent to the server, so a server-side handler cannot see them and the user
 * lands on the site signed out — silently, with no error.
 *
 * The fix Supabase documents for server-side auth is to point email templates
 * at this route instead:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .EmailActionType }}
 *
 * We then exchange the token for a session here, where the cookie-bound client
 * can actually write the auth cookies.
 *
 * `/auth/callback` is kept alongside this for the PKCE `?code=` flow.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";
  // Only same-origin relative redirects, so a crafted link can't bounce a
  // freshly-authenticated user to an attacker's page.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/?auth_error=1`);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    // Most commonly an expired or already-used link. Some mail clients
    // pre-fetch URLs to build previews, which consumes the single-use token
    // before the recipient ever clicks it.
    console.error("[auth/confirm] verifyOtp failed:", error.message);
  } catch (err) {
    console.error("[auth/confirm] unexpected failure:", err);
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
