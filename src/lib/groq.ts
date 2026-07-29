import Groq from "groq-sdk";
import type { ExtractedDocument, CrossDocumentRelation, TestTrend } from "./types";

const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }
  return new Groq({ apiKey });
}

/**
 * Parses the model's JSON response defensively: strips markdown code fences
 * it sometimes wraps JSON in, and falls back to extracting the outermost
 * {...} block if there's stray prose around the JSON.
 */
function parseJsonResponse<T>(raw: string | null | undefined): T {
  if (!raw) {
    throw new Error("The model returned an empty response.");
  }
  console.error(`[groq] raw response (${raw.length} chars):`, raw.slice(0, 4000));

  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to brace-extraction below
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      // fall through to error below
    }
  }

  const snippet = raw.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(
    `The model's response was not valid JSON. It started with: "${snippet}${raw.length > 200 ? "…" : ""}"`
  );
}

const EXTRACTION_SYSTEM_PROMPT = `You are a careful medical-report reading assistant. You are given one or more page images from a single patient document (a lab report, imaging report, or similar). Your job is ONLY to extract what is printed on the page — never estimate, infer, or guess a value that is not clearly legible.

Return STRICT JSON ONLY (no markdown, no commentary, no code fences) matching exactly this shape:

{
  "doctor": string | null,
  "clinic": string | null,
  "date": string | null,
  "results": [
    {
      "test": string,
      "value": string,
      "unit": string | null,
      "referenceRange": string | null,
      "status": "in_range" | "out_of_range" | "unclear",
      "note": string | null
    }
  ],
  "unclearNotes": string[]
}

Rules:
- "status" must be "out_of_range" only when the value clearly falls outside a printed reference range on the page. Use "in_range" when it clearly falls inside. Use "unclear" whenever the reference range is missing, the text is illegible, or you are not confident — do NOT guess.
- If any field (doctor, clinic, date) is not printed on the page, use null. Do not invent names or dates.
- "unclearNotes" should list, in plain language, anything on the page you could not read confidently (e.g. "the reference range for Vitamin D is smudged and not legible").
- If the page contains no recognizable test results at all, return an empty "results" array and explain why in "unclearNotes".
- Output only the JSON object, nothing else.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a careful, plain-language health-report assistant helping a layperson (often an adult child worried about a parent's health) understand lab results that have already been extracted from one or more documents. You are NOT a doctor and must never diagnose, speculate about causes, or recommend treatment.

You will be given the structured extraction (JSON) for one or more documents, and optionally a block of the same user's prior saved test history from earlier visits. Respond with STRICT JSON ONLY matching exactly this shape:

{
  "overallSummary": string,
  "crossDocumentRelation": {
    "found": boolean,
    "description": string | null,
    "involvedTests": string[]
  }
}

Rules:
- "overallSummary" is 2-4 plain-language sentences, calm and reassuring in tone, summarizing what was found across all documents combined (how many values were in range / out of range / unclear, and in plain words what stands out). No medical jargon without a plain-language gloss.
- "crossDocumentRelation" is used for TWO kinds of patterns — treat both the same way:
  (a) a relationship between values across different documents in THIS batch, or
  (b) a meaningful trend for the same test across the user's prior saved history and this batch (e.g. a value that has moved in the same direction across 2+ prior visits plus this one).
  Only set "found" to true when you can point to a genuine, specific instance of (a) or (b) — never invent one. If neither applies, set "found" to false, "description" to null, and "involvedTests" to [].
- When "found" is true, phrase "description" as an observation to raise with a doctor, never as a diagnosis or conclusion (e.g. "X and Y both moved in a related direction across these reports — this pattern may be worth mentioning to a doctor," not "this means..."). If the pattern is a multi-visit trend (case b), say so explicitly (e.g. "Across your last 3 saved reports, X has been trending upward...").
- Output only the JSON object, nothing else.`;

interface PageImage {
  mimeType: string;
  base64: string;
}

export async function extractDocument(
  fileName: string,
  pages: PageImage[]
): Promise<Omit<ExtractedDocument, "fileName" | "error">> {
  const client = getClient();

  const content: Groq.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `File name: ${fileName}. Extract the test results from the following page image(s) of this document.`,
    },
    ...pages.map(
      (page): Groq.Chat.Completions.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:${page.mimeType};base64,${page.base64}` },
      })
    ),
  ];

  // Note: Groq's `response_format: json_object` server-side validation is
  // unreliable when the request also includes image content (it can fail
  // with an empty `failed_generation`), so JSON compliance is enforced via
  // the prompt instead and parsed defensively client-side below.
  // `reasoning_effort: "none"` stops the model from emitting chain-of-thought
  // text inline before the JSON, which otherwise breaks parsing.
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    reasoning_effort: "none",
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = parseJsonResponse<{
    doctor: string | null;
    clinic: string | null;
    date: string | null;
    results: ExtractedDocument["results"];
    unclearNotes: string[];
  }>(raw);

  return {
    doctor: parsed.doctor ?? null,
    clinic: parsed.clinic ?? null,
    date: parsed.date ?? null,
    results: Array.isArray(parsed.results) ? parsed.results : [],
    unclearNotes: Array.isArray(parsed.unclearNotes) ? parsed.unclearNotes : [],
  };
}

export async function synthesizeSummary(
  documents: ExtractedDocument[],
  history: TestTrend[] = []
): Promise<{ overallSummary: string; crossDocumentRelation: CrossDocumentRelation }> {
  const client = getClient();

  const payload = documents.map((doc) => ({
    fileName: doc.fileName,
    doctor: doc.doctor,
    clinic: doc.clinic,
    date: doc.date,
    results: doc.results,
    unclearNotes: doc.unclearNotes,
    error: doc.error,
  }));

  const historyBlock =
    history.length > 0
      ? `\n\nThis user also has prior saved history for some of these tests (oldest to newest, from earlier visits, not part of this upload):\n\n${JSON.stringify(
          history,
          null,
          2
        )}`
      : "";

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is the extracted data from ${documents.length} document(s):\n\n${JSON.stringify(payload, null, 2)}${historyBlock}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = parseJsonResponse<{
    overallSummary: string;
    crossDocumentRelation: CrossDocumentRelation;
  }>(raw);

  return {
    overallSummary: parsed.overallSummary ?? "",
    crossDocumentRelation: parsed.crossDocumentRelation ?? {
      found: false,
      description: null,
      involvedTests: [],
    },
  };
}
