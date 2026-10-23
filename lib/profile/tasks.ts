import { ENGINE } from "@/lib/onboarding/config";
import { resumeStep } from "@/lib/onboarding/flow";
import { NO_SESSION, eligibleGaps, isReviewRule, type Signals } from "@/lib/onboarding/gaps";
import { reviewCounts } from "@/lib/onboarding/review";
import { pendingItems, type PendingItem } from "@/lib/onboarding/session";
import { openReviewItems, reviewItems } from "@/lib/profile/to-review";
import { isBlankProfile, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * What is left to do about a profile, in one list.
 *
 * It used to be five things in five places — "dejaste el armado a la mitad", "hay algo para revisar", the
 * invitation to the questions, the tray of texts with no place, the list of what was put off — and none of them
 * knew about the others. They are one list now: finish what was begun, and the questions. None of it is required
 * and none of it is a percentage: it is what there is, said once. Not in it, because it is said where it is: the texts
 * with no place (the profile does not show them, and only the review of a document does), what a document was read
 * with doubts about (on the job or study itself, and over the CV), the name (in «Datos personales» and over the CV), and
 * keeping the profile safe —a copy, an account— (the buttons of the profile, and «Mis datos» in Ajustes).
 */

/** Where a task is done: a page of the app. */
export type TaskAction = { label: string; href: string };

export type ProfileTask = {
  id: "continue" | "questions";
  title: string;
  /** What there is to do, in a line. */
  detail: string;
  /** Where it is done. Missing when the task is its own list. */
  action?: TaskAction;
  /** For the task that is a list — the questions put off — what it is made of. */
  items?: PendingItem[];
};

/** What is left to do, counted — the one reading `profileTasks` and the line that welcomes someone back both say. */
export type LeftToDo = {
  /** The profile was begun in the first-run flow and left before it ended. */
  unfinished: boolean;
  /** Jobs and studies read with doubts, and disagreements between documents. */
  toReview: number;
  /** The engine has questions to ask in a session that has not begun — the ones that make a CV better, and not what time brings, which is listed apart in «Para revisar». */
  somethingToAsk: boolean;
  pending: PendingItem[];
  /** What time brings and has not been put off (`lib/profile/to-review.ts`): the thing to settle, counted. */
  toSettle: number;
};

/**
 * `signals`: what the engine may ask besides the profile — what the experiments that are switched on tell it (`useEngineSignals`) — so that the list says what a session
 * would ask: a profile that is «al día» while the session has a question to put is a profile that said one thing and did another. With none, which is how it is for everyone while
 * they are off, it sees the profile and only the profile. A note somebody wrote down is not one of the things left to do whatever the signals say: writing something down adds
 * nothing to the list of what is missing.
 */
export function leftToDo(profile: StoredProfile, now: Date, signals?: Signals): LeftToDo {
  const counts = reviewCounts(profile);
  return {
    // Only where there is something to go back to: the start, or the guided steps. Not once it has reached «listo», and not for a screen that is the profile's now —the review of what was read, the
    // questions: `resumeStep` takes whoever left on one to the profile—, where what is left is in this list.
    unfinished: ["start", "steps"].includes(resumeStep(profile)) && !isBlankProfile(profile),
    toReview: counts.doubtful + counts.conflicts,
    somethingToAsk: eligibleGaps(profile, NO_SESSION, now, signals ? { signals } : {}).some((found) => !isReviewRule(found.rule) && found.rule !== "note_to_place"),
    pending: pendingItems(profile, now, signals),
    toSettle: openReviewItems(reviewItems(profile, now, signals ? { signals } : {})).length,
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What the list under the questions is made of, each kind counted as what it is: «Para retomar: 2 cosas que dejaste para después y 1 cifra que no tenías». It used
 * to call all of it «cosas que dejaste para después», and a number nobody had, or a job old enough to be left as it is, was never left by anyone.
 */
function leftForLater(pending: readonly PendingItem[]): string {
  const later = pending.filter((item) => item.kind === "later" || item.kind === "skipped").length;
  const figures = pending.filter((item) => item.kind === "figure").length;
  const optional = pending.filter((item) => item.kind === "optional").length;
  const parts = [
    later > 0 ? `${plural(later, "cosa que dejaste", "cosas que dejaste")} para después` : "",
    figures > 0 ? plural(figures, "cifra que no tenías", "cifras que no tenías") : "",
    optional > 0 ? `${plural(optional, "puesto viejo", "puestos viejos")}, que se puede dejar así` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return `Para retomar: ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`}.`;
}

/** What there is left to do, in the order that matters: the guided steps left half way, and then the questions. */
export function profileTasks(profile: StoredProfile, now: Date, signals?: Signals): ProfileTask[] {
  const left = leftToDo(profile, now, signals);
  const tasks: ProfileTask[] = [];

  if (left.unfinished) {
    tasks.push({
      id: "continue",
      title: "Seguir con el armado de tu perfil",
      detail: "Lo que cargaste está guardado: retomás donde lo dejaste.",
      action: { label: "Seguir", href: "/perfil/empezar" },
    });
  }

  // What time brings is not here: it has its own block, «Para revisar», above this list (`components/profile/ReviewBlock.tsx`).

  if (left.somethingToAsk || left.pending.length > 0) {
    tasks.push({
      id: "questions",
      title: "Preguntas que mejoran tu CV",
      detail: [left.somethingToAsk ? "Unas pocas preguntas más y tu CV queda mejor." : "", leftForLater(left.pending)].filter(Boolean).join(" "),
      ...(left.somethingToAsk ? { action: { label: "Seguir con las preguntas", href: "/perfil/preguntas" } } : {}),
      ...(left.pending.length > 0 ? { items: left.pending } : {}),
    });
  }

  return tasks;
}

/**
 * What a person who comes back after a while is told they had left: "revisar 2 bloques y contestar unas
 * preguntas". `null` when there is nothing, so the line is not said to someone who was done.
 */
export function leftToDoLine(left: LeftToDo): string | null {
  const parts = [
    left.toReview > 0 ? `revisar ${plural(left.toReview, "bloque", "bloques")}` : "",
    left.toSettle > 0 ? `confirmar ${plural(left.toSettle, "cosa", "cosas")}` : "",
    left.somethingToAsk ? "contestar unas preguntas" : "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Whether the profile was last touched longer ago than a session lasts: someone coming back, not someone carrying on. */
export function isReturning(profile: Pick<StoredProfile, "updatedAt">, now: Date): boolean {
  const last = Date.parse(profile.updatedAt);
  return Number.isFinite(last) && now.getTime() - last > ENGINE.session.staleAfterHours * 3_600_000;
}

/**
 * What a person is told on coming back to the middle of the first-run flow, so they are not left to work out where they
 * were: that it is where they left it, and what was still to do. Nothing for someone who is carrying on, and nothing
 * for a profile nobody has put anything in.
 */
export function welcomeBack(profile: StoredProfile, now: Date): string | null {
  if (isBlankProfile(profile) || !isReturning(profile, now)) return null;
  const line = leftToDoLine(leftToDo(profile, now));
  return line ? `Retomamos donde lo dejaste. Te faltaba ${line}.` : "Retomamos donde lo dejaste.";
}
