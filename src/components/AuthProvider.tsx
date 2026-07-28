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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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
