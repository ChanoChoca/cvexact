import { Alert } from "@/components/ui";

const LINK = "underline decoration-current/40 underline-offset-4 hover:decoration-current pointer-coarse:-my-3 pointer-coarse:py-3";

/**
 * What the last answer did, in a line, with the way back: «Guardado: vence en mayo de 2028. Deshacer». The same line wherever an answer is given —
 * above the next question, at the close of a stretch of them, on the page of an application where the round that asked it is gone — so that no answer is
 * given without being told what it did, and none without a way to take it back.
 */
export function AnswerReceipt({
  receipt,
  onUndo,
  onShowProfile,
}: {
  receipt: string;
  onUndo?: (() => void) | undefined;
  /** Where the answer went, on a screen too narrow to show the profile beside the question. */
  onShowProfile?: (() => void) | undefined;
}) {
  return (
    <Alert tone="good">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-answer-receipt>
        <span>{receipt}</span>
        {onUndo ? (
          <button type="button" onClick={onUndo} className={LINK}>
            Deshacer
          </button>
        ) : null}
        {onShowProfile ? (
          <button type="button" onClick={onShowProfile} className={`${LINK} lg:hidden`}>
            Ver en tu perfil
          </button>
        ) : null}
      </span>
    </Alert>
  );
}
