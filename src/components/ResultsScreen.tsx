import type { AnalyzeResponse } from "@/lib/types";
import SummaryChart from "./SummaryChart";
import DocumentCard from "./DocumentCard";

interface ResultsScreenProps {
  result: AnalyzeResponse;
  onStartOver: () => void;
}

export default function ResultsScreen({ result, onStartOver }: ResultsScreenProps) {
  const allResults = result.documents.flatMap((d) => d.results);
  const inRange = allResults.filter((r) => r.status === "in_range").length;
  const outOfRange = allResults.filter((r) => r.status === "out_of_range").length;
  const unclear = allResults.filter((r) => r.status === "unclear").length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
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

      <section className="rounded-2xl border border-line bg-paper-raised p-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-soft">
          Summary
        </h2>
        <p className="text-base leading-relaxed text-ink">{result.overallSummary}</p>
      </section>

      {result.crossDocumentRelation.found && (
        <section className="mt-6 rounded-2xl border-2 border-ochre bg-ochre-bg px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ochre">
            A pattern to raise with a doctor — not a diagnosis
          </p>
          <p className="mt-2 text-base leading-relaxed text-ink">
            {result.crossDocumentRelation.description}
          </p>
          {result.crossDocumentRelation.involvedTests.length > 0 && (
            <p className="mt-3 font-data text-sm text-ink-soft">
              Involved: {result.crossDocumentRelation.involvedTests.join(", ")}
            </p>
          )}
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-line bg-paper-raised p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink-soft">
          All values, at a glance
        </h2>
        <SummaryChart inRange={inRange} outOfRange={outOfRange} unclear={unclear} />
      </section>

      <section className="mt-6 flex flex-col gap-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-soft">
          Documents
        </h2>
        {result.documents.map((doc, i) => (
          <DocumentCard key={`${doc.fileName}-${i}`} doc={doc} />
        ))}
      </section>

      <p className="mt-8 text-center text-xs text-ink-soft">
        Folder summarizes what&apos;s printed on your reports. It does not diagnose,
        interpret causes, or replace medical advice — always confirm findings with
        a doctor.
      </p>
    </div>
  );
}
