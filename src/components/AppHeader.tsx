"use client";

import { useState } from "react";
import Link from "next/link";

import { useAuth } from "./AuthProvider";

type SubmitStatus = "idle" | "sending" | "sent" | "error";

export default function AppHeader() {
  const { authEnabled, user, loading, signInWithEmail, signOut } = useAuth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Closing the panel clears the transient submit state, so reopening always
  // gives a usable form. Without this, a "sent" panel is sticky for the rest
  // of the page's life and a typo'd address can never be corrected.
  const togglePanel = () => {
    setPanelOpen((open) => {
      if (open) {
        setStatus("idle");
        setErrorMessage(null);
      }
      return !open;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const { error } = await signInWithEmail(email);
    if (error) {
      setStatus("error");
      setErrorMessage(error);
    } else {
      setStatus("sent");
    }
  };

  return (
    <header className="border-b border-line bg-paper px-6">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-xl font-semibold text-ink transition-colors hover:text-teal"
        >
          Folder
        </Link>

        {/* Guest-only mode: no auth affordances at all. */}
        {!authEnabled ? null : loading ? (
          // Invisible placeholder sized to the signed-out "Sign in" button
          // (34x74px: py-1.5 + text-sm line-height + 1px border, px-3 + label).
          // It has no border or background, so when auth resolves nothing
          // visibly resizes — the button simply appears in the space already
          // reserved for it. The markup deliberately contains no "Sign in"
          // text so the SSR HTML can never flash it to a signed-in user.
          <div aria-hidden="true" className="h-[34px] w-[74px]" />
        ) : user ? (
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/history"
              className="rounded-lg px-2 py-1.5 font-medium text-ink-soft transition-colors hover:text-ink"
            >
              History
            </Link>
            <span className="hidden max-w-[14rem] truncate font-data text-xs text-ink-soft sm:inline">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-raised"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={togglePanel}
              aria-expanded={panelOpen}
              aria-controls="signin-panel"
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-raised"
            >
              Sign in
            </button>

            {panelOpen && (
              <div
                id="signin-panel"
                role="group"
                aria-label="Sign in"
                className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-line bg-paper-raised p-5 shadow-lg"
              >
                {status === "sent" ? (
                  <p className="text-sm leading-relaxed text-ink">
                    Check <span className="font-data">{email}</span> for a
                    sign-in link.
                  </p>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                    <p className="mb-1 text-sm leading-relaxed text-ink-soft">
                      Sign in to save reports and track results over time.
                    </p>
                    <label
                      htmlFor="signin-email"
                      className="text-xs font-medium uppercase tracking-wide text-ink-soft"
                    >
                      Email
                    </label>
                    <input
                      id="signin-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal"
                    />
                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="mt-1 rounded-lg bg-teal py-2.5 text-sm font-medium text-paper transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
                    >
                      {status === "sending" ? "Sending…" : "Send magic link"}
                    </button>
                    {status === "error" && errorMessage && (
                      <p className="mt-1 text-xs text-brick">{errorMessage}</p>
                    )}
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
