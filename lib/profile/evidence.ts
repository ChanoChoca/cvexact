import { fold } from "@/lib/parse/dictionaries";
import { linkLabel } from "@/lib/parse/patterns";
import { linkKey, normalizeUrl } from "@/lib/schemas/profile";
import {
  MAX_EVIDENCE,
  type Evidence,
  type EvidenceType,
  type EvidenceVia,
  type StoredProfile,
} from "@/lib/schemas/profile-v2";
import { editContext, editFieldAt, isBlankList, recordChange, type EditContext } from "./edit";
import { MAX_LINKS } from "./links";

/**
 * What shows the things a person says (e5, O13, O14, O20, and I4): a page, an official register, a signed badge, kept beside the job, the study, the
 * certification or the project it is about — and, for each, a sentence in the person's own words about what is seen there.
 *
 * It is the person's to give and never the product's to ask for: a thing with nothing beside it is a thing they said, and that is how most things
 * are (`P14`, an absence is not a hole). Nothing here opens an address, reads a page or checks what the sentence says: what is kept of the evidence
 * is the address and the sentence, nothing the page holds (CT4: no data of anyone else is carried in).
 *
 * Everything edits a draft, goes through the history like every other edit, and says what it did.
 */

export type EvidenceKind = "experience" | "education" | "certification" | "project";
export type EvidenceTarget = { kind: EvidenceKind; id: string };

/** Where, in the profile, each kind of thing lives. */
export const EVIDENCE_LIST = {
  experience: "experience",
  education: "education",
  certification: "certifications",
  project: "projects",
} as const satisfies Record<EvidenceKind, keyof StoredProfile>;

/** What is kept of one thing at most, taken-off ones included: the oldest taken-off go first. */
const MAX_KEPT = 20;

type Holder = { id: string; evidence?: Evidence[] | undefined };
const listOf = (profile: StoredProfile, kind: EvidenceKind): Holder[] => profile[EVIDENCE_LIST[kind]] as Holder[];

/** The thing itself, in a draft or a profile. */
export function holderOf(profile: StoredProfile, target: EvidenceTarget): Holder | undefined {
  return listOf(profile, target.kind).find((entry) => entry.id === target.id);
}

/** What the thing is called wherever it is named: «Gasista matriculado», «Analista · Nubia Retail». */
export function holderLabel(profile: StoredProfile, target: EvidenceTarget): string {
  const entry = holderOf(profile, target);
  if (!entry) return "";
  switch (target.kind) {
    case "experience": {
      const job = profile.experience.find((candidate) => candidate.id === target.id);
      return job ? [job.role.value, job.company.value].filter(Boolean).join(" · ") : "";
    }
    case "education": {
      const study = profile.education.find((candidate) => candidate.id === target.id);
      return study ? study.degree.value || study.institution.value : "";
    }
    case "certification":
      return profile.certifications.find((candidate) => candidate.id === target.id)?.name.value ?? "";
    case "project":
      return profile.projects.find((candidate) => candidate.id === target.id)?.name.value ?? "";
  }
}

// --- What is on show -----------------------------------------------------------------------------------

export const isActive = (entry: Evidence): boolean => !entry.removedAt;

/** The evidence that is there: not what was taken off. */
export const activeEvidence = (holder: { evidence?: Evidence[] | undefined }): Evidence[] => (holder.evidence ?? []).filter(isActive);

/** The words for each kind of evidence, wherever it is named. */
export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  link: "Enlace",
  registry: "Registro oficial",
  signed: "Firma",
};

/**
 * What a signature does and does not say, wherever a signed one is shown: it is the one thing a person cannot read from the credential. A key that
 * arrives inside the file proves nothing about whose it is — anyone can make a key and sign — so this says what was checked and not who signed.
 */
export const SIGNATURE_NOTE = "La firma está bien con la clave que trae el archivo: nadie lo cambió después de firmado. No dice de quién es esa clave.";

/** The same, for the screen that has already said that the signature is right: what it means, without saying it twice. */
export const SIGNATURE_MEANS = "Eso quiere decir que nadie lo cambió después de firmado. No dice de quién es esa clave.";

/** From the weakest to the strongest: what a thing counts as when it has several. */
const STRENGTH: readonly EvidenceType[] = ["link", "registry", "signed"];

/** The strongest kind a thing has, or `null` when it has nothing beside it. */
export function strongest(holder: { evidence?: Evidence[] | undefined }): EvidenceType | null {
  let best = -1;
  for (const entry of activeEvidence(holder)) best = Math.max(best, STRENGTH.indexOf(entry.type));
  return best === -1 ? null : STRENGTH[best]!;
}

// --- The address ----------------------------------------------------------------------------------------

export type UrlProblem = "empty" | "invalid" | "scheme" | "credentials" | "host" | "long";
export type UrlCheck = { ok: true; url: string } | { ok: false; reason: UrlProblem };

/** Not a page anyone but this computer can see, and not something a browser would run: schemes that are not the web. */
const NOT_WEB = /^(?:javascript|data|vbscript|file|blob|about|mailto|tel|sms|ftp|ws|wss|chrome|view-source):/i;

/**
 * Whether what was typed is the address of a page out on the web, and the address as it is kept: with its scheme (`https://` when it had none),
 * and nothing else changed. A page that only this computer could see — `localhost`, a number, a name with no dot — shows nothing to whoever reads
 * a CV; one with a user and a password in it is a login written out; and anything that is not `http` or `https` is not a page.
 */
export function checkEvidenceUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty" };
  if (/\s/.test(text)) return { ok: false, reason: "invalid" };
  if (NOT_WEB.test(text)) return { ok: false, reason: "scheme" };
  const absolute = normalizeUrl(text);
  if (absolute.length > 300) return { ok: false, reason: "long" };
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, reason: "scheme" };
  if (parsed.username !== "" || parsed.password !== "") return { ok: false, reason: "credentials" };
  const host = parsed.hostname.toLowerCase();
  // A name with a dot that is not a number: `127.0.0.1` and `[::1]` are this computer, `intranet` is somebody's office.
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "host" };
  }
  return { ok: true, url: absolute };
}

/** What each problem with an address says, to whoever typed it. */
export const URL_PROBLEM: Record<UrlProblem, string> = {
  empty: "Falta el enlace.",
  invalid: "Eso no parece un enlace: pegá la dirección de la página completa.",
  scheme: "Tiene que ser la dirección de una página web, que empiece con http o https.",
  credentials: "Ese enlace trae un usuario y una clave escritos: sacalos y pegá la dirección sola.",
  host: "Ese enlace solo se abre desde una computadora o una red en particular: pegá uno que cualquiera pueda abrir.",
  long: "Ese enlace es demasiado largo: pegá uno más corto.",
};

/** The address as it is shown: without the scheme, the `www.` or a closing slash. */
export function shortUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// --- Adding and taking off ---------------------------------------------------------------------------

export type EvidenceInput = {
  type: EvidenceType;
  url?: string | undefined;
  phrase?: string | undefined;
  registry?: string | undefined;
  via?: EvidenceVia | undefined;
  check?: Evidence["check"] | undefined;
};

export type AddProblem = "nothing_there" | UrlProblem | "phrase" | "registry" | "check" | "duplicate" | "full";
export type AddResult = { ok: true; evidence: Evidence } | { ok: false; reason: AddProblem };

/** What each problem with adding says, to whoever tried. */
export const ADD_PROBLEM: Record<AddProblem, string> = {
  ...URL_PROBLEM,
  nothing_there: "Eso ya no está en tu perfil.",
  phrase: "Falta contar con tus palabras qué se ve ahí.",
  registry: "Falta decir en qué registro lo viste.",
  check: "Falta decir cómo se comprobó la firma.",
  duplicate: "Ese enlace ya está acá.",
  full: `Ya hay ${MAX_EVIDENCE} respaldos acá: quitá alguno para agregar otro.`,
};

const cleanPhrase = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

/** The same piece of evidence, said twice: the same page for the same kind, or — with no page — the same register and the same words. */
function sameEvidence(a: Pick<Evidence, "type" | "url" | "registry" | "phrase">, b: Pick<Evidence, "type" | "url" | "registry" | "phrase">): boolean {
  if (a.type !== b.type) return false;
  if (a.url !== "" || b.url !== "") return a.url !== "" && b.url !== "" && linkKey(a.url) === linkKey(b.url);
  return (a.registry ?? "") === (b.registry ?? "") && fold(a.phrase) === fold(b.phrase) && a.phrase !== "";
}

/**
 * One piece of evidence beside a thing, as the person gave it. A `link` needs its address and the person's words about what is seen there —
 * unless something read it for them (`via`), where the words are theirs to add; a `registry` needs which register and what they saw, and an
 * address only if they have one; a `signed` needs how its signature was checked. It is not added twice, and a thing has at most
 * `MAX_EVIDENCE` at once.
 */
export function addEvidence(draft: StoredProfile, target: EvidenceTarget, input: EvidenceInput, ctx: EditContext = editContext()): AddResult {
  const holder = holderOf(draft, target);
  if (!holder) return { ok: false, reason: "nothing_there" };

  let url = "";
  if (input.url !== undefined && input.url.trim() !== "") {
    const checked = checkEvidenceUrl(input.url);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    url = checked.url;
  } else if (input.type === "link") {
    return { ok: false, reason: "empty" };
  }
  const phrase = cleanPhrase(input.phrase);
  if ((input.type === "link" && !input.via && phrase === "") || (input.type === "registry" && phrase === "")) return { ok: false, reason: "phrase" };
  if (input.type === "registry" && !input.registry) return { ok: false, reason: "registry" };
  if (input.type === "signed" && !input.check) return { ok: false, reason: "check" };

  const entry: Evidence = {
    id: ctx.newId(),
    type: input.type,
    url,
    phrase,
    at: ctx.now,
    ...(input.registry ? { registry: input.registry.slice(0, 40) } : {}),
    ...(input.via ? { via: input.via } : {}),
    ...(input.check ? { check: input.check } : {}),
  };
  const active = activeEvidence(holder);
  if (active.some((other) => sameEvidence(other, entry))) return { ok: false, reason: "duplicate" };
  if (active.length >= MAX_EVIDENCE) return { ok: false, reason: "full" };

  const kept = [...(holder.evidence ?? []), entry];
  // What was taken off is only there to be remembered: when there is too much of it, the oldest goes.
  while (kept.length > MAX_KEPT) {
    const gone = kept.findIndex((candidate) => !isActive(candidate));
    if (gone === -1) break;
    kept.splice(gone, 1);
  }
  holder.evidence = kept;
  recordChange(draft, { op: "add", path: [EVIDENCE_LIST[target.kind], target.id, "evidence", entry.id], label: holderLabel(draft, target) }, ctx);
  return { ok: true, evidence: entry };
}

/**
 * Takes a piece of evidence off. It stays, inert — marked with the day — so that the profile of another device that still has it does not
 * bring it back when they are joined; undoing it in the history puts it back as it was. False when there is no such evidence.
 */
export function removeEvidence(draft: StoredProfile, target: EvidenceTarget, evidenceId: string, ctx: EditContext = editContext()): boolean {
  const holder = holderOf(draft, target);
  const index = holder?.evidence?.findIndex((entry) => entry.id === evidenceId && isActive(entry)) ?? -1;
  if (!holder?.evidence || index === -1) return false;
  const before = holder.evidence[index]!;
  const after: Evidence = { ...before, removedAt: ctx.now };
  holder.evidence[index] = after;
  recordChange(draft, { op: "set", path: [EVIDENCE_LIST[target.kind], target.id, "evidence", evidenceId], label: holderLabel(draft, target), before, after }, ctx);
  return true;
}

export type RestoreResult = "restored" | "full" | "already" | "gone";

/**
 * Puts back what was taken off, as it was — the person pressed «Deshacer» right after taking it. It touches only that piece: whatever else was edited in the
 * meantime stays as it is, which is why this and not the whole profile as it was. Not put back when the thing already has `MAX_EVIDENCE` on show —
 * something else has to go first, and which is the person's to say — nor when one just like it is there again.
 */
export function restoreEvidence(draft: StoredProfile, target: EvidenceTarget, evidenceId: string, ctx: EditContext = editContext()): RestoreResult {
  const holder = holderOf(draft, target);
  const index = holder?.evidence?.findIndex((entry) => entry.id === evidenceId && !isActive(entry)) ?? -1;
  if (!holder?.evidence || index === -1) return "gone";
  const before = holder.evidence[index]!;
  const active = activeEvidence(holder);
  if (active.some((other) => sameEvidence(other, before))) return "already";
  if (active.length >= MAX_EVIDENCE) return "full";
  const after: Evidence = { ...before };
  delete after.removedAt;
  holder.evidence[index] = after;
  recordChange(draft, { op: "set", path: [EVIDENCE_LIST[target.kind], target.id, "evidence", evidenceId], label: holderLabel(draft, target), before, after }, ctx);
  return "restored";
}

// --- In the CV -------------------------------------------------------------------------------------------

export type CvLinkResult = "added" | "already" | "full";

/**
 * Puts the address among the links a CV prints under the name — the person's own list, which a CV takes at most five of, and in which a page
 * named twice is one (`linkKey`). Never done for them: a link on a CV is something whoever reads it will open.
 */
export function addCvLink(draft: StoredProfile, url: string, ctx: EditContext = editContext()): CvLinkResult {
  const links = draft.contact.links.value;
  if (links.some((link) => linkKey(link.url) === linkKey(url))) return "already";
  if (links.length >= MAX_LINKS) return "full";
  editFieldAt(draft, ["contact", "links"], [...links, { label: linkLabel(url).slice(0, 60), url }], isBlankList, ctx);
  return "added";
}

/** Whether the address is already among the links of the CV. */
export const inCvLinks = (profile: StoredProfile, url: string): boolean => profile.contact.links.value.some((link) => linkKey(link.url) === linkKey(url));

// --- Counted (I4) -----------------------------------------------------------------------------------------

export type VerificationCounts = Record<EvidenceType, number>;

/**
 * How many things have something beside them, by the strongest kind each has: the profile's own count, for the person to see (e5, I4). A thing with
 * a link and a signature is one with a signature. The things nobody has put anything beside are not counted, and are not the rest of anything: no
 * percentage, no «sin respaldo» — what the person said is theirs, and a count of what they have not backed would only be a list of what is missing.
 */
export function verificationCounts(profile: StoredProfile): VerificationCounts {
  const counts: VerificationCounts = { link: 0, registry: 0, signed: 0 };
  const things: Array<{ evidence?: Evidence[] | undefined; excluded?: boolean | undefined }> = [
    ...profile.experience,
    ...profile.education,
    ...profile.certifications,
    ...profile.projects,
  ];
  for (const thing of things) {
    if (thing.excluded) continue;
    const kind = strongest(thing);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

const plural = (count: number, phrase: string): string => `${count} ${phrase}`;

/**
 * «Con respaldo: 2 con un enlace, 1 en un registro oficial y 1 con firma.» — only what there is; `null` when nothing has anything beside it. The
 * counts are of things — a job, a study, a certification, a project — and each says how it was shown, so no word has to agree with what it counts.
 */
export function verificationLine(counts: VerificationCounts): string | null {
  const parts = [
    counts.link > 0 ? plural(counts.link, "con un enlace") : "",
    counts.registry > 0 ? plural(counts.registry, "en un registro oficial") : "",
    counts.signed > 0 ? plural(counts.signed, "con firma") : "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const said = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  return `Con respaldo: ${said}.`;
}

// --- Two copies of one profile ------------------------------------------------------------------------

/**
 * The evidence of a thing both copies have — this browser's and the account's — as one list. What is the same piece (by id, or by what it is) is
 * one, and where either copy took it off it is off; what only the account has is brought. Returns how many of those were brought and are in sight.
 */
export function joinEvidence(mine: readonly Evidence[] | undefined, theirs: readonly Evidence[] | undefined): { list: Evidence[] | undefined; added: number } {
  if (!theirs || theirs.length === 0) return { list: mine ? [...mine] : undefined, added: 0 };
  const list = [...(mine ?? [])];
  let added = 0;
  for (const entry of theirs) {
    const index = list.findIndex((candidate) => candidate.id === entry.id || sameEvidence(candidate, entry));
    if (index === -1) {
      list.push(entry);
      if (isActive(entry)) added += 1;
    } else if (!list[index]!.removedAt && entry.removedAt) {
      list[index] = { ...list[index]!, removedAt: entry.removedAt };
    }
  }
  return { list, added };
}
