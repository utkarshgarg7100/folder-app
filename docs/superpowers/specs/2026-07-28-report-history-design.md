# Report History & Trend Comparison — Design

Status: Approved. Date: 2026-07-28.

## Problem

Folder currently analyzes uploads statelessly: nothing is persisted, and each
analysis only compares values *within* the batch of files uploaded in a single
session. There is no way to see how a test result has changed across visits
over time (e.g. "this value has been on this direction for the last 3
reports"), which is exactly the kind of signal a worried family member wants.

## Goals

- Let a user optionally save extracted results from an analysis, tied to
  their identity, so future analyses can reference past values for the same
  test.
- When a returning user's new upload includes a test they have history for,
  show a trend view for that test and have the plain-language summary call
  out genuine multi-visit trends (never a diagnosis).
- Preserve the existing guest experience exactly as-is: no login required to
  use the app, nothing saved unless the user explicitly opts in.

## Non-goals

- No storage of original uploaded files (PDF/image) — only structured
  extracted values are persisted.
- No sharing of history between users (e.g. a "family account" multiple
  people can see) — out of scope for this iteration.
- No password-based auth — email magic link only.

## Architecture

- **Supabase** is added as the persistence + auth layer:
  - Postgres for storage.
  - Supabase Auth (email magic link) for identity — no custom auth code, no
    separate transactional-email service to wire up.
- New environment variables (server-side unless noted):
  - `NEXT_PUBLIC_SUPABASE_URL` — client-safe, needed by the browser auth
    helper to redirect through the magic-link flow.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client-safe, respects Row Level
    Security; used for the auth flow itself.
  - `SUPABASE_SERVICE_ROLE_KEY` — server-only, used in `/api/*` route
    handlers for reads/writes scoped to the authenticated user. Never sent
    to the browser bundle (same pattern as `GROQ_API_KEY` today).
- The app remains guest-usable: the upload screen has no login wall. A
  small "Sign in to track history" affordance appears in the page header.
  Logged-out use is functionally identical to the app's current behavior —
  nothing persisted, no history, no trend data.
- We never store the original uploaded file. Only the structured extraction
  (test name, value, unit, reference range, status, doctor, clinic, document
  date) is persisted, and only when the user explicitly saves. This keeps
  the app's existing "we don't store your files" promise intact; the updated
  framing becomes "we don't store your files — if you save a report, we keep
  the extracted values, not the document."

## Data model (Supabase Postgres)

```
profiles
  id            uuid primary key references auth.users(id)
  email         text not null
  created_at    timestamptz not null default now()

saved_reports
  id            uuid primary key default gen_random_uuid()
  user_id       uuid not null references profiles(id) on delete cascade
  file_name     text not null
  doctor        text
  clinic        text
  report_date   text          -- as printed on the document; not normalized
  created_at    timestamptz not null default now()

saved_results
  id                  uuid primary key default gen_random_uuid()
  saved_report_id     uuid not null references saved_reports(id) on delete cascade
  user_id             uuid not null references profiles(id) on delete cascade  -- denormalized for RLS + trend queries
  test_name           text not null
  value               text not null
  unit                text
  reference_range     text
  status              text not null check (status in ('in_range','out_of_range','unclear'))
  note                text
  created_at          timestamptz not null default now()

index on saved_results (user_id, test_name, created_at)
```

Row Level Security is enabled on all three tables: policies restrict every
select/insert/delete to rows where `user_id = auth.uid()`. This is enforced
by Supabase itself, so route handlers don't need custom authorization
checks beyond passing the authenticated user's session through.

`test_name` matching for trends is a case-insensitive exact string match
against prior `saved_results.test_name` values for that user (e.g.
"Vitamin D" vs "vitamin d" both match; "Vitamin D3" would not). This is a
deliberate simplification — no fuzzy/synonym matching in this iteration.

## Auth flow

1. User clicks "Sign in" in the header → a small modal/panel asks for their
   email.
2. `supabase.auth.signInWithOtp({ email })` (magic link mode) is called
   client-side via the Supabase JS SDK. Supabase sends the email.
3. User clicks the link, lands back on the app already authenticated;
   Supabase's `@supabase/ssr` cookie-based session helper makes the session
   available to both client components and server route handlers.
4. Route handlers (`/api/reports`, `/api/history`) read the session
   server-side to get `user_id`; requests with no valid session are treated
   as guest requests (for `/api/analyze`) or rejected with 401 (for the new
   history routes, which have no meaningful guest behavior).

Note: Supabase's default built-in email sending has low rate limits and can
land in spam; fine for development and light personal use, but production
use at any real volume should configure custom SMTP (e.g. via Resend) in
the Supabase dashboard. This is a dashboard configuration step, not an app
code change, so it's called out here rather than built now.

## Save & history flow

- On the results screen, if the user is logged in, each document card gets
  a **"Save to my history"** button (per-document — a user can save some
  documents from a batch and not others).
  - `POST /api/reports` — body: the one document's `ExtractedDocument`
    (fileName, doctor, clinic, date, results[]). Inserts one `saved_reports`
    row and N `saved_results` rows in a transaction. Returns the saved
    report id; the button changes to a disabled "Saved" state.
- A new **History** page (`/history`) lists the logged-in user's saved
  reports (most recent first), each expandable to show its saved values.
  Each report has a delete action (`DELETE /api/reports/[id]`) which cascade
  deletes its results. A separate "Delete all my data" action in account
  settings removes every row for that user (and can also delete the
  Supabase auth user itself, fully closing the account).

## Comparison feature (chart + LLM commentary)

1. In `/api/analyze`, after per-document extraction succeeds, if the request
   has an authenticated user, fetch prior `saved_results` for that user
   filtered to the test names appearing in this batch
   (`GET`-equivalent internal query, not a public route):
   `{ testName, value, unit, status, reportDate, savedAt }[]`, ordered
   oldest → newest, per test.
2. This history is passed into the existing synthesis call
   (`synthesizeSummary` in `src/lib/groq.ts`) as an additional input block
   alongside the current batch's extracted documents. The prompt is
   extended to instruct the model: mention a genuine multi-visit trend in
   `overallSummary` (or the existing `crossDocumentRelation` structure,
   which already carries the "pattern to raise with a doctor, not a
   diagnosis" framing) only when the historical values actually show one —
   same anti-hallucination discipline as the existing same-batch relation
   check.
3. On the results screen, any test in a document card that has matching
   history gets a small inline trend view (Recharts sparkline/line: value
   over time, including the new value) rendered next to that row.
4. Guest (not logged-in) uploads behave exactly as today: no history fetch,
   no trend chart, no trend-aware prompt content, and the existing
   same-batch `crossDocumentRelation` logic is unchanged.

## Privacy & data controls

- Upload screen and results screen copy is updated to accurately describe
  the new behavior: files are never stored; extracted values are only
  stored if the user is signed in and explicitly saves a document; saved
  data can be deleted at any time from the History page.
- Account/data deletion is a real delete (cascade via foreign keys), not a
  soft-delete flag.
- README gets a new "Data & privacy" section documenting exactly what is
  stored, where (Supabase project, region depends on user's project
  settings), and how to delete it.

## Error handling

- If Supabase env vars are absent, the app runs in guest-only mode: the
  "Sign in" affordance is hidden entirely (feature-detected at startup),
  rather than showing a broken login button. This matches the existing
  pattern of the app failing gracefully rather than crashing when
  `GROQ_API_KEY` is missing.
- Save/delete failures surface as an inline error near the action button
  (not a silent failure, not a full-page error) — consistent with the
  existing per-document error surfacing on the results screen.
- History fetch failures during analysis (Supabase down, etc.) must not
  fail the whole analysis — the app falls back to same-batch-only behavior
  and the trend feature is silently skipped for that request.

## Testing approach

- Manual verification (per the project's existing pattern — this app has no
  automated test suite yet): guest upload/analyze unaffected; sign-in flow
  end to end; save a report, re-upload a report with an overlapping test
  name, confirm trend chart + LLM commentary appear; delete a report and
  confirm it disappears from history and no longer feeds future trends;
  delete all data and confirm a fresh account state.
- `npm run build` must stay clean (as it does today) after the new Supabase
  client/server helpers and routes are added.

## Open items deferred to later iterations (explicitly out of scope now)

- Fuzzy/synonym matching of test names across differently-worded reports.
- Multi-user "family" accounts / shared history.
- Custom SMTP configuration for magic-link email deliverability at scale.
