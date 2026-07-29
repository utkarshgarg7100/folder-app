"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import StatusBadge from "@/components/StatusBadge";
import type { SavedReport } from "@/lib/types";

/** What a report is called in headings and confirm dialogs. */
function reportTitle(report: SavedReport): string {
  return report.doctor || report.clinic || report.fileName;
}

export default function HistoryPage() {
  const { authEnabled, user, loading } = useAuth();

  // The user this list belongs to. Everything derived from the network is
  // stored alongside the id it was fetched for, so one account's medical
  // results can never be painted under another account's session.
  const userId = user?.id ?? null;

  const [data, setData] = useState<{
    key: string | null;
    reports: SavedReport[] | null;
    fetchError: string | null;
  }>({ key: userId, reports: null, fetchError: null });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Reset during render (the React-sanctioned "derive state from props"
  // pattern) rather than in an effect, so a switched account never renders
  // even one frame of the previous account's reports.
  if (data.key !== userId) {
    setData({ key: userId, reports: null, fetchError: null });
    setExpandedId(null);
    setActionError(null);
    setDeletingId(null);
  }

  const reports = data.key === userId ? data.reports : null;
  const fetchError = data.key === userId ? data.fetchError : null;

  useEffect(() => {
    if (!userId) return;

    // Aborting on cleanup means a response that arrives after the user changed
    // is never applied. The `key: userId` on every setData is the second guard.
    const controller = new AbortController();

    fetch("/api/history", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : `Failed to load history (${res.status}).`
          );
        }
        return res.json() as Promise<{ reports: SavedReport[] }>;
      })
      .then((body) => {
        setData({ key: userId, reports: body.reports, fetchError: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setData({
          key: userId,
          reports: null,
          fetchError:
            err instanceof Error && err.message
              ? err.message
              : "Failed to load history.",
        });
      });

    return () => controller.abort();
  }, [userId]);

  const handleDeleteReport = async (report: SavedReport) => {
    if (deletingId || deletingAccount) return;
    if (
      !window.confirm(
        `Delete "${reportTitle(report)}" from your history? This can't be undone.`
      )
    ) {
      return;
    }

    setDeletingId(report.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "DELETE",
      });

      // A 404 means the report is definitively not in this user's history —
      // the endpoint answers the same way for missing, malformed and
      // not-yours ids on purpose. Either way the row should go, so treat it
      // as a success rather than inventing copy about what the id was.
      if (!res.ok && res.status !== 404) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Could not delete this report (${res.status}).`
        );
      }

      setData((prev) =>
        prev.key === userId && prev.reports
          ? {
              ...prev,
              reports: prev.reports.filter((r) => r.id !== report.id),
            }
          : prev
      );
      setExpandedId((id) => (id === report.id ? null : id));
    } catch (err) {
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "Could not delete this report. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    if (
      !window.confirm(
        "Delete your account and every report you've saved? This can't be undone."
      )
    ) {
      return;
    }

    setDeletingAccount(true);
    setActionError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Could not delete your account (${res.status}).`
        );
      }
      // A full page load, not a router push: the auth cookies are gone and
      // every client-side cache of this session must go with them.
      window.location.href = "/";
    } catch (err) {
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "Could not delete your account. Please try again."
      );
      setDeletingAccount(false);
    }
  };

  if (!authEnabled) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <p className="text-ink-soft">
          History isn&apos;t available on this deployment.
        </p>
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
        <p className="text-ink-soft">
          Sign in from the header to see your saved history.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">Your history</h1>
        {/* Deliberately not gated on having reports: an account with zero
            saved reports still has an auth user, an email and a profile row,
            and this is the only way to erase them. */}
        {reports !== null && (
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
        <p className="mb-6 rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">
          {fetchError}
        </p>
      )}

      {actionError && (
        <p className="mb-6 rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">
          {actionError}
        </p>
      )}

      {reports === null && !fetchError && (
        <p className="text-ink-soft">Loading your history…</p>
      )}

      {reports !== null && reports.length === 0 && (
        <p className="text-ink-soft">
          You haven&apos;t saved any reports yet. Analyze a report and choose
          &ldquo;Save to my history&rdquo; to keep it here.
        </p>
      )}

      {reports !== null && reports.length > 0 && (
        <ul className="flex flex-col gap-4">
          {reports.map((report) => {
            const panelId = `report-values-${report.id}`;
            const expanded = expandedId === report.id;
            return (
              <li
                key={report.id}
                className="rounded-2xl border border-line bg-paper-raised p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">
                      {reportTitle(report)}
                    </h2>
                    <p className="truncate text-xs text-ink-soft">
                      {report.fileName}
                    </p>
                  </div>
                  <p className="font-data text-sm text-ink-soft">
                    {report.date || "Date unknown"}
                  </p>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((id) => (id === report.id ? null : report.id))
                    }
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className="text-sm text-teal hover:underline"
                  >
                    {expanded ? "Hide values" : "Show values"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteReport(report)}
                    disabled={deletingId === report.id || deletingAccount}
                    className="text-sm text-brick hover:underline disabled:opacity-60"
                  >
                    {deletingId === report.id ? "Deleting…" : "Delete"}
                  </button>
                </div>

                {expanded && (
                  <div id={panelId} className="overflow-x-auto">
                    {report.results.length === 0 ? (
                      <p className="mt-4 text-sm text-ink-soft">
                        No test values were stored with this report.
                      </p>
                    ) : (
                      <table className="mt-4 w-full border-collapse text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
                            <th className="pb-2 pr-4 font-medium">Test</th>
                            <th className="pb-2 pr-4 font-medium">Value</th>
                            <th className="pb-2 font-medium">Status</th>
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
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
