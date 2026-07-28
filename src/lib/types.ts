export type ResultStatus = "in_range" | "out_of_range" | "unclear";

export interface TestResult {
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  status: ResultStatus;
  note: string | null;
}

export interface ExtractedDocument {
  fileName: string;
  doctor: string | null;
  clinic: string | null;
  date: string | null;
  results: TestResult[];
  unclearNotes: string[];
  error: string | null;
}

export interface CrossDocumentRelation {
  found: boolean;
  description: string | null;
  involvedTests: string[];
}

export interface AnalyzeResponse {
  documents: ExtractedDocument[];
  overallSummary: string;
  crossDocumentRelation: CrossDocumentRelation;
}

export interface AnalyzeErrorResponse {
  error: string;
}
