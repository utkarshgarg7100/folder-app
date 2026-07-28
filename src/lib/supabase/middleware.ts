import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "./config";

/**
 * Refreshes the Supabase auth session cookie for an incoming request.
 *
 * Returns a `NextResponse` that carries any rewritten auth cookies plus the
 * no-store cache headers the Supabase SSR library asks us to forward, so a CDN
 * can never cache one user's session and serve it to another.
 *
 * No-ops (returns a plain pass-through response) when Supabase is not
 * configured, so the app keeps working in guest-only mode.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  if (!isSupabaseConfigured()) {
    return response; // guest-only mode: there is no session to refresh
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Mirror the new cookies onto the request so downstream renders see them.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request: { headers: request.headers },
        });

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );

        // Responses that set auth cookies must not be cached by CDNs or
        // reverse proxies (Cache-Control / Expires / Pragma).
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          response.headers.set(key, value)
        );
      },
    },
  });

  // getUser() (not getSession()) revalidates the token against the auth server
  // and triggers the cookie rewrite above when the token was refreshed.
  await supabase.auth.getUser();

  return response;
}
