/**
 * cvexact. Set lowercase always, at weight 400, like every other piece of
 * type here — no symbol beside the word, same as before.
 */

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block tracking-[-0.01em] lowercase ${className ?? ""}`}
    >
      cvexact
    </span>
  );
}
