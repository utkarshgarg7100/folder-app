"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { ResultStatus, TrendPoint } from "@/lib/types";

const STATUS_COLOR: Record<ResultStatus, string> = {
  in_range: "#4c6e52",
  out_of_range: "#9c4638",
  unclear: "#a8752e",
};

/**
 * A lab value is chartable only when its ENTIRE meaningful content is one
 * plain decimal number, optionally followed by a unit that contains no digits
 * ("14.1", "14.1 g/dL", "-3.4").
 *
 * `Number.parseFloat` is deliberately NOT used as the guard: it parses a
 * leading numeric prefix and silently discards the rest, so "1,200" becomes 1
 * and "0.5-1.0" becomes 0.5. On a medical trend line a confidently wrong point
 * is worse than no line at all, so anything ambiguous falls back to the text
 * trail instead:
 *   - thousands separators ("1,200")
 *   - comparison operators ("<0.5", ">100")
 *   - ranges / multiple numbers ("0.5-1.0", "120/80")
 *   - exponent notation ("1.2e3") — rare in lab printouts and easy to misread
 *   - words ("Positive"), empty and whitespace-only strings
 */
const CHARTABLE = /^\s*(-?\d+(?:\.\d+)?)\s*(?:[^\s\d][^\d]*)?$/;

export function parseChartableValue(value: string): number | null {
  const m = CHARTABLE.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function formatTrail(values: string[]): string {
  return values.map((v) => v.trim() || "(blank)").join(", then ");
}

interface TrendSparklineProps {
  /** Prior history, oldest -> newest. Excludes the current document. */
  points: TrendPoint[];
  current: { value: string; status: ResultStatus };
  /** Used only for the screen-reader description. */
  testName: string;
}

export default function TrendSparkline({
  points,
  current,
  testName,
}: TrendSparklineProps) {
  const rawValues = [...points.map((p) => p.value), current.value];
  const numeric = rawValues.map(parseChartableValue);

  if (numeric.some((n) => n === null)) {
    // Not all values are unambiguously numeric — show the readable trail.
    return (
      <span className="font-data text-xs text-ink-soft">
        Previous {testName}, oldest to newest: {formatTrail(
          points.map((p) => p.value)
        )}
        . Current: {current.value.trim() || "(blank)"}.
      </span>
    );
  }

  const values = numeric as number[];
  const data = values.map((value) => ({ value }));
  const first = values[0];
  const last = values[values.length - 1];
  const direction =
    last > first ? "rising" : last < first ? "falling" : "unchanged";

  const description = `Trend for ${testName}: ${direction}. Values oldest to newest: ${formatTrail(
    rawValues
  )}, the last of which is this report's value.`;

  return (
    <div className="flex items-center">
      <span className="sr-only">{description}</span>
      <div className="h-8 w-24" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={STATUS_COLOR[current.status]}
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
