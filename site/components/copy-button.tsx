"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line bg-white text-ink-2 transition-colors duration-300 hover:text-ink"
    >
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
    </button>
  );
}
