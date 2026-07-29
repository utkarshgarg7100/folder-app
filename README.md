# Folder — health report summarizer

Upload one or more medical reports (PDF or JPG/PNG). Folder sends each one to a
vision-capable LLM, extracts the test results, flags anything outside the normal
reference range, and — when more than one report is uploaded — checks whether
values across the reports relate to each other. Results are shown as a
plain-language summary, a chart, and a per-document table, never a diagnosis.

Signing in is optional and adds saved history plus trend comparison across
visits. Guests are unaffected: no login wall, nothing stored.

> **Reviewing this project?** See **[REVIEWING.md](REVIEWING.md)** for a guided
> walkthrough, the reasoning behind the non-obvious decisions, and an honest
> list of known limitations.

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

## Deploying

**Deploy to Vercel.** This is a hosting requirement, not a preference: a
single analysis makes two sequential vision-model calls and takes **15-30s**
(measured: extraction ~10s, synthesis ~6s, rasterizing <1s). Netlify caps
synchronous functions at **10s** (26s on paid plans), so `/api/analyze` times
out there. Vercel supports the `maxDuration = 60` already exported by
`src/app/api/analyze/route.ts`.

`netlify.toml` is kept in the repo so Netlify remains an option if the request
is ever split into separate extraction and synthesis endpoints, which would
bring each stage under the limit.

1. Push this repo to GitHub.
2. At [vercel.com/new](https://vercel.com/new), import the repo. Next.js is
   auto-detected — no build settings to change.
3. **Add environment variables before the first build**, under Settings →
   Environment Variables:
   - `GROQ_API_KEY` — required
   - `GROQ_MODEL` — optional, overrides the default model
   - `NEXT_PUBLIC_SUPABASE_URL` — only for sign-in/history
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — only for sign-in/history
   - `SUPABASE_SERVICE_ROLE_KEY` — only for sign-in/history; server-only, and
     it bypasses Row Level Security, so never expose it to the client

   `NEXT_PUBLIC_*` values are **inlined at build time**, so adding them after a
   deploy requires a *rebuild*, not just a restart. A build made without them
   ships with auth silently disabled.
4. In Supabase, set the **Magic Link** and **Confirm signup** email templates to
   deliver the code rather than a link — the body must contain `{{ .Token }}`
   (the code itself) and no `{{ .ConfirmationURL }}` link. Sign-in asks the
   user to type that code. Its length is set by **Authentication → Sign In /
   Providers → Email OTP Length** (6–10); the UI does not assume a length.

   No **Redirect URLs** entry is needed, because nothing redirects. Sign-in is
   deliberately a typed code, not a magic link: a link carries a single-use
   token in a URL, and mail providers fetch that URL to screen it before the
   recipient clicks. That fetch spends the token, so the real click always
   arrives too late. A typed code can't be consumed by anything that merely
   reads the email.

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
- Signing in (emailed sign-in code, via Supabase) is optional. Guest use is
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
