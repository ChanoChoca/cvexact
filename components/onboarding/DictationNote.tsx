import Link from "next/link";

/**
 * Under "Dictar": who does the listening. The browser does it — Google's service in Chrome, Apple's in Safari — and
 * nothing of ours hears it; the privacy policy says so in clause 20. Someone who is about to talk to their phone is owed
 * that where they tap, not in a document they did not open. The same words wherever there is a button to dictate.
 */
export function DictationNote() {
  return (
    <p className="text-xs text-ink-3">
      El dictado lo procesa tu navegador (Google en Chrome, Apple en Safari). Más en la{" "}
      <Link href="/legales/privacidad#c20" className="underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5">
        cláusula 20
      </Link>
      .
    </p>
  );
}
