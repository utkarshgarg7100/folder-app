import type { ResultStatus } from "@/lib/types";

const STYLES: Record<ResultStatus, { label: string; className: string }> = {
  in_range: {
    label: "Within range",
    className: "bg-sage-bg text-sage",
  },
  out_of_range: {
    label: "Outside range",
    className: "bg-brick-bg text-brick",
  },
  unclear: {
    label: "Unclear",
    className: "bg-ochre-bg text-ochre",
  },
};

export default function StatusBadge({ status }: { status: ResultStatus }) {
  const { label, className } = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}
