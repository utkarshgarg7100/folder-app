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
  /** Emails a sign-in code. Does not sign the user in on its own. */
  sendCode: (email: string) => Promise<{ error: string | null }>;
  /** Exchanges the emailed code for a session. */
  verifyCode: (email: string, code: string) => Promise<{ error: string | null }>;
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

  // Deliberately a typed code, not a magic link.
  //
  // A magic link puts a single-use token in a URL, and a URL in an email is not
  // a private channel: mail providers fetch it before the recipient does, to
  // screen the destination. That fetch consumes the token and receives the
  // session cookie, so the real click always arrives to a spent token. It was
  // observed here directly — two verifications 1.15s apart, the first
  // succeeding on a connection that was not the user's browser.
  //
  // A code the user types cannot be spent by anything that merely reads the
  // email, and it is redeemed in the same browser that asked for it. No
  // emailRedirectTo, so there is no redirect, no PKCE verifier that must
  // survive a cross-domain hop, and no server callback route to keep correct.
  const sendCode = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      if (!supabase) {
        return { error: "Sign-in is not configured on this deployment." };
      }
      const { error } = await supabase.auth.signInWithOtp({ email });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const verifyCode = useCallback(
    async (email: string, code: string): Promise<{ error: string | null }> => {
      if (!supabase) {
        return { error: "Sign-in is not configured on this deployment." };
      }
      // type "email" covers both a first-time signup and a returning sign-in,
      // so there is no action-type to get wrong.
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      // No setUser() here: verifyOtp writes the auth cookies and fires
      // onAuthStateChange, which is the single place session state is applied.
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
    () => ({ authEnabled, user, loading, sendCode, verifyCode, signOut }),
    [authEnabled, user, loading, sendCode, verifyCode, signOut]
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
