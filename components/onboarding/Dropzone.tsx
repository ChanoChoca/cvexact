"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** An arrow rising out of a tray: a file going in. Inline SVG on the 24×24 grid and 1.6 round stroke of the app's other glyphs (`TabIcons`). */
function UploadGlyph({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="#b166d8"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 14.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    </svg>
  );
}

/**
 * Where files go: dropped on it or picked from the device. A real file input
 * underneath, so a keyboard or a screen reader gets the same thing a mouse does.
 *
 * With `multiple`, several at once are one gesture — a CV and a LinkedIn profile dropped
 * together — and arrive in the order the browser gave them; without it, only the first.
 */
export function Dropzone({
  accept,
  onFiles,
  multiple,
  disabled,
  title,
  hint,
}: {
  accept: string;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  title: ReactNode;
  hint?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const take = (list: FileList | null | undefined): File[] => {
    const files = Array.from(list ?? []);
    return multiple ? files : files.slice(0, 1);
  };

  // The dashed edge is `oro` (#b166d8), the violet the upload glyph is already
  // drawn in: the place a document goes in reads as the accent, while the
  // empty-state placeholders elsewhere in the app stay `rule`. Hover keeps the
  // same edge and answers with a wash, so the colour does not change under the
  // pointer; a drag over it or focus inside goes to the brighter `solar-g4`.
  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = take(event.dataTransfer.files);
        if (files.length > 0 && !disabled) onFiles(files);
      }}
      className={cx(
        "flex cursor-pointer flex-col items-center gap-2 border border-dashed px-6 py-10 text-center transition-colors focus-within:border-solar-g4 motion-reduce:transition-none",
        over
          ? "border-solar-g4 bg-white/[0.04]"
          : "border-oro hover:bg-white/[0.03]",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          // Copied out first: the list is live, and emptying the input below empties it too.
          const files = take(event.target.files);
          // Reset first: picking the same file twice after an error would fire no
          // change event and the zone would look broken.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <UploadGlyph
        className={cx(
          "size-9 transition-[color,translate] motion-reduce:transition-none",
          over ? "-translate-y-1 text-solar-g4" : "text-ink-3",
        )}
      />
      <span className="text-[15px] text-ink">{title}</span>
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}
