"use client";

import { useRef, useState } from "react";
import type { ExtractedDocument } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import { useAuth } from "./AuthProvider";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Identity of the *content* being saved. ResultsScreen keys cards by
 * `${fileName}-${index}`, so re-analyzing a file with the same name at the same
 * position reuses this component instance and would otherwise carry a stale
 * "Saved" badge over to different data. Deriving the key from the exact payload
 * we POST means the saved state survives only for the bytes that were actually
 * written to the database; anything else re-arms the button.
 */
function documentKey(doc: ExtractedDocument): string {
  return JSON.stringify([
    doc.fileName,
    doc.doctor,
    doc.clinic,
    doc.date,
    doc.results,
  ]);
}

export default function DocumentCard({ doc }: { doc: ExtractedDocument }) {
  const { authEnabled, user, loading } = useAuth();

  const docKey = documentKey(doc);
  const [save, setSave] = useState<{
    key: string;
    state: SaveState;
    error: string | null;
  }>({ key: docKey, state: "idle", error: null });

  // Adjusting state during render (the React-sanctioned "derive state from
  // props" pattern) rather than in an effect, so a changed document never
  // renders one frame with the previous document's "Saved" badge.
  if (save.key !== docKey) {
    setSave({ key: docKey, state: "idle", error: null });
  }
  const saveState: SaveState = save.key === docKey ? save.state : "idle";
  const saveError = save.key === docKey ? save.error : null;

  // A ref, not the state value: two clicks dispatched in the same tick both see
  // the pre-update state, so `saveState === "saving"` alone cannot block the
  // second one. This closes double-click and held-Enter repeats.
  const inFlight = useRef(false);

  const handleSave = async () => {
    if (inFlight.current || saveState === "saved") return;
    inFlight.current = true;
    setSave({ key: docKey, state: "saving", error: null });
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
        // The route's error strings are written to be shown to users.
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Could not save this report (${res.status}).`
        );
      }
      setSave({ key: docKey, state: "saved", error: null });
    } catch (err) {
      setSave({
        key: docKey,
        state: "error",
        error:
          err instanceof Error && err.message
            ? err.message
            : "Could not save this report. Please try again.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  const savable = !doc.error && doc.results.length > 0;
  const disabled = saveState === "saving" || saveState === "saved";

  // Guest mode (`authEnabled` false) gets no affordance at all — the endpoint
  // returns 501 there, so a button would only ever produce an error. While auth
  // is still resolving we render nothing either, rather than flashing a button
  // that then disappears. Signed out with auth enabled gets a plain line of
  // text instead of a button: a button would guarantee a 401, but hiding the
  // feature entirely would leave the reason to sign in undiscoverable.
  const saveSlot =
    !authEnabled || loading || !savable ? null : user ? (
      <button
        type="button"
        onClick={handleSave}
        disabled={disabled}
        aria-live="polite"
        className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
          saveState === "saved"
            ? "border-teal bg-teal/10 text-teal"
            : "border-line text-ink-soft hover:bg-paper disabled:text-ink-soft"
        }`}
      >
        {saveState === "saved"
          ? "✓ Saved"
          : saveState === "saving"
            ? "Saving…"
            : "Save to my history"}
      </button>
    ) : (
      <p className="shrink-0 self-center text-xs text-ink-soft">
        Sign in to save this report
      </p>
    );

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
          {saveSlot}
        </div>
      </div>

      {saveState === "error" && saveError && (
        <p className="mb-4 rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">
          {saveError}
        </p>
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
