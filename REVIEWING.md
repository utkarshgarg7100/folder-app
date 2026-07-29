# Reviewing this project

A walkthrough of what to look at and how to exercise it. Roughly 10 minutes.

## What this is

Upload a lab report (PDF/JPG/PNG) and get its test values extracted and
explained in plain language. Optionally sign in to save reports and see how a
given test has moved across visits.

The guiding constraint throughout: **this shows medical data to a worried
layperson, so it must never guess, never overstate, and never leak one person's
results to another.** Most of the design decisions below follow from that.

## Try it (hosted)

No account needed for the core flow.

1. **Guest analysis** — upload a lab report.
   - Values are extracted with a status per row (in range / out of range /
     unclear), plus a plain-language summary.
   - Anything the model could not read confidently is surfaced explicitly
     rather than silently guessed.
   - Note there is **no Trend column** and no login wall. Guests are
     first-class; nothing is stored.
2. **Sign in** via the header (email magic link).
3. **Analyze a report → "Save to my history."** Nothing is saved automatically.
4. **Analyze a second report that shares a test name.** That test's row now
   shows a small **trend sparkline** — prior saved values plus this one.
   - A non-numeric value (`Positive`, `120/80`, `1,200`) shows a text trail
     instead. See "Extraction and charting" below for why.
5. **`/history`** — expand a report to see its values, delete a single report,
   or delete your account and all its data.

## Run it locally

Needs Node 20+, a Groq API key, and (optionally) a Supabase project.

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

Only `GROQ_API_KEY` is required. Without the Supabase variables the app runs
in guest-only mode — sign-in is hidden entirely rather than failing. That path
is worth checking: the feature degrades rather than breaking.

For sign-in and history, create a free Supabase project and run
`src/lib/supabase/schema.sql` in its SQL editor. Full steps are in the README
under "Supabase setup".

## Where the interesting decisions are

**Authorization — `src/lib/supabase/schema.sql`**
Row Level Security is the actual boundary between accounts, not the
application's `.eq("user_id", ...)` filters. This was verified empirically:
with the application filter removed, a query still returned zero of another
user's rows. The filters are kept as defence in depth and to help the index,
not as the security mechanism. RLS is also enforced per child row on nested
selects, confirmed with a planted canary row.

The `service_role` key bypasses RLS entirely, so it is confined to
`src/lib/supabase/server.ts`, used only for account deletion, and never
reaches a `NEXT_PUBLIC_*` variable or any client bundle.

**Extraction and charting — `src/components/TrendSparkline.tsx`**
Chart values are accepted only when the entire string is a single number with
an optional digit-free unit. The obvious `parseFloat` guard is wrong here,
because it silently parses a leading prefix: `"1,200"` becomes `1`, `"120/80"`
becomes `120`, `"0.5-1.0"` becomes `0.5`. Six of fifteen realistic lab values
would have been charted incorrectly. Anything ambiguous falls back to a
readable text trail — for medical data, no chart beats a confident wrong one.

**Deletion — `src/app/api/reports/[id]/route.ts`**
Missing, malformed and not-yours report IDs all return an identical 404, so the
endpoint cannot be used to discover whether a report exists. Deletion is a real
cascading delete, not a soft-delete flag.

**Destructive UI actions — `src/app/history/page.tsx`**
Double-click guards use a `useRef` checked and set synchronously. React state
and the `disabled` attribute both fail here: same-tick clicks all read state
from before the first click commits. Three fast clicks on "Delete all my data"
otherwise fired three concurrent account deletions.

**Error handling — throughout**
No route returns a raw `err.message` to the client. Upstream SDK errors can
carry API keys, rate-limit payloads and connection details, and this app's
error copy is read by patients. Real errors go to the server log; users get
fixed, calm text.

**Accessibility**
The sparkline is `aria-hidden` with an `sr-only` text equivalent, e.g. *"Trend
for Hemoglobin: rising. Values oldest to newest: 11.2, then 12.7, then 14.1,
the last of which is this report's value."* A chart that only exists visually
would be invisible to exactly the users who most need the summary.

## Known limitations

Stated plainly rather than discovered:

- **Trend matching is exact on test name.** The extraction prompt includes the
  assay method in the name, so `Glucose (GOD-POD)` and
  `Glucose (Glucose oxidase peroxidase chromogen reaction)` are the same test
  but never match. Found by testing two real urine panels from different labs:
  only 7 of 17 tests matched. The fix is to extract the canonical test name and
  the method as separate fields; normalizing at match time is a cheaper
  stopgap.
- **No pagination on `/history`.** Measured at 2.43 MB and ~1.5s for 150
  reports / 10,502 results, growing linearly. Fine at personal scale; a
  `?before=<created_at>` cursor is the cheap fix, no schema change needed.
- **No cross-session duplicate detection.** Saving the same PDF twice creates
  two reports. Preventing this needs a content-hash column on the write path,
  so it is a schema change rather than a patch.
- **Analysis takes 15-30s** — two sequential vision-model calls (extraction
  ~10s, synthesis ~6s). Rasterizing is only ~5% of it. This exceeds Netlify's
  function limit, which is why it is deployed to Vercel. Splitting extraction
  and synthesis into two requests would be the fix for shorter limits.
- **Sign-in email uses Supabase's built-in sender**, which is rate-limited to a
  few per hour project-wide and is not a production mailer. Fine for a demo;
  real use needs custom SMTP.
- **Only the first 3 pages** of a PDF are analyzed (model image limit). The UI
  says so explicitly when a document is truncated.

## Verification notes

Most behaviour was checked against a live database and a real browser rather
than asserted: RLS isolation was proven with canary values planted on a second
account, sparkline ordering was read off rendered SVG coordinates, and the
double-click race was reproduced (three concurrent deletions) before being
fixed and confirmed with a negative control.

The one gap worth naming: the full signed-in round trip was verified manually,
not by an automated test. There is no test suite in this project.
