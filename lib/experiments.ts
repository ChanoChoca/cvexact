// Relative, and not `@/…`: `next.config.ts` loads this file (to open the content policy to GitHub only when the build says so), and the loader it is
// loaded by does not resolve an alias in a file that its own imports reach. The same holds for what this file imports — `tests/experiments.test.ts` keeps it.
import { LEGAL_VERSION } from "./legal/operator";

/**
 * What is built and switched off: one switch for each (e5, O10 to O21), all of them off.
 *
 * The opportunities of the report that are worth building and not yet worth turning on — because what they would do is a guess until people
 * have tried it (`docs/estudios-perfil-especificacion.md`), or because the policy does not say it yet (`docs/legal/versiones.md`) — are in the code and
 * cannot be seen. Nothing here changes what the product does for anyone until a switch is turned on, and a switch that is off leaves no trace:
 * no question, no card, no field, no request. That is what the tests of each of them check first.
 *
 * How a switch is turned on, and only so:
 *  - In production, by the build: `NEXT_PUBLIC_CVP_EXPERIMENTS=repeated_requirement,corrected_cv`, ids separated by commas, read when the
 *    image is built (a public variable is baked into the client), and **never one that asks for the policy while `LEGAL_VERSION` does not
 *    cover it** (`policyFrom`): a screen that collects what the policy does not say is the one thing a switch must not do.
 *  - In development, also from this browser (`localStorage`, `EXPERIMENTS_KEY`), so that the walkthroughs in a real browser try them against
 *    the same `pnpm dev` as always, and so that whoever is testing a study can turn one on for themselves. Never in production: the person
 *    in front of the product is not the one who chooses what the product experiments with.
 *
 * `tests/experiments.test.ts` holds it: all off, none turned on by anything that is not in the lists above, and each one — those that ask
 * for the policy or not — in the queue of `docs/legal/versiones.md`, where what the policy will need is written before it is turned on.
 */

export type ExperimentSpec = {
  /** The opportunity of e5 it builds: O10, O11… The key of its row in the queue of `docs/legal/versiones.md`. */
  opportunity: string;
  /** The stage of the plan that built it. */
  stage: 7 | 8 | 9;
  /** What it is, in a few words: for whoever reads the list. */
  label: string;
  /**
   * Whether turning it on collects or keeps something the privacy policy does not say: a new datum that leaves the browser, a new
   * destination, a new use of what is sent to a model. Decided by the reading that e5 calls prudent (Q1): when in doubt, it asks.
   */
  asksPolicy: boolean;
  /**
   * The first `LEGAL_VERSION` whose policy says what it does. Absent until a pass of the policy covers it: while it is absent, or later than
   * the version in force, it cannot be turned on in production, whatever the build says.
   */
  policyFrom?: string;
};

export const EXPERIMENTS = {
  /** O10: a requirement that appears in several of the offers analysed is asked once, as a count of what the person saw and never as a forecast. */
  repeated_requirement: {
    opportunity: "O10",
    stage: 7,
    label: "Lo que piden varias de las ofertas que analizaste",
    asksPolicy: false,
  },
  /** O11: what was added or changed by hand in a generated CV, offered to the profile once, in a single card. */
  corrected_cv: {
    opportunity: "O11",
    stage: 7,
    label: "Lo que corregiste a mano en un CV",
    asksPolicy: false,
  },
  /** O12: when an application reaches the interview, one optional question about what was asked that the profile does not say. */
  interview_question: {
    opportunity: "O12",
    stage: 7,
    label: "Lo que te preguntaron en la entrevista",
    asksPolicy: false,
  },
  /** O21: the counts of each question template, in the file of activity counters (`exportMetrics`), which no screen offers any more. */
  template_counts: {
    opportunity: "O21",
    stage: 7,
    label: "Los conteos por plantilla, en el archivo de tu actividad",
    asksPolicy: false,
  },
  /**
   * O13: a link and the person's own sentence, kept beside a job, a study, a certification or a project as what shows it. It is a new datum that
   * goes with the profile when it is synced (the address and the sentence), so it asks for the policy; the app never opens the link.
   */
  evidence_links: {
    opportunity: "O13",
    stage: 8,
    label: "Un enlace como respaldo de lo que contás",
    asksPolicy: true,
  },
  /**
   * O14: shortcuts to the official registers (graduates, health professionals, gas installers), opened in another tab, and what the person saw there
   * kept as the same kind of datum as O13: it asks for the policy for the same reason.
   */
  official_registries: {
    opportunity: "O14",
    stage: 8,
    label: "Atajos a los registros oficiales",
    asksPolicy: true,
  },
  /** O19: the public repositories of a GitHub user, read from the browser without a token and offered as projects to confirm. A new destination. */
  github_projects: {
    opportunity: "O19",
    stage: 8,
    label: "Tus proyectos públicos de GitHub",
    asksPolicy: true,
  },
  /**
   * O20: an Open Badges 3.0 credential brought from a file, with its signature checked in the browser when it carries its own key. What is kept of
   * it is a certification and the same kind of datum as O13 («firmada»), which is why it asks for the policy with O13 and not before.
   */
  open_badges: {
    opportunity: "O20",
    stage: 8,
    label: "Una insignia de Open Badges con su firma",
    asksPolicy: true,
  },
  /**
   * O15: «Anotá algo», a note with its date written from any screen of the app — and, on Android, shared to it from another app — that the engine
   * offers to place once, in the job it names. A note is a datum the profile already keeps and syncs, but its date, how it came and whether the
   * person has dealt with it are new: it asks for the policy.
   */
  note_capture: {
    opportunity: "O15",
    stage: 9,
    label: "«Anotá algo»: una nota con fecha desde cualquier pantalla",
    asksPolicy: true,
  },
  /** O16: a calendar file the person downloads and keeps, with an event that repeats and the link to the app. Made in the browser: nothing is sent. */
  calendar_reminder: {
    opportunity: "O16",
    stage: 9,
    label: "Un recordatorio en tu calendario, que bajás vos",
    asksPolicy: false,
  },
  /** O17: a skill that nothing backs for years — three the technical ones, five the manual ones — is asked about once, and never taken out by itself. */
  stale_skills: {
    opportunity: "O17",
    stage: 9,
    label: "Las habilidades que hace años que nada respalda",
    asksPolicy: false,
  },
  /**
   * O18: the photo of a credential read in the browser, keeping only its class and its date. The engine that reads it is served from this origin, and
   * the policy says what is read and that the picture is let go (clause 7), so it asks for the policy before it is turned on.
   */
  credential_photo: {
    opportunity: "O18",
    stage: 9,
    label: "Leer la foto de una credencial en tu navegador",
    asksPolicy: true,
  },
} as const satisfies Record<string, ExperimentSpec>;

export type ExperimentId = keyof typeof EXPERIMENTS;

export const EXPERIMENT_IDS = Object.keys(EXPERIMENTS) as ExperimentId[];

/** Where, in a browser that is not in production, the ones turned on by hand are kept: a JSON list of ids. */
export const EXPERIMENTS_KEY = "cvexact.experiments.v1";

const isExperiment = (value: unknown): value is ExperimentId => typeof value === "string" && Object.hasOwn(EXPERIMENTS, value);

/** The ids in a comma-separated list, as the build says them: unknown ones, empty ones and repeated ones are let go. */
export function parseBuildList(raw: string | undefined | null): ExperimentId[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((id) => id.trim()).filter(isExperiment))];
}

/** The ids in what a browser kept: a JSON list, and anything else is nothing. */
export function parseStoredList(raw: string | undefined | null): ExperimentId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isExperiment))] : [];
  } catch {
    return [];
  }
}

/** Whether the policy in force says what this one does. Versions are dates (`2026-10-07`, `2026-10-07.2`), and read in order as text. */
export function policyCovers(id: ExperimentId, legalVersion: string = LEGAL_VERSION): boolean {
  const spec: ExperimentSpec = EXPERIMENTS[id];
  if (!spec.asksPolicy) return true;
  return spec.policyFrom !== undefined && spec.policyFrom <= legalVersion;
}

export type Where = {
  /** What the build said (`NEXT_PUBLIC_CVP_EXPERIMENTS`). */
  build?: string | undefined;
  /** What this browser kept (`EXPERIMENTS_KEY`): only read outside production. */
  stored?: string | null | undefined;
  production: boolean;
  legalVersion?: string;
};

/** Which are on, for each: the whole rule, in one place, with no browser and no environment of its own so that it can be tried. */
export function resolveExperiments(where: Where): Record<ExperimentId, boolean> {
  const built = new Set(parseBuildList(where.build));
  const kept = where.production ? new Set<ExperimentId>() : new Set(parseStoredList(where.stored));
  return Object.fromEntries(
    EXPERIMENT_IDS.map((id) => {
      const listed = built.has(id) || kept.has(id);
      // Only production is held to the policy: it is where a person who did not choose it would meet it.
      const allowed = !where.production || policyCovers(id, where.legalVersion);
      return [id, listed && allowed];
    }),
  ) as Record<ExperimentId, boolean>;
}

/** What the build said. A literal `process.env.NEXT_PUBLIC_…`, because that is what Next replaces when it builds the client. */
export const builtList = (): string | undefined => process.env.NEXT_PUBLIC_CVP_EXPERIMENTS;

const inProduction = (): boolean => process.env.NODE_ENV === "production";

/** What this browser kept, or nothing where there is no browser or it will not say. */
function storedList(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(EXPERIMENTS_KEY);
  } catch {
    return null;
  }
}

/** Whether one is on, here and now. Cheap, and a boolean, so that a component can read it on every render. */
export function experimentOn(id: ExperimentId): boolean {
  return resolveExperiments({ build: builtList(), stored: storedList(), production: inProduction() })[id];
}

/** What a server, or the first render of a client that has not looked at the browser yet, sees: only what the build said. */
export function experimentOnServer(id: ExperimentId): boolean {
  return resolveExperiments({ build: builtList(), stored: null, production: inProduction() })[id];
}
