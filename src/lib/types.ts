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

/** One previously saved measurement of a test, for plotting a trend. */
export interface TrendPoint {
  value: string;
  unit: string | null;
  status: ResultStatus;
  /** As printed on the document; not normalized/parsed, and often absent. */
  reportDate: string | null;
  /** When the row was saved — the only reliably ordered timestamp we have. */
  savedAt: string;
}

/** Prior saved history for a single test name. */
export interface TestTrend {
  testName: string;
  /** Oldest -> newest. Prior saved history only; excludes the current upload. */
  points: TrendPoint[];
}

export interface AnalyzeResponse {
  documents: ExtractedDocument[];
  overallSummary: string;
  crossDocumentRelation: CrossDocumentRelation;
  trends: TestTrend[];
}

export interface AnalyzeErrorResponse {
  error: string;
}

/** A single stored result row, as returned by GET /api/history. */
export interface SavedResult {
  id: string;
  test: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  status: ResultStatus;
  note: string | null;
}

/** A stored report with its results, as returned by GET /api/history. */
export interface SavedReport {
  id: string;
  fileName: string;
  doctor: string | null;
  clinic: string | null;
  date: string | null;
  savedAt: string;
  results: SavedResult[];
}
