"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface SummaryChartProps {
  inRange: number;
  outOfRange: number;
  unclear: number;
}

const COLORS = {
  inRange: "#4c6e52",
  outOfRange: "#9c4638",
  unclear: "#a8752e",
};

export default function SummaryChart({
  inRange,
  outOfRange,
  unclear,
}: SummaryChartProps) {
  const total = inRange + outOfRange + unclear;

  const data = [
    { name: "Within range", value: inRange, color: COLORS.inRange },
    { name: "Outside range", value: outOfRange, color: COLORS.outOfRange },
    { name: "Unclear", value: unclear, color: COLORS.unclear },
  ].filter((d) => d.value > 0);

  if (total === 0) {
    return (
      <p className="text-sm text-ink-soft">No test values were extracted.</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={52}
              outerRadius={80}
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${value}`, `${name}`]}
              contentStyle={{
                background: "#ffffff",
                border: "1px solid #e3dac8",
                borderRadius: 8,
                fontSize: 13,
                fontFamily: "var(--font-body)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-data text-2xl font-semibold text-ink">
            {total}
          </span>
          <span className="text-xs text-ink-soft">values</span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-2.5">
        {[
          { label: "Within range", value: inRange, color: COLORS.inRange },
          { label: "Outside range", value: outOfRange, color: COLORS.outOfRange },
          { label: "Unclear", value: unclear, color: COLORS.unclear },
        ].map((row) => (
          <li key={row.label} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="flex-1 text-ink">{row.label}</span>
            <span className="font-data text-ink-soft">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
