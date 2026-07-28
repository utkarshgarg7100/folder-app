"use client";

import { useCallback, useRef, useState } from "react";

const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const ACCEPTED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

interface UploadScreenProps {
  onAnalyze: (files: File[]) => void;
  disabled?: boolean;
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadScreen({ onAnalyze, disabled }: UploadScreenProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [rejectionNotice, setRejectionNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const incomingArr = Array.from(incoming);
    const accepted = incomingArr.filter((f) => ACCEPTED_MIME.has(f.type));
    const rejectedCount = incomingArr.length - accepted.length;

    setRejectionNotice(
      rejectedCount > 0
        ? `${rejectedCount} file${rejectedCount > 1 ? "s" : ""} skipped — only PDF, JPG, and PNG are supported.`
        : null
    );

    setFiles((prev) => {
      const existingKeys = new Set(prev.map(fileKey));
      const deduped = accepted.filter((f) => !existingKeys.has(fileKey(f)));
      return [...prev, ...deduped];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeFile = (key: string) => {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold text-ink">
          Make sense of your lab reports
        </h1>
        <p className="mt-3 text-base text-ink-soft">
          Upload a lab report or scan — we&apos;ll pull out the numbers, flag
          anything unusual, and explain it in plain language.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors ${
          isDragging
            ? "border-teal bg-teal/5"
            : "border-line bg-paper-raised/60 hover:border-teal/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-lg font-medium text-ink">
          Drag reports here, or click to choose files
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          PDF, JPG, or PNG · multiple files allowed
        </p>
      </div>

      {rejectionNotice && (
        <p className="mt-3 text-sm text-brick">{rejectionNotice}</p>
      )}

      {files.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={fileKey(file)}
              className="flex items-center justify-between rounded-lg border border-line bg-paper-raised px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-data text-sm text-ink">{file.name}</p>
                <p className="font-data text-xs text-ink-soft">
                  {formatBytes(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(fileKey(file))}
                aria-label={`Remove ${file.name}`}
                className="ml-4 shrink-0 rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-brick-bg hover:text-brick"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={files.length === 0 || disabled}
        onClick={() => onAnalyze(files)}
        className="mt-8 w-full rounded-xl bg-teal py-3.5 text-base font-medium text-paper transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
      >
        {disabled ? "Analyzing…" : `Analyze${files.length ? ` ${files.length} file${files.length > 1 ? "s" : ""}` : ""}`}
      </button>

      <p className="mt-4 text-center text-xs text-ink-soft">
        Files are processed to extract test values and are not stored after your session.
      </p>
    </div>
  );
}
