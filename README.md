# Folder — health report summarizer

Upload one or more medical reports (PDF or JPG/PNG). Folder sends each one to a
vision-capable LLM, extracts the test results, flags anything outside the normal
reference range, and — when more than one report is uploaded — checks whether
values across the reports relate to each other. Results are shown as a
plain-language summary, a chart, and a per-document table, never a diagnosis.

## How it works

- **Frontend** (`src/app/page.tsx`, `src/components/*`): upload screen with
  drag-and-drop, then a results screen with a summary, an optional cross-document
  callout, a donut chart (Recharts), and one card per document.
- **Backend** (`src/app/api/analyze/route.ts`): the only place that talks to the
  LLM. It accepts multipart form data, rasterizes any PDF pages to PNGs
  (`src/lib/pdf.ts`), base64-encodes each page, and calls the Groq API
  (`src/lib/groq.ts`) with a vision-capable model. The model's JSON is
  parsed with a `try/catch`; parsing failures surface as a clear error rather
  than a guessed result.
- **Model**: [Groq](https://console.groq.com) hosting `qwen/qwen3.6-27b`
  (configurable via `GROQ_MODEL`), a vision-capable model with JSON mode and a
  free developer tier. Groq accepts at most 3 images per request on this
  model, so multi-page PDFs are capped at their first 3 pages (a note is
  added to the document if it was truncated). Two calls are made per
  analysis: one per uploaded document to extract test values, and one
  synthesis call across all documents to produce the plain-language summary
  and check for a cross-document pattern.

  Groq periodically deprecates/renames models (this app originally used
  `meta-llama/llama-4-scout-17b-16e-instruct`, deprecated June 2026) — if
  extraction starts failing with a `model_not_found` error, check
  <https://console.groq.com/docs/models> for the current vision-capable model
  and set `GROQ_MODEL` accordingly.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the env template and add your key:
   ```bash
   cp .env.example .env.local
   ```
   Get a free Groq API key at <https://console.groq.com/keys> and set it as
   `GROQ_API_KEY` in `.env.local`. This file is gitignored and is only read
   server-side (`src/lib/groq.ts`) — it is never bundled into the frontend.
3. Run the dev server:
   ```bash
   npm run dev
   ```
   Open <http://localhost:3000>.

## Deploying to Netlify

1. Push this repo to GitHub (already done if you're reading this from the
   deployed repo).
2. In the [Netlify dashboard](https://app.netlify.com), click **Add new site
   → Import an existing project**, pick this repo, and authorize the GitHub
   connection. Netlify auto-detects Next.js via `netlify.toml`
   (`@netlify/plugin-nextjs`) — no build settings to change.
3. Before (or right after) the first deploy, go to **Site configuration →
   Environment variables** and add:
   - `GROQ_API_KEY` — your Groq API key
   - `GROQ_MODEL` — optional, only if you want to override the default model
   Do **not** put these in the repo — Netlify injects them at build/runtime
   only. Redeploy after adding them if the first deploy already ran.
4. Deploy. `/api/analyze` runs as a Netlify Function. Netlify's default
   function timeout is **10 seconds** (up to 26s on some paid plans), which
   can be tight for multiple documents or multi-page PDFs since each document
   makes its own LLM call. If you hit timeouts, try fewer/smaller files first,
   or check Netlify's current function timeout limits for your plan.

   (The `maxDuration` export in `src/app/api/analyze/route.ts` is a
   Vercel-specific Next.js config Netlify ignores — harmless to leave in, but
   it doesn't extend the timeout here.)

## Notes & limits

- Accepted file types: PDF, JPG, PNG. Max 15 MB per file.
- Files are processed in memory for the duration of the request and are not
  persisted anywhere.
- Anything the model can't read confidently is surfaced explicitly in the UI
  (`unclearNotes` per document, `"unclear"` status per value) — it is never
  silently guessed.
- The cross-document callout is always labeled "a pattern to raise with a
  doctor," never a diagnosis, and only appears when 2+ documents are uploaded
  and the model finds a genuine relationship.

## Data & privacy

- Original uploaded files (PDF/image) are never stored, with or without an
  account — they're processed in memory for the request and discarded.
- Signing in (email magic link, via Supabase) is optional. Guest use is
  unaffected: no login wall, nothing saved, no history/trend features.
- If you sign in, nothing is saved automatically. Data is persisted only for
  documents you explicitly click "Save to my history" on. What's stored is:
  - per document — the **file name**, doctor, clinic and document date;
  - per test value — test name, value, unit, reference range, status and any
    note the model attached.

  The file itself is never uploaded or retained. Note that the file *name* is
  stored as you named it, so rename anything you'd rather not keep (e.g.
  `mum-bloodwork-jan.pdf`) before saving.
- Saved data lives in your own Supabase project's Postgres database, scoped
  to your account via Row Level Security (see `src/lib/supabase/schema.sql`).
  RLS — not application-level filtering — is what isolates one account's data
  from another's.
- Extracted values (and, for signed-in users, matching values from your saved
  history) are sent to Groq's API for summarization. Original files are not.
- Delete a single saved report, or your entire account and all its data, any
  time from the `/history` page. Deletion is immediate and permanent
  (cascading foreign-key deletes, not a soft-delete flag).

### Supabase setup (optional — only needed for sign-in/history)

1. Create a free project at <https://supabase.com>.
2. In the Supabase dashboard, open **SQL Editor → New query**, paste the
   contents of `src/lib/supabase/schema.sql`, and run it.
3. In **Project Settings → API**, copy the Project URL, `anon` public key,
   and `service_role` secret key into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — this key bypasses Row Level
     Security entirely, so it must never reach a `NEXT_PUBLIC_*` variable or
     any client-exposed context)
4. Restart the dev server. The header's sign-in button should now appear (it's
   hidden entirely when these env vars are absent).
5. On Netlify, add the same three variables under **Site configuration →
   Environment variables**, then redeploy. Note that `NEXT_PUBLIC_*` values are
   inlined at build time, so they require a rebuild, not just a restart.

Note: Supabase's default built-in email sending has low rate limits and can
land in spam. Fine for personal use; for anything beyond that, configure
custom SMTP (e.g. via Resend) in the Supabase dashboard's Auth settings.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · Recharts · groq-sdk ·
pdf-to-img (PDF → PNG rasterization). Fonts: Source Serif 4 (headings), Inter
(body), IBM Plex Mono (data values).
