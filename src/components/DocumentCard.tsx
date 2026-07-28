import type { ExtractedDocument } from "@/lib/types";
import StatusBadge from "./StatusBadge";

export default function DocumentCard({ doc }: { doc: ExtractedDocument }) {
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
        <div className="text-right">
          <p className="font-data text-sm text-ink-soft">{doc.date || "Date unknown"}</p>
          <p className="truncate text-xs text-ink-soft">{doc.fileName}</p>
        </div>
      </div>

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
