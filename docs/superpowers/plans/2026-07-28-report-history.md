# Report History & Trend Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users optionally save extracted report values, view them as a history, and get trend-aware comparisons (chart + LLM commentary) on future uploads — while guest use stays exactly as it is today.

**Architecture:** Add Supabase (Postgres + email magic-link auth) as an opt-in persistence layer behind `@supabase/ssr`. Guest mode is preserved by feature-detecting Supabase env vars everywhere they'd be used. `/api/analyze` is extended to fetch a signed-in user's prior saved values for matching test names and feed them into the existing `synthesizeSummary` LLM call and a new per-test trend chart.

**Tech Stack:** Next.js App Router (existing), `@supabase/supabase-js` + `@supabase/ssr` (new), Recharts (existing, used for the new trend sparkline), Groq via `groq-sdk` (existing).

## Global Constraints

- Never store the original uploaded file (PDF/image) — only structured extracted values, and only when the user explicitly saves. (Spec: Architecture)
- Guest use (no login) must remain functionally identical to today's behavior: no login wall, nothing persisted, no history/trend UI. (Spec: Goals, Architecture)
- If Supabase env vars are absent, the app must run in guest-only mode — hide the sign-in affordance, never crash. Same failure posture as the existing `GROQ_API_KEY`-missing handling in `src/lib/groq.ts`. (Spec: Error handling)
- No password auth — email magic link only. (Spec: Non-goals)
- No fuzzy/synonym test-name matching — case-insensitive exact string match only. (Spec: Data model)
- Account/data deletion is a real delete via cascading foreign keys, never a soft-delete flag. (Spec: Privacy & data controls)
- A history-fetch failure during `/api/analyze` must never fail the whole analysis — fall back to no-trend behavior for that request. (Spec: Error handling)
- This project has no automated test suite (confirmed existing pattern — see spec's Testing Approach and the project's own README). Each task's steps therefore substitute `npm run build` (typecheck/build) plus explicit manual verification (curl / SQL / browser steps, written out in full) for the write-test/run-test steps a test-framework project would use. Do not introduce a test framework as part of this plan — out of scope.
- This repo's `AGENTS.md` and this session's own history (Next.js 16 route-handler quirks, a Groq model deprecation) are a standing reminder that package APIs may have drifted from training data. Where a task calls for it, read the installed package's own README/type defs in `node_modules` before writing code against it, the same way earlier work in this repo verified `pdf-to-img` and `groq-sdk` before use.
- Commit after every task using this repo's existing commit style (see `git log` for examples) — plain, descriptive, no marketing language.

---

## Phase 1 — Supabase Foundation

No user-visible change yet. Ends with: dependencies installed, schema documented and ready to run, client/server helpers in place, `npm run build` clean.

### Task 1: Dependencies, env vars, and database schema

**Files:**
- Modify: `package.json` (add dependencies)
- Modify: `.env.example`
- Create: `src/lib/supabase/schema.sql`

**Interfaces:**
- Produces: the `profiles` / `saved_reports` / `saved_results` tables and RLS policies that every later task's Supabase queries depend on. No TypeScript interface — this is infrastructure the user runs manually in the Supabase SQL editor.

- [ ] **Step 1: Install the Supabase packages**

```bash
cd "/Users/utkarshgarg/Desktop/cimba assignment/folder-app"
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Add the new env vars to `.env.example`**

Append to the end of the existing `.env.example`:

```bash

# Supabase (optional — omit all three to run in guest-only mode, no history/trends).
# Create a free project at https://supabase.com, then find these under
# Project Settings -> API in the Supabase dashboard.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Service role key — server-only, used only for full account deletion. Keep secret.
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 3: Write the database schema**

Create `src/lib/supabase/schema.sql`:

```sql
-- Run this once in the Supabase dashboard's SQL Editor for your project.
-- (Project -> SQL Editor -> New query -> paste this file -> Run.)

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  file_name   text not null,
  doctor      text,
  clinic      text,
  report_date text, -- as printed on the document; not normalized/parsed
  created_at  timestamptz not null default now()
);

create table public.saved_results (
  id               uuid primary key default gen_random_uuid(),
  saved_report_id  uuid not null references public.saved_reports (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  test_name        text not null,
  value            text not null,
  unit             text,
  reference_range  text,
  status           text not null check (status in ('in_range', 'out_of_range', 'unclear')),
  note             text,
  created_at       timestamptz not null default now()
);

create index saved_results_user_test_idx
  on public.saved_results (user_id, test_name, created_at);

-- Auto-create a profiles row whenever a new Supabase auth user is created,
-- so saved_reports/saved_results always have a valid profiles row to
-- reference for a signed-in user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security: every table is scoped to auth.uid() so route handlers
-- never need to write their own authorization checks beyond "is there a
-- session".
alter table public.profiles enable row level security;
alter table public.saved_reports enable row level security;
alter table public.saved_results enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "saved_reports_select_own" on public.saved_reports
  for select using (auth.uid() = user_id);
create policy "saved_reports_insert_own" on public.saved_reports
  for insert with check (auth.uid() = user_id);
create policy "saved_reports_delete_own" on public.saved_reports
  for delete using (auth.uid() = user_id);

create policy "saved_results_select_own" on public.saved_results
  for select using (auth.uid() = user_id);
create policy "saved_results_insert_own" on public.saved_results
  for insert with check (auth.uid() = user_id);
create policy "saved_results_delete_own" on public.saved_results
  for delete using (auth.uid() = user_id);
```

- [ ] **Step 4: Verify — build still passes**

```bash
npm run build
```
Expected: succeeds exactly as before (no code changed the build depends on yet — this step just confirms the dependency install didn't break anything).

- [ ] **Step 5: Manual verification note for the user (not automatable here)**

This step has no command to run in this environment — record it in the task and move on; the user runs it once they have a Supabase project:
1. Create a free project at supabase.com.
2. Open SQL Editor -> New query, paste `src/lib/supabase/schema.sql`, click Run.
3. Confirm three tables (`profiles`, `saved_reports`, `saved_results`) appear under Table Editor.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/supabase/schema.sql
git commit -m "Add Supabase dependencies, env vars, and database schema"
```

---

### Task 2: Supabase client helpers (browser, server, admin)

**Files:**
- Create: `src/lib/supabase/config.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` env vars (Task 1).
- Produces:
  - `isSupabaseConfigured(): boolean` — used by every later task that needs to guard guest-mode.
  - `createBrowserSupabaseClient(): SupabaseClient` — used by `AuthProvider` (Task 4).
  - `createServerSupabaseClient(): Promise<SupabaseClient>` — used by every route handler (Tasks 6, 8, 9, 12).
  - `createAdminSupabaseClient(): SupabaseClient` — used only by the account-deletion route (Task 9).

- [ ] **Step 1: Read the installed package's own docs before writing against it**

```bash
cd "/Users/utkarshgarg/Desktop/cimba assignment/folder-app"
cat node_modules/@supabase/ssr/README.md | head -150
```
Confirm the exported `createBrowserClient` / `createServerClient` function signatures and the `cookies: { getAll, setAll }` shape match what's used below before proceeding. If the installed version's API differs, adapt Steps 3-4 to match what you find rather than the snippets here.

- [ ] **Step 2: Write the guest-mode feature-detection helper**

Create `src/lib/supabase/config.ts`:

```ts
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
```

- [ ] **Step 3: Write the browser client**

Create `src/lib/supabase/client.ts`:

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing)."
    );
  }
  return createBrowserClient(url, anonKey);
}
```

- [ ] **Step 4: Write the server + admin clients**

Create `src/lib/supabase/server.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cookie-bound client for route handlers — respects Row Level Security via the signed-in user's session. */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing)."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a context where cookies can't be set (e.g. a Server
          // Component render); safe to ignore since middleware refreshes
          // the session on every request.
        }
      },
    },
  });
}

/** Service-role client that bypasses RLS. Only for full account deletion (Task 9) — never use for user-scoped reads/writes. */
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 5: Verify — build passes**

```bash
npm run build
```
Expected: succeeds. (These files aren't imported anywhere yet, so this mainly checks for syntax/type errors in the new files themselves — Next's build still type-checks every file under `src/`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/config.ts src/lib/supabase/client.ts src/lib/supabase/server.ts
git commit -m "Add Supabase browser/server/admin client helpers"
```

---

### Task 3: Session-refresh middleware and auth callback route

**Files:**
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/middleware.ts`
- Create: `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `createServerClient` pattern confirmed in Task 2, `isSupabaseConfigured` from `src/lib/supabase/config.ts`.
- Produces: automatic session-cookie refresh on every request; a working `/auth/callback` redirect target for the magic-link email, required before Task 4's sign-in flow can work end to end.

- [ ] **Step 1: Write the session-refresh helper**

Create `src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return response; // guest-only mode: nothing to refresh
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 2: Wire up the middleware entry point**

Create `src/middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 3: Write the magic-link callback route**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    try {
      const supabase = await createServerSupabaseClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } catch {
      // falls through to the error redirect below
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
```

- [ ] **Step 4: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Verify — dev server starts and the callback route responds**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:3000/auth/callback"
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: `HTTP 307` or `HTTP 302` (a redirect, since there's no `code` param) — not a 500. If Supabase env vars aren't set locally yet, this route will 500 inside the try/catch's `createServerSupabaseClient()` call and still redirect to the error path via the catch block, so 307/302 is expected either way.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/middleware.ts src/middleware.ts src/app/auth/callback/route.ts
git commit -m "Add Supabase session-refresh middleware and magic-link callback route"
```

---

## Phase 2 — Auth UI

Ends with: a working sign-in/sign-out flow in the browser, guest mode untouched.

### Task 4: Auth context and hook

**Files:**
- Create: `src/components/AuthProvider.tsx`

**Interfaces:**
- Consumes: `createBrowserSupabaseClient` (Task 2), `isSupabaseConfigured` (Task 2).
- Produces: `AuthProvider` (wraps the app) and `useAuth()` returning
  `{ authEnabled: boolean; user: User | null; loading: boolean; signInWithEmail: (email: string) => Promise<{ error: string | null }>; signOut: () => Promise<void> }`
  — consumed by `AppHeader` (Task 5), `DocumentCard` (Task 7), and the `/history` page (Task 10).

- [ ] **Step 1: Write the auth context**

Create `src/components/AuthProvider.tsx`:

```tsx
"use client";

import {
  createContext,
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
  authEnabled: boolean;
  user: User | null;
  loading: boolean;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  user: null,
  loading: false,
  signInWithEmail: async () => ({ error: "Not configured." }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const authEnabled = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(authEnabled);

  const supabase = useMemo(
    () => (authEnabled ? createBrowserSupabaseClient() : null),
    [authEnabled]
  );

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  const signInWithEmail = async (email: string): Promise<{ error: string | null }> => {
    if (!supabase) return { error: "Sign-in is not configured on this deployment." };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ authEnabled, user, loading, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Verify — build passes**

```bash
npm run build
```
Expected: succeeds. (Not imported into the tree yet, so this checks the file compiles in isolation.)

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "Add AuthProvider context and useAuth hook"
```

---

### Task 5: App header with sign-in/sign-out, wired into the layout

**Files:**
- Create: `src/components/AppHeader.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/UploadScreen.tsx` (remove duplicate "Folder" title, update footer copy)
- Modify: `src/components/ResultsScreen.tsx` (remove duplicate "Folder" title)

**Interfaces:**
- Consumes: `useAuth()` (Task 4).
- Produces: a single global header rendered by `layout.tsx`, so it appears identically on `/`, `/history` (Task 10), and any future route.

- [ ] **Step 1: Write the header component**

Create `src/components/AppHeader.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function AppHeader() {
  const { authEnabled, user, loading, signInWithEmail, signOut } = useAuth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
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
    <header className="border-b border-line px-6 py-4">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
        <span className="text-lg font-semibold text-ink">Folder</span>

        {!authEnabled || loading ? null : user ? (
          <div className="flex items-center gap-4 text-sm">
            <Link href="/history" className="text-ink-soft hover:text-ink">
              History
            </Link>
            <span className="font-data text-ink-soft">{user.email}</span>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-md border border-line px-3 py-1.5 text-ink-soft hover:bg-paper-raised"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-raised"
            >
              Sign in to track history
            </button>
            {panelOpen && (
              <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-line bg-paper-raised p-4 shadow-lg">
                {status === "sent" ? (
                  <p className="text-sm text-ink">
                    Check <span className="font-data">{email}</span> for a sign-in link.
                  </p>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                    <label htmlFor="signin-email" className="text-xs text-ink-soft">
                      Email
                    </label>
                    <input
                      id="signin-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
                      placeholder="you@example.com"
                    />
                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="mt-1 rounded-md bg-teal py-2 text-sm font-medium text-paper hover:bg-teal-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
                    >
                      {status === "sending" ? "Sending…" : "Send magic link"}
                    </button>
                    {status === "error" && errorMessage && (
                      <p className="text-xs text-brick">{errorMessage}</p>
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
```

- [ ] **Step 2: Wrap the app with `AuthProvider` and render `AppHeader`**

In `src/app/layout.tsx`, add the imports and wrap `{children}`:

```tsx
import type { Metadata } from "next";
import { Source_Serif_4, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import AppHeader from "@/components/AppHeader";
```

Replace the `<body>` block:

```tsx
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AuthProvider>
          <AppHeader />
          {children}
        </AuthProvider>
      </body>
```

- [ ] **Step 3: Remove the duplicate title from `UploadScreen`**

In `src/components/UploadScreen.tsx`, replace:

```tsx
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold text-ink">Folder</h1>
        <p className="mt-3 text-base text-ink-soft">
          Upload a lab report or scan — we&apos;ll pull out the numbers, flag
          anything unusual, and explain it in plain language.
        </p>
      </header>
```

with:

```tsx
      <header className="mb-10 text-center">
        <p className="text-base text-ink-soft">
          Upload a lab report or scan — we&apos;ll pull out the numbers, flag
          anything unusual, and explain it in plain language.
        </p>
      </header>
```

- [ ] **Step 4: Remove the duplicate title from `ResultsScreen`**

In `src/components/ResultsScreen.tsx`, replace:

```tsx
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-ink">Folder</h1>
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper-raised"
        >
          Start over
        </button>
      </div>
```

with:

```tsx
      <div className="mb-8 flex items-center justify-end">
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper-raised"
        >
          Start over
        </button>
      </div>
```

- [ ] **Step 5: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 6: Verify — guest mode still works with the header present**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s http://localhost:3000/ | grep -o "Folder" | head -1
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: prints `Folder`. If `NEXT_PUBLIC_SUPABASE_URL` isn't set in `.env.local` yet, the header should render with no sign-in button visible at all (guest-only mode) — confirm this visually with a browser screenshot if you have Playwright/chromium-cli available (see the pattern used earlier in this project's session history), otherwise confirm by reading `AppHeader`'s logic: `!authEnabled` renders `null` for the auth section.

- [ ] **Step 7: Commit**

```bash
git add src/components/AppHeader.tsx src/app/layout.tsx src/components/UploadScreen.tsx src/components/ResultsScreen.tsx
git commit -m "Add global AppHeader with sign-in/sign-out, dedupe page titles"
```

---

## Phase 3 — Save Flow

Ends with: a signed-in user can save a document's extracted results from the results screen.

### Task 6: `POST /api/reports` route handler

**Files:**
- Create: `src/app/api/reports/route.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (Task 2), `ExtractedDocument`/`TestResult` types (`src/lib/types.ts`, existing).
- Produces: `POST /api/reports` — request body `{ fileName: string; doctor: string | null; clinic: string | null; date: string | null; results: TestResult[] }`, response `{ id: string }` on success or `{ error: string }` with a non-2xx status. Consumed by `DocumentCard`'s save button (Task 7).

- [ ] **Step 1: Write the route handler**

Create `src/app/api/reports/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TestResult } from "@/lib/types";

interface SaveReportBody {
  fileName: string;
  doctor: string | null;
  clinic: string | null;
  date: string | null;
  results: TestResult[];
}

function isValidBody(body: unknown): body is SaveReportBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.fileName === "string" &&
    (b.doctor === null || typeof b.doctor === "string") &&
    (b.clinic === null || typeof b.clinic === "string") &&
    (b.date === null || typeof b.date === "string") &&
    Array.isArray(b.results)
  );
}

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to save reports." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Malformed report payload." }, { status: 400 });
  }

  const { data: report, error: reportError } = await supabase
    .from("saved_reports")
    .insert({
      user_id: user.id,
      file_name: body.fileName,
      doctor: body.doctor,
      clinic: body.clinic,
      report_date: body.date,
    })
    .select("id")
    .single();

  if (reportError || !report) {
    return NextResponse.json(
      { error: reportError?.message ?? "Could not save this report." },
      { status: 500 }
    );
  }

  if (body.results.length > 0) {
    const rows = body.results.map((r) => ({
      saved_report_id: report.id,
      user_id: user.id,
      test_name: r.test,
      value: r.value,
      unit: r.unit,
      reference_range: r.referenceRange,
      status: r.status,
      note: r.note,
    }));

    const { error: resultsError } = await supabase.from("saved_results").insert(rows);
    if (resultsError) {
      return NextResponse.json({ error: resultsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: report.id });
}
```

- [ ] **Step 2: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Verify — the route rejects guest requests correctly**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s -X POST http://localhost:3000/api/reports \
  -H "Content-Type: application/json" \
  -d '{"fileName":"test.pdf","doctor":null,"clinic":null,"date":null,"results":[]}'
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: `{"error":"Sign in to save reports."}` if Supabase is configured but no session cookie is sent, or a 501 config-error JSON if Supabase env vars aren't set locally yet. Either way: no 500 crash, no stack trace leaking to the response.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reports/route.ts
git commit -m "Add POST /api/reports to save an analyzed document's results"
```

---

### Task 7: "Save to my history" button on document cards

**Files:**
- Modify: `src/components/DocumentCard.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `POST /api/reports` (Task 6).
- Produces: no new exports — this is a leaf UI change. `ResultsScreen` already passes `doc` through unchanged, so no signature change propagates upward.

- [ ] **Step 1: Add save state and the save handler to `DocumentCard`**

In `src/components/DocumentCard.tsx`, add `"use client";` as the first line (the component now uses hooks), add imports, and add the save button. Full updated file:

```tsx
"use client";

import { useState } from "react";
import type { ExtractedDocument } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import { useAuth } from "./AuthProvider";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function DocumentCard({ doc }: { doc: ExtractedDocument }) {
  const { authEnabled, user } = useAuth();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: doc.fileName,
          doctor: doc.doctor,
          clinic: doc.clinic,
          date: doc.date,
          results: doc.results,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Save failed (${res.status}).`);
      }
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Could not save this report.");
    }
  };

  const canSave = authEnabled && user && !doc.error && doc.results.length > 0;

  return (
    <div className="rounded-2xl border border-line bg-paper-raised p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-4">
        <div>
          <h3 className="text-lg font-semibold text-ink">
            {doc.doctor || doc.clinic || doc.fileName}
          </h3>
          {(doc.doctor || doc.clinic) && (
            <p className="text-sm text-ink-soft">
              {[doc.doctor, doc.clinic].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right">
            <p className="font-data text-sm text-ink-soft">{doc.date || "Date unknown"}</p>
            <p className="truncate text-xs text-ink-soft">{doc.fileName}</p>
          </div>
          {canSave && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "saved"}
              className="shrink-0 rounded-md border border-teal px-3 py-1.5 text-xs font-medium text-teal hover:bg-teal/5 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-soft"
            >
              {saveState === "saved"
                ? "Saved"
                : saveState === "saving"
                  ? "Saving…"
                  : "Save to my history"}
            </button>
          )}
        </div>
      </div>

      {saveState === "error" && saveError && (
        <p className="mb-4 rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">{saveError}</p>
      )}

      {doc.error ? (
        <p className="rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">
          Couldn&apos;t read this file: {doc.error}
        </p>
      ) : doc.results.length === 0 ? (
        <p className="rounded-lg bg-ochre-bg px-4 py-3 text-sm text-ochre">
          No test values could be confidently extracted from this document.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="pb-2 pr-4 font-medium">Test</th>
                <th className="pb-2 pr-4 font-medium">Value</th>
                <th className="pb-2 pr-4 font-medium">Reference range</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {doc.results.map((r, i) => (
                <tr key={`${r.test}-${i}`} className="border-t border-line">
                  <td className="py-2.5 pr-4 text-ink">{r.test}</td>
                  <td className="py-2.5 pr-4 font-data text-ink">
                    {r.value}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className="py-2.5 pr-4 font-data text-ink-soft">
                    {r.referenceRange || "—"}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc.unclearNotes.length > 0 && (
        <div className="mt-4 rounded-lg bg-ochre-bg/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ochre">
            Couldn&apos;t read confidently
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-ink">
            {doc.unclearNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Verify — guest mode shows no save button**

Confirm by reading the logic: `canSave` requires `authEnabled && user`, both false for a guest, so `canSave` is `false` and the button doesn't render. Run the app and analyze a file as a guest to visually confirm no "Save to my history" button appears (same manual browser pattern used earlier in this project — Playwright/chromium-cli against `localhost:3000`).

- [ ] **Step 4: Commit**

```bash
git add src/components/DocumentCard.tsx
git commit -m "Add per-document 'Save to my history' button"
```

---

## Phase 4 — History Page & Deletion

Ends with: a signed-in user can view and delete their saved history.

### Task 8: `GET /api/history` route handler

**Files:**
- Create: `src/app/api/history/route.ts`
- Modify: `src/lib/types.ts` (add `SavedReport` type used by both this route and the `/history` page)

**Interfaces:**
- Consumes: `createServerSupabaseClient` (Task 2).
- Produces: `GET /api/history` → `{ reports: SavedReport[] }` (or `{ error: string }`), consumed by the `/history` page (Task 10). `SavedReport` is also imported by Task 10.

- [ ] **Step 1: Add the `SavedReport` type**

In `src/lib/types.ts`, add after the existing `AnalyzeErrorResponse` interface:

```ts
export interface SavedResult {
  id: string;
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  status: ResultStatus;
  note: string | null;
}

export interface SavedReport {
  id: string;
  fileName: string;
  doctor: string | null;
  clinic: string | null;
  date: string | null;
  savedAt: string;
  results: SavedResult[];
}
```

- [ ] **Step 2: Write the route handler**

Create `src/app/api/history/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SavedReport } from "@/lib/types";

interface SavedResultRow {
  id: string;
  test_name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  status: string;
  note: string | null;
}

interface SavedReportRow {
  id: string;
  file_name: string;
  doctor: string | null;
  clinic: string | null;
  report_date: string | null;
  created_at: string;
  saved_results: SavedResultRow[];
}

export async function GET() {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("saved_reports")
    .select(
      "id, file_name, doctor, clinic, report_date, created_at, saved_results(id, test_name, value, unit, reference_range, status, note)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as SavedReportRow[];
  const reports: SavedReport[] = rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    doctor: row.doctor,
    clinic: row.clinic,
    date: row.report_date,
    savedAt: row.created_at,
    results: row.saved_results.map((r) => ({
      id: r.id,
      test: r.test_name,
      value: r.value,
      unit: r.unit,
      referenceRange: r.reference_range,
      status: r.status as SavedReport["results"][number]["status"],
      note: r.note,
    })),
  }));

  return NextResponse.json({ reports });
}
```

- [ ] **Step 3: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 4: Verify — guest requests are rejected cleanly**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s http://localhost:3000/api/history
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: `{"error":"Not signed in."}` (or the 501 config message if Supabase env vars aren't set locally) — never a 500 with a stack trace.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/app/api/history/route.ts
git commit -m "Add GET /api/history and SavedReport type"
```

---

### Task 9: Delete routes — one report, and full account

**Files:**
- Create: `src/app/api/reports/[id]/route.ts`
- Create: `src/app/api/account/route.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`, `createAdminSupabaseClient` (Task 2).
- Produces: `DELETE /api/reports/[id]` → `{ ok: true }` or `{ error: string }`; `DELETE /api/account` → `{ ok: true }` or `{ error: string }`. Both consumed by the `/history` page (Task 10).

- [ ] **Step 1: Write the single-report delete route**

Create `src/app/api/reports/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History is not configured on this deployment." },
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

  const { error } = await supabase
    .from("saved_reports")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the full-account delete route**

Create `src/app/api/account/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase/server";

export async function DELETE() {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History is not configured on this deployment." },
      { status: 501 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not delete account." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify — build passes**

```bash
npm run build
```
Expected: succeeds. This also confirms the `RouteContext<"/api/reports/[id]">` typed-params helper (a Next.js 16 App Router feature) resolves correctly for this new dynamic route — if it doesn't compile, fall back to `{ params }: { params: Promise<{ id: string }> }` as the second argument type instead.

- [ ] **Step 4: Verify — both routes reject guest requests cleanly**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s -X DELETE http://localhost:3000/api/reports/00000000-0000-0000-0000-000000000000
curl -s -X DELETE http://localhost:3000/api/account
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: both print `{"error":"Not signed in."}` (or the 501 config message) — no 500s.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/reports/[id]/route.ts" src/app/api/account/route.ts
git commit -m "Add report and full-account deletion routes"
```

---

### Task 10: `/history` page

**Files:**
- Create: `src/app/history/page.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 4), `GET /api/history`, `DELETE /api/reports/[id]`, `DELETE /api/account` (Tasks 8-9), `SavedReport` type (Task 8).
- Produces: no exports consumed elsewhere — this is the final leaf of Phase 4.

- [ ] **Step 1: Write the history page**

Create `src/app/history/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import StatusBadge from "@/components/StatusBadge";
import type { SavedReport } from "@/lib/types";

export default function HistoryPage() {
  const { authEnabled, user, loading } = useAuth();
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch("/api/history")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Failed to load history (${res.status}).`);
        }
        return res.json();
      })
      .then((data: { reports: SavedReport[] }) => setReports(data.reports))
      .catch((err) => setFetchError(err instanceof Error ? err.message : "Failed to load history."));
  }, [user]);

  const handleDeleteReport = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Delete failed (${res.status}).`);
      }
      setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Could not delete this report.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Delete your account and all saved history? This can't be undone.")) {
      return;
    }
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Delete failed (${res.status}).`);
      }
      window.location.href = "/";
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Could not delete your account.");
      setDeletingAccount(false);
    }
  };

  if (!authEnabled) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <p className="text-ink-soft">History isn&apos;t available on this deployment.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <p className="text-ink-soft">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <p className="text-ink-soft">Sign in from the header to see your saved history.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Your history</h1>
        {reports && reports.length > 0 && (
          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deletingAccount}
            className="rounded-lg border border-brick px-4 py-2 text-sm font-medium text-brick hover:bg-brick-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deletingAccount ? "Deleting…" : "Delete all my data"}
          </button>
        )}
      </div>

      {fetchError && (
        <p className="mb-6 rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">{fetchError}</p>
      )}

      {reports === null && !fetchError && <p className="text-ink-soft">Loading…</p>}

      {reports?.length === 0 && (
        <p className="text-ink-soft">
          Nothing saved yet — analyze a report and use &quot;Save to my history&quot; to start
          tracking values over time.
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {reports?.map((report) => (
          <li key={report.id} className="rounded-2xl border border-line bg-paper-raised p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {report.doctor || report.clinic || report.fileName}
                </h2>
                <p className="font-data text-sm text-ink-soft">{report.date || "Date unknown"}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
                  className="text-sm text-teal hover:underline"
                >
                  {expandedId === report.id ? "Hide values" : "Show values"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteReport(report.id)}
                  disabled={deletingId === report.id}
                  className="text-sm text-brick hover:underline disabled:opacity-60"
                >
                  {deletingId === report.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>

            {expandedId === report.id && (
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                    <th className="border-t border-line pt-3 pb-2 pr-4 font-medium">Test</th>
                    <th className="border-t border-line pt-3 pb-2 pr-4 font-medium">Value</th>
                    <th className="border-t border-line pt-3 pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.results.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-2.5 pr-4 text-ink">{r.test}</td>
                      <td className="py-2.5 pr-4 font-data text-ink">
                        {r.value}
                        {r.unit ? ` ${r.unit}` : ""}
                      </td>
                      <td className="py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify — build passes**

```bash
npm run build
```
Expected: succeeds, and the route list now includes `/history` as a static/dynamic entry alongside `/` and `/api/*`.

- [ ] **Step 3: Verify — guest visiting `/history` sees the sign-in prompt, not a crash**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/history
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: `HTTP 200` (the page itself always renders; the "sign in" vs "loading" vs list content is a client-side branch inside it).

- [ ] **Step 4: Commit**

```bash
git add src/app/history/page.tsx
git commit -m "Add /history page with per-report and full-account deletion"
```

---

## Phase 5 — Trend Comparison

Ends with: a returning signed-in user who re-uploads a report with an overlapping test name sees a trend chart and trend-aware LLM commentary.

### Task 11: `TrendPoint`/`TestTrend` types and the history-fetch helper

**Files:**
- Modify: `src/lib/types.ts` (add `TrendPoint`, `TestTrend`; extend `AnalyzeResponse`)
- Create: `src/lib/supabase/history.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (passed in by the caller, Task 12), `ResultStatus` (existing).
- Produces: `TrendPoint`, `TestTrend`, `AnalyzeResponse.trends: TestTrend[]` (consumed by `/api/analyze` Task 12 and `DocumentCard` Task 14); `fetchTestHistory(supabase, userId, testNames): Promise<TestTrend[]>` (consumed by Task 12).

- [ ] **Step 1: Add the trend types and extend `AnalyzeResponse`**

In `src/lib/types.ts`, add after the `SavedReport`/`SavedResult` interfaces added in Task 8:

```ts
export interface TrendPoint {
  value: string;
  unit: string | null;
  status: ResultStatus;
  reportDate: string | null;
  savedAt: string;
}

export interface TestTrend {
  testName: string;
  points: TrendPoint[]; // oldest -> newest, prior saved history only
}
```

Then modify the existing `AnalyzeResponse` interface to add the new field:

```ts
export interface AnalyzeResponse {
  documents: ExtractedDocument[];
  overallSummary: string;
  crossDocumentRelation: CrossDocumentRelation;
  trends: TestTrend[];
}
```

- [ ] **Step 2: Write the history-fetch helper**

Create `src/lib/supabase/history.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultStatus, TestTrend } from "@/lib/types";

interface SavedResultHistoryRow {
  test_name: string;
  value: string;
  unit: string | null;
  status: string;
  created_at: string;
  saved_reports: { report_date: string | null } | { report_date: string | null }[] | null;
}

/**
 * Fetches this user's saved test history, filtered (case-insensitively) to
 * the given test names. Returns [] on any error — callers must treat trend
 * data as best-effort and never fail the caller's own request over it.
 */
export async function fetchTestHistory(
  supabase: SupabaseClient,
  userId: string,
  testNames: string[]
): Promise<TestTrend[]> {
  if (testNames.length === 0) return [];

  const { data, error } = await supabase
    .from("saved_results")
    .select("test_name, value, unit, status, created_at, saved_reports(report_date)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const wantedLower = new Set(testNames.map((t) => t.toLowerCase()));
  const byTest = new Map<string, TestTrend>();

  for (const row of data as unknown as SavedResultHistoryRow[]) {
    const lower = row.test_name.toLowerCase();
    if (!wantedLower.has(lower)) continue;

    if (!byTest.has(lower)) {
      byTest.set(lower, { testName: row.test_name, points: [] });
    }

    const reportRelation = Array.isArray(row.saved_reports)
      ? row.saved_reports[0]
      : row.saved_reports;

    byTest.get(lower)!.points.push({
      value: row.value,
      unit: row.unit,
      status: row.status as ResultStatus,
      reportDate: reportRelation?.report_date ?? null,
      savedAt: row.created_at,
    });
  }

  return [...byTest.values()];
}
```

- [ ] **Step 3: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/supabase/history.ts
git commit -m "Add TrendPoint/TestTrend types and fetchTestHistory helper"
```

---

### Task 12: Wire history fetch into `/api/analyze`

**Files:**
- Modify: `src/app/api/analyze/route.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (Task 2), `fetchTestHistory` (Task 11), updated `synthesizeSummary` signature (Task 13 — write this task's code assuming the Task 13 signature below; Task 13 must be completed before this task's build will type-check if done out of order, so keep these two tasks together in execution order).
- Produces: `AnalyzeResponse.trends` populated for signed-in users; still `[]` for guests. Consumed by `DocumentCard` (Task 14).

- [ ] **Step 1: Update the route to fetch the current user, gather test names, fetch history, and pass it through**

In `src/app/api/analyze/route.ts`, update the imports at the top:

```ts
import { NextResponse } from "next/server";
import { pdfToPngPages } from "@/lib/pdf";
import { extractDocument, synthesizeSummary } from "@/lib/groq";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchTestHistory } from "@/lib/supabase/history";
import type { AnalyzeResponse, ExtractedDocument, TestTrend } from "@/lib/types";
```

Replace the `POST` function body from `const documents = await Promise.all(...)` onward with:

```ts
  const documents = await Promise.all(files.map(extractOne));

  const usableDocuments = documents.filter((d) => !d.error);

  let trends: TestTrend[] = [];
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const testNames = [
        ...new Set(usableDocuments.flatMap((d) => d.results.map((r) => r.test))),
      ];
      trends = await fetchTestHistory(supabase, user.id, testNames);
    }
  } catch {
    // Supabase not configured, or the history fetch failed — guest-safe
    // fallback: proceed with no trend data rather than failing analysis.
    trends = [];
  }

  let overallSummary = "";
  let crossDocumentRelation: AnalyzeResponse["crossDocumentRelation"] = {
    found: false,
    description: null,
    involvedTests: [],
  };

  if (usableDocuments.length > 0) {
    try {
      const synthesis = await synthesizeSummary(documents, trends);
      overallSummary = synthesis.overallSummary;
      crossDocumentRelation = synthesis.crossDocumentRelation;
    } catch (err) {
      overallSummary =
        "We extracted the test values below, but couldn't generate a plain-language summary right now. " +
        (err instanceof Error ? err.message : "Please try again.");
    }
  } else {
    overallSummary =
      "None of the uploaded files could be read. See the notes below for details.";
  }

  const response: AnalyzeResponse = {
    documents,
    overallSummary,
    crossDocumentRelation,
    trends,
  };

  return NextResponse.json(response);
}
```

- [ ] **Step 2: Verify — build passes (after Task 13 is also done)**

```bash
npm run build
```
Expected: succeeds. This will fail to type-check until Task 13's `synthesizeSummary(documents, trends)` two-argument signature exists — that's expected and fine if you're executing tasks in order; just don't consider Task 12 done until this build is clean.

- [ ] **Step 3: Verify — guest analysis still works and returns `trends: []`**

```bash
npm run dev > /tmp/folder-dev.log 2>&1 &
sleep 3
# Reuse the tiny placeholder PNG created earlier in this project's session,
# or any small JPG/PNG on disk, in place of /path/to/test-image.png:
curl -s -X POST http://localhost:3000/api/analyze -F "files=@/path/to/test-image.png" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log('trends:', JSON.stringify(j.trends));
});"
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```
Expected: `trends: []` for a guest request (no session cookie sent).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/analyze/route.ts
git commit -m "Fetch matching test history for signed-in users during analysis"
```

---

### Task 13: Trend-aware synthesis prompt in `groq.ts`

**Files:**
- Modify: `src/lib/groq.ts`

**Interfaces:**
- Consumes: `TestTrend` type (Task 11).
- Produces: `synthesizeSummary(documents: ExtractedDocument[], history: TestTrend[] = [])` — the two-argument signature Task 12 already calls.

- [ ] **Step 1: Import `TestTrend` and update the synthesis prompt**

In `src/lib/groq.ts`, update the type import:

```ts
import type { ExtractedDocument, CrossDocumentRelation, TestTrend } from "./types";
```

Replace the `SYNTHESIS_SYSTEM_PROMPT` constant with:

```ts
const SYNTHESIS_SYSTEM_PROMPT = `You are a careful, plain-language health-report assistant helping a layperson (often an adult child worried about a parent's health) understand lab results that have already been extracted from one or more documents. You are NOT a doctor and must never diagnose, speculate about causes, or recommend treatment.

You will be given the structured extraction (JSON) for one or more documents, and optionally a block of the same user's prior saved test history from earlier visits. Respond with STRICT JSON ONLY matching exactly this shape:

{
  "overallSummary": string,
  "crossDocumentRelation": {
    "found": boolean,
    "description": string | null,
    "involvedTests": string[]
  }
}

Rules:
- "overallSummary" is 2-4 plain-language sentences, calm and reassuring in tone, summarizing what was found across all documents combined (how many values were in range / out of range / unclear, and in plain words what stands out). No medical jargon without a plain-language gloss.
- "crossDocumentRelation" is used for TWO kinds of patterns — treat both the same way:
  (a) a relationship between values across different documents in THIS batch, or
  (b) a meaningful trend for the same test across the user's prior saved history and this batch (e.g. a value that has moved in the same direction across 2+ prior visits plus this one).
  Only set "found" to true when you can point to a genuine, specific instance of (a) or (b) — never invent one. If neither applies, set "found" to false, "description" to null, and "involvedTests" to [].
- When "found" is true, phrase "description" as an observation to raise with a doctor, never as a diagnosis or conclusion (e.g. "X and Y both moved in a related direction across these reports — this pattern may be worth mentioning to a doctor," not "this means..."). If the pattern is a multi-visit trend (case b), say so explicitly (e.g. "Across your last 3 saved reports, X has been trending upward...").
- Output only the JSON object, nothing else.`;
```

- [ ] **Step 2: Update `synthesizeSummary`'s signature and prompt body**

Replace the `synthesizeSummary` function with:

```ts
export async function synthesizeSummary(
  documents: ExtractedDocument[],
  history: TestTrend[] = []
): Promise<{ overallSummary: string; crossDocumentRelation: CrossDocumentRelation }> {
  const client = getClient();

  const payload = documents.map((doc) => ({
    fileName: doc.fileName,
    doctor: doc.doctor,
    clinic: doc.clinic,
    date: doc.date,
    results: doc.results,
    unclearNotes: doc.unclearNotes,
    error: doc.error,
  }));

  const historyBlock =
    history.length > 0
      ? `\n\nThis user also has prior saved history for some of these tests (oldest to newest, from earlier visits, not part of this upload):\n\n${JSON.stringify(
          history,
          null,
          2
        )}`
      : "";

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is the extracted data from ${documents.length} document(s):\n\n${JSON.stringify(payload, null, 2)}${historyBlock}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = parseJsonResponse<{
    overallSummary: string;
    crossDocumentRelation: CrossDocumentRelation;
  }>(raw);

  return {
    overallSummary: parsed.overallSummary ?? "",
    crossDocumentRelation: parsed.crossDocumentRelation ?? {
      found: false,
      description: null,
      involvedTests: [],
    },
  };
}
```

- [ ] **Step 3: Verify — build passes**

```bash
npm run build
```
Expected: succeeds — this also resolves Task 12's build (both tasks' code now match on the two-argument signature).

- [ ] **Step 4: Commit**

```bash
git add src/lib/groq.ts
git commit -m "Extend synthesis prompt to cover multi-visit trend history"
```

---

### Task 14: Trend sparkline in document cards

**Files:**
- Create: `src/components/TrendSparkline.tsx`
- Modify: `src/components/DocumentCard.tsx`
- Modify: `src/components/ResultsScreen.tsx` (pass `trends` down)

**Interfaces:**
- Consumes: `TestTrend`, `TrendPoint` (Task 11), Recharts (existing dependency).
- Produces: no new exports consumed elsewhere — final leaf of Phase 5.

- [ ] **Step 1: Write the sparkline component**

Create `src/components/TrendSparkline.tsx`:

```tsx
"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/types";

const STATUS_COLOR: Record<TrendPoint["status"], string> = {
  in_range: "#4c6e52",
  out_of_range: "#9c4638",
  unclear: "#a8752e",
};

interface TrendSparklineProps {
  points: TrendPoint[]; // prior history, oldest -> newest
  current: { value: string; status: TrendPoint["status"] };
}

export default function TrendSparkline({ points, current }: TrendSparklineProps) {
  const series = [...points, { value: current.value, status: current.status }];
  const numeric = series.map((p) => Number.parseFloat(p.value));

  if (numeric.some((n) => Number.isNaN(n))) {
    // Non-numeric values (e.g. "Positive"/"Negative") can't be charted —
    // fall back to a compact text trail instead of a broken chart.
    return (
      <span className="font-data text-xs text-ink-soft">
        history: {points.map((p) => p.value).join(" → ")} → {current.value}
      </span>
    );
  }

  const data = numeric.map((value, i) => ({ value, status: series[i].status }));
  const latestColor = STATUS_COLOR[current.status];

  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={latestColor}
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Render the sparkline per matching row in `DocumentCard`**

In `src/components/DocumentCard.tsx`, add the import and a `trends` prop, and render `TrendSparkline` in a new table column when a row's test has matching history.

Update the imports:

```tsx
import type { ExtractedDocument, TestTrend } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import { useAuth } from "./AuthProvider";
import TrendSparkline from "./TrendSparkline";
```

Update the component signature:

```tsx
export default function DocumentCard({
  doc,
  trends,
}: {
  doc: ExtractedDocument;
  trends: TestTrend[];
}) {
```

Add a lookup helper right after the existing `canSave` line:

```tsx
  const trendFor = (testName: string) =>
    trends.find((t) => t.testName.toLowerCase() === testName.toLowerCase());
```

In the results table, add a "Trend" header cell after the existing "Status" header:

```tsx
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 pl-4 font-medium">Trend</th>
```

And a corresponding data cell after the existing status `<td>` in the row map:

```tsx
                  <td className="py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-2.5 pl-4">
                    {(() => {
                      const trend = trendFor(r.test);
                      return trend && trend.points.length > 0 ? (
                        <TrendSparkline
                          points={trend.points}
                          current={{ value: r.value, status: r.status }}
                        />
                      ) : null;
                    })()}
                  </td>
```

- [ ] **Step 3: Pass `trends` down from `ResultsScreen`**

In `src/components/ResultsScreen.tsx`, update the `DocumentCard` usage:

```tsx
        {result.documents.map((doc, i) => (
          <DocumentCard key={`${doc.fileName}-${i}`} doc={doc} trends={result.trends} />
        ))}
```

- [ ] **Step 4: Verify — build passes**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Verify — full end-to-end trend flow**

Manual browser steps (no automatable command — Supabase project and a real signed-in session are required):
1. Sign in via the header's magic link flow.
2. Upload and analyze a report with at least one test result; click "Save to my history" on its document card.
3. Upload and analyze a second report containing at least one test with the same name (case-insensitive) as the first.
4. Confirm: that test's row now shows a small trend line (or the text fallback for non-numeric values) next to its status badge, and the summary/callout section mentions the trend when the model finds a genuine one.

- [ ] **Step 6: Commit**

```bash
git add src/components/TrendSparkline.tsx src/components/DocumentCard.tsx src/components/ResultsScreen.tsx
git commit -m "Render trend sparklines for test results with matching history"
```

---

## Phase 6 — Privacy Copy & Docs

Ends with: user-facing copy and README accurately describe the new save/history behavior.

### Task 15: Update privacy copy and README

**Files:**
- Modify: `src/components/UploadScreen.tsx` (footer copy)
- Modify: `README.md`

**Interfaces:**
- None — copy-only changes, no code interfaces affected.

- [ ] **Step 1: Update the upload screen's privacy footer**

In `src/components/UploadScreen.tsx`, replace:

```tsx
      <p className="mt-4 text-center text-xs text-ink-soft">
        Files are processed to extract test values and are not stored after your session.
      </p>
```

with:

```tsx
      <p className="mt-4 text-center text-xs text-ink-soft">
        Files are never stored. Extracted values are only saved if you sign in
        and choose &quot;Save to my history&quot; on the results screen.
      </p>
```

- [ ] **Step 2: Add a "Data & privacy" section to the README**

In `README.md`, add a new section after the existing "Notes & limits" section (find that heading and insert immediately after its bullet list, before "## Tech stack"):

```markdown
## Data & privacy

- Original uploaded files (PDF/image) are never stored, with or without an
  account — they're processed in memory for the request and discarded.
- Signing in (email magic link, via Supabase) is optional. Guest use is
  unaffected: no login wall, nothing saved, no history/trend features.
- If you sign in, nothing is saved automatically. Only extracted values from
  documents you explicitly click "Save to my history" on are persisted
  (test name, value, unit, reference range, status, doctor, clinic, document
  date) — never the original file.
- Saved data lives in your own Supabase project's Postgres database, scoped
  to your account via Row Level Security (see `src/lib/supabase/schema.sql`).
- Delete a single saved report, or all of it, any time from the `/history`
  page. Deletion is immediate and permanent (cascading foreign-key deletes,
  not a soft-delete flag).

### Supabase setup (optional — only needed for sign-in/history)

1. Create a free project at <https://supabase.com>.
2. In the Supabase dashboard, open **SQL Editor → New query**, paste the
   contents of `src/lib/supabase/schema.sql`, and run it.
3. In **Project Settings → API**, copy the Project URL, `anon` public key,
   and `service_role` secret key into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — keep this out of any
     client-exposed context)
4. Restart the dev server. The header's "Sign in to track history" button
   should now appear (it's hidden entirely when these env vars are absent).
5. On Netlify, add the same three variables under **Site configuration →
   Environment variables**, then redeploy.

Note: Supabase's default built-in email sending has low rate limits and can
land in spam. Fine for personal use; for anything beyond that, configure
custom SMTP (e.g. via Resend) in the Supabase dashboard's Auth settings.
```

- [ ] **Step 3: Verify — build passes**

```bash
npm run build
```
Expected: succeeds (copy-only changes shouldn't affect this, but confirms nothing was accidentally broken while editing).

- [ ] **Step 4: Commit**

```bash
git add src/components/UploadScreen.tsx README.md
git commit -m "Update privacy copy and README for optional history/save feature"
```

---

## Post-plan regression check

After all 15 tasks: run through the spec's own Testing Approach end to end once — guest upload/analyze, sign-in, save, re-upload with overlapping test name, delete one report, delete all data — and confirm `npm run build` is clean on the final state of the branch.
