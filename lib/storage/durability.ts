/**
 * Where the profile lives, and what can take it from there: what the warnings say for each browser, and how old a
 * copy can be before the reminder asks for another.
 *
 * The profile is kept in this browser and nowhere else unless the person puts it somewhere, and browsers do not lose a site's
 * data the same way. Safari — on an iPhone, an iPad or a Mac — deletes everything a site keeps after seven days of using Safari
 * without visiting it (webkit.org/blog/10218). A web app added to the home screen of an iPhone is not part of Safari, counts its
 * own days and, WebKit says, is not expected to lose its data: that is documented, and it is the only place it is. The Dock of a
 * Mac (Safari 17) is not: what WebKit wrote about those apps says how they are added and what they share with Safari, and nothing
 * about when their data is deleted, so for them nothing is promised. Chromium and Firefox keep a site's data until the device runs
 * short of room, unless the site was allowed to keep it (`navigator.storage.persist`). Safari 17 grants that mostly to apps on the
 * home screen (webkit.org/blog/14403), and it is no defence against the seven days anyway: in a Safari tab what is worth offering
 * is to install it, not the button. The sources, and the test that would measure how often a profile is actually lost, are in
 * `docs/durabilidad.md`.
 *
 * Pure: the browser is read by `useBrowserSetting` (`lib/pwa/install.ts`), so what is said for each one is tested without one.
 */

import { whenWords } from "@/lib/profile/sync-status";

/** Which browser, as far as what it does with a site's data goes. */
export type Browser =
  /** Safari, on an iPhone or an iPad. */
  | "safari"
  /** Safari, on a Mac. */
  | "safari-mac"
  /** Another browser on an iPhone or an iPad — Chrome, Firefox, Edge, an app's own window — with WebKit underneath, not Safari. */
  | "ios-other"
  /** Chrome, Edge, Brave, Opera, Samsung Internet, on a computer or on Android. */
  | "chromium"
  | "firefox"
  | "other";

export type BrowserSetting = {
  browser: Browser;
  /** Running as an app from the home screen or the Dock, not in a tab. */
  installed: boolean;
};

type Agent = { userAgent: string; platform: string; touchPoints: number };

/** An iPhone, an iPad or an iPod — or an iPad that asks to be taken for a Mac, which its touch screen gives away. */
export function isIOS(input: Agent): boolean {
  return /iPhone|iPad|iPod/.test(input.userAgent) || (input.platform === "MacIntel" && input.touchPoints > 1);
}

/** What another browser on iOS calls itself, to tell it from Safari: every one of them says "Safari" too. */
const NOT_SAFARI_ON_IOS = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YaBrowser|DuckDuckGo/;

export function browserOf(input: Agent): Browser {
  const agent = input.userAgent;
  if (isIOS(input)) return /Safari\//.test(agent) && !NOT_SAFARI_ON_IOS.test(agent) ? "safari" : "ios-other";
  if (/Firefox\//.test(agent)) return "firefox";
  if (/Chrome\/|Chromium\/|Edg\//.test(agent)) return "chromium";
  if (/Version\/[\d.]+.*Safari\//.test(agent)) return "safari-mac";
  return "other";
}

export function settingOf(input: Agent & { standalone: boolean }): BrowserSetting {
  return { browser: browserOf(input), installed: input.standalone };
}

/** Before the browser can be read — on the server, and on the first render after it — nothing is assumed about it. */
export const UNKNOWN_SETTING: BrowserSetting = { browser: "other", installed: false };

/** What can take the profile from here. */
export type Risk =
  /** Safari in a tab: seven days of using Safari without coming here and it is gone. */
  | "seven_days"
  /** An app on the home screen of an iPhone or an iPad: it counts its own days, apart from Safari's (WebKit says so). */
  | "own_counter"
  /** An app in the Dock of a Mac: apart from the tabs of Safari, and nothing is said of when its data goes. */
  | "dock"
  /** Chromium or Firefox: kept until the device runs short of room, unless the browser agreed to keep it. */
  | "pressure"
  /** Nothing known about this one: it can lose it, and when is not something to guess. */
  | "unknown";

export function riskOf(setting: BrowserSetting): Risk {
  switch (setting.browser) {
    case "safari":
      // What WebKit documents: an app on the home screen is not a Safari tab, and counts its own days.
      return setting.installed ? "own_counter" : "seven_days";
    case "safari-mac":
      return setting.installed ? "dock" : "seven_days";
    case "chromium":
    case "firefox":
      return "pressure";
    // Another browser on iOS runs on WebKit, and what WebKit wrote is about Safari: it is not guessed at.
    default:
      return "unknown";
  }
}

/** The sentence that says it, for the card and for the reminder. Plain text: each screen sets it as it likes. */
export const RISK_TEXT: Record<Risk, string> = {
  seven_days: "Safari borra todo lo que guarda un sitio cuando pasan siete días en los que usás Safari sin entrar a ese sitio.",
  own_counter:
    "Como app de la pantalla de inicio, cvexact cuenta sus propios días, aparte de Safari: según el equipo de Safari, así no debería perder lo que guarda.",
  dock: "Como app del Dock, cvexact se trata aparte de las pestañas de Safari, pero Safari no dice cuándo borra lo que guarda una app así: una copia en un archivo sigue siendo lo seguro.",
  pressure: "El navegador conserva lo que guarda un sitio, pero si al celular o a la computadora le falta espacio puede borrarlo sin avisar, salvo que haya aceptado conservarlo.",
  unknown: "Un navegador puede perder lo que guarda un sitio: si se borran sus datos, si se queda sin espacio o si cambiás de celular o de computadora.",
};

/** Why a copy is worth making, for the reminder in «Para hacer»: the same risk, said from the other side. */
export const COPY_REASON: Record<Risk, string> = {
  seven_days: "Vive solo en este navegador, y Safari borra todo lo que guarda un sitio cuando pasan siete días en los que lo usás sin entrar acá.",
  own_counter: "Vive solo en este celular o computadora: si lo cambiás, o si se borran sus datos, se pierde.",
  dock: "Vive solo en este celular o computadora: si lo cambiás, o si se borran sus datos, se pierde.",
  pressure: "Vive solo en este navegador, y un navegador puede perderlo: si se borran los datos del sitio, si al celular o a la computadora le falta espacio, o si cambiás de uno.",
  unknown: "Vive solo en este navegador, y un navegador puede perderlo: si se borran los datos del sitio o si cambiás de celular o de computadora.",
};

/** What can be done about it, in the order it helps. */
export type Offer =
  /** Put it on the home screen or in the Dock (`offerInstallOnce`, from the tap that downloads a CV: it does nothing where the browser cannot). */
  | "install"
  /** Ask the browser to keep it (`keepDataQuietly`, after a CV came out: it does nothing where it cannot be asked or already agreed). */
  | "persist"
  /** A file. */
  | "copy"
  /** The account. */
  | "account";

export function offersFor(setting: BrowserSetting): Offer[] {
  switch (riskOf(setting)) {
    case "seven_days":
      return ["install", "copy", "account"];
    case "own_counter":
    case "dock":
      // An app on the home screen is what Safari 17 grants persistence to: there, the button may get a yes.
      return ["persist", "copy", "account"];
    case "pressure":
    // Not known to help, and not known not to: offered where the browser can do it (each says nothing where it cannot), with what is
    // said about it being only that it may help.
    case "unknown":
      return ["persist", "install", "copy", "account"];
  }
}

/** Where Safari deletes in a week, a copy older than that is the one a loss would find. */
export const SAFARI_COPY_WINDOW_DAYS = 7;

/**
 * How old the last copy can be, with the profile changed since, before the reminder asks for another: a week where Safari
 * deletes in one, and `undefined` — the reminder's usual month — everywhere else. It is the stretch in which a loss would
 * cost the most, not a rule about the person: where nothing changed since the copy, the copy is still the profile, and
 * nothing is asked (`profileBackupDue`).
 */
export function copyWindowDays(setting: BrowserSetting): number | undefined {
  return riskOf(setting) === "seven_days" ? SAFARI_COPY_WINDOW_DAYS : undefined;
}

/** Said when there is no copy outside this browser at all: neither a file nor an account. */
export const NO_COPY_YET = "Todavía no hay ninguna copia de tu perfil fuera de este navegador.";

/**
 * When the last copy was made, said as a date and never as an absence: «Tu última copia la hiciste el 3 de mayo», not «hace 40
 * días que no hacés una». A copy is a file or the account (`recordBackupMade`), so the sentence says both.
 *
 * `accountHasIt`: the profile is in an account, which is a copy too and is told by its own line (`syncLine`) — so there is no «todavía no
 * hay ninguna copia» to say, and `null` when there is no date to give either. Without it, nothing is known of an account, and it says what
 * it always did.
 */
export function lastCopyLine(lastBackupAt: string | undefined, now: Date, accountHasIt = false): string | null {
  const when = lastBackupAt ? whenWords(lastBackupAt, now) : "";
  if (when) return `Tu última copia, en un archivo o en tu cuenta, la hiciste ${when}.`;
  return accountHasIt ? null : NO_COPY_YET;
}

/** What holds the person's profile, as far as where a download goes and what to call it: an iPhone or an iPad, an Android phone, or a computer. */
export type Place = "ios" | "android" | "computer";

export function placeOf(input: Agent): Place {
  if (isIOS(input)) return "ios";
  return /Android/i.test(input.userAgent) ? "android" : "computer";
}

/** The two sizes of a copy: the profile, or the profile and the postings. */
export type CopySize = "profile" | "complete";

const COPY_WENT: Record<Place, string> = { ios: "«Archivos › Descargas»", android: "«Descargas»", computer: "la carpeta «Descargas»" };
const COPY_LEAVE: Record<Place, string> = { ios: "este celular", android: "este celular", computer: "esta computadora" };

/**
 * What is said right after a copy is downloaded, in three lines: where it went, to keep it somewhere else, and how it comes back. A copy that stays in the
 * folder of downloads of the same phone that loses the profile is no copy: it is the one thing that is not said by the download itself, and where it matters most —the
 * phone— a file «saved» in Safari is a file nobody can find. Where the browser keeps downloads is what the system says by default (`Archivos › Descargas` on an iPhone,
 * `Descargas` elsewhere): a person who chose another place knows where it is.
 */
export function copySavedLines(place: Place, { size, locked }: { size: CopySize; locked: boolean }): string[] {
  return [
    size === "complete"
      ? `Bajamos la copia completa: tu perfil y tus postulaciones, sin tus keys. Quedó donde tu navegador guarda las descargas: ${COPY_WENT[place]}.`
      : `Bajamos tu copia. Quedó donde tu navegador guarda las descargas: ${COPY_WENT[place]}.`,
    `Guardala también fuera de ${COPY_LEAVE[place]}, en tu correo o en tu nube: si se borran los datos, es lo que te devuelve el perfil.`,
    `Para recuperarla: «Introducir perfil», en Ajustes${locked ? ", con la contraseña que elegiste" : ""}.`,
  ];
}

/**
 * What is in order, said once at the foot of the profile when nothing asks for a copy or for an upload: «Tu última copia: el 3 de mayo · Tu cuenta tiene tu perfil al día.»
 * The date of the last copy and what the account has, and never how long since (CT6). `null` when there is nothing to say: no copy that is known and no account that has it.
 */
export function copyFooter(input: { lastBackupAt?: string | undefined; accountSynced: boolean }, now: Date): string | null {
  const when = input.lastBackupAt ? whenWords(input.lastBackupAt, now) : "";
  const parts = [when ? `Tu última copia: ${when}` : "", input.accountSynced ? "Tu cuenta tiene tu perfil al día" : ""].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" · ")}.` : null;
}

/**
 * How long «Ahora no» holds the reminder to make a copy: the usual stretch, but never longer than the one in which a loss would cost the
 * most. In a Safari tab that is a week; a fortnight of silence would be twice the time Safari takes to delete the profile.
 */
export function snoozeDays(setting: BrowserSetting, usual: number): number {
  return Math.min(usual, copyWindowDays(setting) ?? usual);
}

/** «en una semana», «en dos semanas»: when a reminder that was put off comes back, said so the button can promise it. */
export function inWeeks(days: number): string {
  const weeks = Math.max(1, Math.round(days / 7));
  return weeks === 1 ? "en una semana" : weeks === 2 ? "en dos semanas" : `en ${weeks} semanas`;
}
