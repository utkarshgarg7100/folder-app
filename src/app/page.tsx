"use client";

import { useState } from "react";
import UploadScreen from "@/components/UploadScreen";
import ResultsScreen from "@/components/ResultsScreen";
import type { AnalyzeResponse } from "@/lib/types";

type Phase = "upload" | "analyzing" | "results" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAnalyze = async (files: File[]) => {
    setPhase("analyzing");
    setErrorMessage(null);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Analysis failed (${res.status}).`);
      }

      const data: AnalyzeResponse = await res.json();
      setResult(data);
      setPhase("results");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setPhase("error");
    }
  };

  const startOver = () => {
    setResult(null);
    setErrorMessage(null);
    setPhase("upload");
  };

  if (phase === "results" && result) {
    return <ResultsScreen result={result} onStartOver={startOver} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <UploadScreen onAnalyze={handleAnalyze} disabled={phase === "analyzing"} />
      {phase === "error" && errorMessage && (
        <div className="mx-auto mb-12 w-full max-w-2xl px-6">
          <p className="rounded-lg bg-brick-bg px-4 py-3 text-sm text-brick">
            {errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}
