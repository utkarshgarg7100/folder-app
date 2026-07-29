"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

interface AuthContextValue {
  /** False when Supabase env vars are absent — the app runs in guest-only mode. */
  authEnabled: boolean;
  user: User | null;
  loading: boolean;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const authEnabled = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  // Nothing to resolve in guest mode, so we are never "loading" there.
  const [loading, setLoading] = useState(authEnabled);

  // Memoized so a re-render never builds a second Supabase client (which would
  // register duplicate auth listeners). Guarded because
  // createBrowserSupabaseClient() throws when the env vars are missing.
  const supabase = useMemo(
    () => (authEnabled ? createBrowserSupabaseClient() : null),
    [authEnabled]
  );

  // Supabase's default email templates route through /auth/v1/verify, which
  // hands the session back in a URL *fragment* (#access_token=...). Fragments
  // are never sent to the server, so the server-side callback cannot see them
  // and the user silently lands signed out. Editing the templates to use
  // token_hash is the cleaner fix, but that is gated behind configuring custom
  // SMTP, so we also recover the session here on the client.
  //
  // Browsers preserve the fragment across the callback's redirect, so it is
  // still present by the time this mounts. setSession() writes the auth
  // cookies, which is what makes the session visible to the server too.
  useEffect(() => {
    if (!supabase || typeof window === "undefined") return;
    if (!window.location.hash.includes("access_token")) return;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    let active = true;
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (!active) return;
        if (error) {
          console.error("[auth] could not restore session from URL:", error.message);
          return;
        }
        // Strip the tokens from the address bar so they are not left in
        // history, bookmarks or a screenshot. Also clears ?auth_error=1, which
        // the server callback added before the fragment could be read.
        window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => {
        /* onAuthStateChange below still governs the rendered state. */
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithEmail = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      if (!supabase) {
        return { error: "Sign-in is not configured on this deployment." };
      }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // Land on the app root, not /auth/callback. Supabase's default email
        // templates return the session in a URL fragment, and only the client
        // can read a fragment — routing through the server callback means a
        // redirect first, and a fragment survives a redirect only by browser
        // convention, not by guarantee. Landing directly on a client-rendered
        // page removes that dependency entirely.
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  const value = useMemo(
    () => ({ authEnabled, user, loading, signInWithEmail, signOut }),
    [authEnabled, user, loading, signInWithEmail, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() must be used inside an <AuthProvider>.");
  }
  return context;
}
