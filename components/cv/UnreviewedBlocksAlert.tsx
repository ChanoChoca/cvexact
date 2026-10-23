import Link from "next/link";
import { Alert } from "@/components/ui";

/**
 * What the CV is made of that nobody has looked at: jobs and studies read with doubts, and what two documents
 * disagree on. Said, not held back — it is the person's profile and the CV uses it as it stands — with the way to
 * look at it. Shared by the screens that hand over a CV from the profile, so they say it in the same words.
 */
export function UnreviewedBlocksAlert({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Alert tone="info" title={`Tu CV usa ${count} ${count === 1 ? "bloque sin revisar" : "bloques sin revisar"}`}>
      Son puestos o estudios que leímos con dudas, o que dos documentos cuentan distinto. El CV los usa tal como están.{" "}
      <Link href="/perfil?revisar=1"className="underline underline-offset-4 hover:text-ink pointer-coarse:inline-block pointer-coarse:-my-3 pointer-coarse:py-3.5">
        Revisarlos
      </Link>
    </Alert>
  );
}
