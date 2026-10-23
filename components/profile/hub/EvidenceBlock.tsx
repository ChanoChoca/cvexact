"use client";

import { useState } from "react";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import { REGISTRY_GROUP_LABEL, mayBeIn, registriesFor, registryById, type Registry } from "@/lib/evidence/registries";
import {
  ADD_PROBLEM,
  EVIDENCE_LABEL,
  SIGNATURE_NOTE,
  activeEvidence,
  addCvLink,
  addEvidence,
  holderOf,
  inCvLinks,
  removeEvidence,
  restoreEvidence,
  shortUrl,
  type AddResult,
  type EvidenceKind,
  type EvidenceTarget,
} from "@/lib/profile/evidence";
import { MAX_EVIDENCE, type Evidence, type StoredProfile } from "@/lib/schemas/profile-v2";
import { useExperiment } from "@/lib/use-experiment";
import { PhotoReader, photoReceipt, type CredentialKind, type OnUse } from "./CredentialPhoto";
import { LABEL, edit } from "./cells";

/**
 * What shows a job, a study, a certification or a project, beside it (e5, O13 and O14): a page, or a register where the person looked themselves up,
 * and what they say is seen there. It is the person's to give and nothing asks for it — a thing with nothing beside it is a thing they said — and it
 * is switched off (`lib/experiments.ts`): with both switches off this draws nothing at all, whatever the profile holds.
 *
 * The app does not open the address, read the page or send anything to a register. The register opens in another tab, with no address of ours and
 * nothing of the profile in it, and what is kept of it is the day and what the person says they saw.
 *
 * On a certification the photo of the credential (O18) is one more way of adding something to it, and it is the same entry: one button on the card —«Agregar un respaldo
 * o una foto»—, not one for each, and what each is for is said once for the whole section (`BackingNote`) and not under every card. What was taken off, or read from a photo,
 * is told in a line with its way back.
 */

const dayLine = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
};

/** When it was put there, in the words that go with what it is. */
export function whenLine(entry: Evidence): string {
  const day = dayLine(entry.at);
  if (!day) return "";
  if (entry.type === "registry") return `Visto el ${day}`;
  if (entry.type === "signed") return `Firma comprobada el ${day}`;
  return `Agregado el ${day}`;
}

// --- One piece of evidence ----------------------------------------------------------------------------

export function EvidenceItem({
  entry,
  inCv,
  onCv,
  onRemove,
}: {
  entry: Evidence;
  /** The address is already among the links of the CV: there is nothing left to offer. */
  inCv: boolean;
  onCv: () => void;
  onRemove: () => void;
}) {
  const registry = registryById(entry.registry);
  const when = whenLine(entry);
  return (
    <li data-evidence={entry.id} data-evidence-type={entry.type} className="space-y-2 border border-rule bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Only a signature is something the app checked: what was seen in a register is the person's word, and a link is a page nobody here opened. */}
        <Badge tone={entry.type === "signed" ? "good" : entry.type === "registry" ? "info" : "neutral"}>{EVIDENCE_LABEL[entry.type]}</Badge>
        {registry ? <span className="text-xs text-ink-2">{registry.name}</span> : null}
        {entry.via === "badge" ? <span className="text-xs text-ink-3">Insignia importada de un archivo</span> : null}
        {entry.via === "github" ? <span className="text-xs text-ink-3">Traído de GitHub</span> : null}
      </div>
      {entry.url ? (
        <a href={entry.url} target="_blank" rel="noopener noreferrer nofollow" className="block text-sm break-all text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white pointer-coarse:-my-2.5 pointer-coarse:py-3">
          {shortUrl(entry.url)}
        </a>
      ) : null}
      {entry.phrase ? <p className="text-sm wrap-break-word text-ink-2">{entry.phrase}</p> : null}
      {entry.type === "signed" ? <p className="text-xs text-ink-3">{SIGNATURE_NOTE}</p> : null}
      {when ? <p className="text-xs text-ink-3">{when}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {entry.url ? (
          <Button type="button" variant="ghost" compact disabled={inCv} onClick={onCv}>
            {inCv ? "Está en los enlaces de tu CV" : "Poner en los enlaces de mi CV"}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button type="button" variant="danger" compact onClick={onRemove} aria-label={`Quitar este respaldo: ${entry.phrase || shortUrl(entry.url) || EVIDENCE_LABEL[entry.type]}`}>
          Quitar
        </Button>
      </div>
    </li>
  );
}

// --- Adding one ---------------------------------------------------------------------------------------

/** The registers, as a list to choose from, grouped by what they show. */
function RegistryChoices({ kind }: { kind: EvidenceKind }) {
  const registries = registriesFor(kind);
  const groups = [...new Set(registries.map((registry) => registry.group))];
  return (
    <>
      <option value="">Elegí un registro…</option>
      {groups.map((group) => (
        <optgroup key={group} label={REGISTRY_GROUP_LABEL[group]}>
          {registries
            .filter((registry) => registry.group === group)
            .map((registry) => (
              <option key={registry.id} value={registry.id}>
                {registry.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

/** What the register says it holds, for the study in front of the person: a degree from before it began is not one it lacks. */
function CoverageNote({ registry, endedIn }: { registry: Registry; endedIn: number | undefined }) {
  const may = mayBeIn(registry, endedIn);
  return (
    <>
      <p className="text-xs text-ink-3">{registry.covers}</p>
      {may === false ? (
        <p className="text-xs text-amber-300" data-registry-before>
          Este estudio terminó en {endedIn}, antes de {registry.fromYear}: no tiene por qué figurar.
        </p>
      ) : null}
    </>
  );
}

/** What the card says it did, in a line, and the way to take it back when there is one: the function that does it says what became of it. */
type Notice = { text: string; undo?: () => string };

/** What the person can add to this thing, as the modes of one panel. */
type Mode = "link" | "registry" | "photo";

const MODE_LABEL: Record<Mode, string> = { link: "Un enlace", registry: "Un registro oficial", photo: "Una foto" };

/** The photo that can be read for a certification: what kind of credential it is, what it says now, and what to do with what is confirmed. */
export type PhotoFor = { kind: CredentialKind; current?: string; onUse: OnUse };

function AddEvidence({
  target,
  linksOn,
  registriesOn,
  photo,
  endedIn,
  onAdded,
}: {
  target: EvidenceTarget;
  linksOn: boolean;
  registriesOn: boolean;
  /** Reading the photo of the credential is among the ways to add: only on a certification, and only when it is switched on. */
  photo: PhotoFor | null;
  /** For a study: the year it ended, when it says. */
  endedIn: number | undefined;
  onAdded: (notice: Notice) => void;
}) {
  const canRegistry = registriesOn && registriesFor(target.kind).length > 0;
  const modes: Mode[] = [...(linksOn ? (["link"] as const) : []), ...(canRegistry ? (["registry"] as const) : []), ...(photo ? (["photo"] as const) : [])];
  const withEvidence = linksOn || canRegistry;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(modes[0] ?? "link");
  const [url, setUrl] = useState("");
  const [phrase, setPhrase] = useState("");
  const [registryId, setRegistryId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const registry = registryById(registryId);

  const close = () => {
    setOpen(false);
    setUrl("");
    setPhrase("");
    setRegistryId("");
    setProblem(null);
  };

  if (!open) {
    // One entry for whatever can be added: the two used to be one button each, with their explanation twice, on every certification.
    const label = photo ? (withEvidence ? "+ Agregar un respaldo o una foto" : "Leer de una foto") : "+ Agregar un respaldo";
    return (
      <Button type="button" variant="secondary" compact onClick={() => setOpen(true)} data-evidence-add>
        {label}
      </Button>
    );
  }

  const problemId = `evidence-problem-${target.id}`;
  const save = () => {
    // Assigned inside the change, which is a function the type checker does not follow: say what it can be.
    let result = null as AddResult | null;
    edit((draft) => {
      result =
        mode === "link"
          ? addEvidence(draft, target, { type: "link", url, phrase })
          : addEvidence(draft, target, { type: "registry", registry: registryId, phrase, ...(url.trim() ? { url } : {}) });
    });
    if (!result || !result.ok) {
      setProblem(ADD_PROBLEM[result ? result.reason : "nothing_there"]);
      return;
    }
    const added = result.evidence.id;
    close();
    onAdded({
      text: mode === "link" ? "Agregamos el respaldo." : "Anotamos lo que viste.",
      // Taking it off is what undoes it: it stays, inert, as every removal does (`removeEvidence`).
      undo: () => {
        edit((draft) => void removeEvidence(draft, target, added));
        return "Listo: lo sacamos.";
      },
    });
  };

  return (
    <div className="space-y-3 border border-rule p-3" data-evidence-form>
      {modes.length > 1 ? (
        <div role="group" aria-label={photo ? "Qué agregar" : "Qué respaldo agregar"} className="flex flex-wrap gap-2">
          {modes.map((choice) => (
            <Button key={choice} type="button" variant={mode === choice ? "primary" : "secondary"} compact aria-pressed={mode === choice} onClick={() => setMode(choice)}>
              {MODE_LABEL[choice]}
            </Button>
          ))}
        </div>
      ) : null}

      {mode === "photo" && photo ? (
        <PhotoReader
          embedded
          kind={photo.kind}
          current={photo.current ?? ""}
          onClose={close}
          onUse={(result) => {
            const undo = photo.onUse(result);
            close();
            onAdded({
              text: photoReceipt(photo.kind, result),
              ...(undo
                ? {
                    undo: () => {
                      undo();
                      return "Listo: quedó como estaba.";
                    },
                  }
                : {}),
            });
          }}
        />
      ) : mode === "link" ? (
        <>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`ev-url-${target.id}`}>
              Enlace
            </label>
            <Input id={`ev-url-${target.id}`} value={url} maxLength={300} placeholder="https://" inputMode="url" autoComplete="off" onChange={(event) => setUrl(event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`ev-phrase-${target.id}`}>
              Qué se ve ahí
            </label>
            <Textarea id={`ev-phrase-${target.id}`} rows={2} value={phrase} maxLength={300} placeholder="Con tus palabras: por ejemplo, fotos de obras que hice" onChange={(event) => setPhrase(event.target.value)} />
          </div>
          <p className="text-xs text-ink-3" data-evidence-notice>
            Guardamos el enlace y lo que escribas acá, nada más. No abrimos el enlace, y esa página no debería mostrar datos de otras personas —clientes, compañeros, familiares— sin que lo sepan.
          </p>
        </>
      ) : (
        <>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`ev-registry-${target.id}`}>
              Registro
            </label>
            <Select id={`ev-registry-${target.id}`} value={registryId} onChange={(event) => setRegistryId(event.target.value)}>
              <RegistryChoices kind={target.kind} />
            </Select>
          </div>
          {registry ? (
            <div className="space-y-2" data-registry={registry.id}>
              <p className="text-sm text-ink-2">{registry.how}</p>
              <CoverageNote registry={registry} endedIn={endedIn} />
              <a
                href={registry.url}
                target="_blank"
                rel="noopener noreferrer"
                data-registry-open
                className="inline-flex items-center gap-2 text-sm text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white pointer-coarse:min-h-11"
              >
                Abrir el registro en otra pestaña
              </a>
              <p className="text-xs text-ink-3">Se abre su página y nada más: no le mandamos nada tuyo. Cuando vuelvas, contanos qué viste.</p>
            </div>
          ) : null}
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`ev-phrase-${target.id}`}>
              Lo que viste
            </label>
            <Textarea id={`ev-phrase-${target.id}`} rows={2} value={phrase} maxLength={300} placeholder="Con tus palabras: por ejemplo, el título tal como figura, o el número de matrícula" onChange={(event) => setPhrase(event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`ev-url-${target.id}`}>
              Enlace a tu ficha (opcional)
            </label>
            <Input id={`ev-url-${target.id}`} value={url} maxLength={300} placeholder="https://" inputMode="url" autoComplete="off" onChange={(event) => setUrl(event.target.value)} />
          </div>
          <p className="text-xs text-ink-3">Guardamos lo que escribas y el día que lo viste, nada más.</p>
        </>
      )}

      {mode === "photo" ? null : (
        <>
          {problem ? (
            <p id={problemId} role="alert" className="text-xs text-amber-300">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" compact onClick={save} disabled={mode === "registry" && registryId === ""} aria-describedby={problem ? problemId : undefined}>
              {mode === "link" ? "Guardar" : "Guardar lo que vi"}
            </Button>
            <Button type="button" variant="ghost" compact onClick={close}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// --- What each is for, once ----------------------------------------------------------------------------

const NOUN: Record<EvidenceKind, string> = { experience: "puesto", education: "estudio", certification: "certificación", project: "proyecto" };

/**
 * What the respaldo is, and what the photo of a credential is for, said once for the whole section and not under every card: it was the same sentence on each certification, with two
 * buttons below it. Draws nothing — not a line, not a space — unless something that can be added to this kind of thing is switched on.
 */
export function BackingNote({ kind }: { kind: EvidenceKind }) {
  const links = useExperiment("evidence_links");
  const registries = useExperiment("official_registries") && registriesFor(kind).length > 0;
  const photo = useExperiment("credential_photo") && kind === "certification";
  if (!links && !registries && !photo) return null;
  const how = links && registries ? "un enlace o un registro oficial" : links ? "un enlace" : "un registro oficial";
  return (
    <p className="max-w-[60ch] text-xs leading-relaxed text-ink-3" data-backing-note>
      {links || registries ? `Respaldo, si querés: ${how} donde se vea cada ${NOUN[kind]}, con tus palabras. Lo que no respaldás queda como lo contaste.` : ""}
      {links || registries ? " " : ""}
      {photo ? "Para lo que vence, podés leer la fecha de una foto de la credencial." : ""}
    </p>
  );
}

// --- The block ------------------------------------------------------------------------------------------

function endYear(profile: StoredProfile, target: EvidenceTarget): number | undefined {
  if (target.kind !== "education") return undefined;
  return profile.education.find((entry) => entry.id === target.id)?.end.value.year;
}

const UNDO = "underline decoration-oro-soft underline-offset-4 hover:text-ink pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5";

/**
 * The block on a card of the profile: what is beside the thing, and a way to add something. Draws nothing — not an empty heading, not a button —
 * unless one of the switches is on; and no hint that something is missing, because it is not: most things have nothing beside them. What each way of adding is
 * for is said once per section (`BackingNote`), so the card has its entries and one button.
 *
 * `photo`: on a certification, the photo of the credential is read from the same button.
 */
export function EvidenceBlock({ profile, target, photo }: { profile: StoredProfile; target: EvidenceTarget; photo?: PhotoFor }) {
  const linksOn = useExperiment("evidence_links");
  const registriesOn = useExperiment("official_registries");
  const photoOn = useExperiment("credential_photo");
  // A badge and a repository from GitHub leave their evidence beside the thing they made: it is shown, and can be taken off, though they offer no way to add more.
  const badgesOn = useExperiment("open_badges");
  const githubOn = useExperiment("github_projects");
  const [notice, setNotice] = useState<Notice | null>(null);
  const holder = holderOf(profile, target);
  const entries = holder ? activeEvidence(holder) : [];
  const room = entries.length < MAX_EVIDENCE;
  const canRegistry = registriesOn && registriesFor(target.kind).length > 0;
  const reading = photoOn && photo ? photo : null;
  const canAdd = (room && (linksOn || canRegistry)) || reading !== null;
  if (!holder || !(canAdd || linksOn || canRegistry || ((badgesOn || githubOn) && entries.length > 0))) return null;

  return (
    <div className="space-y-3 border-t border-rule pt-4" data-evidence-block={target.id}>
      {entries.length > 0 ? (
        <>
          <p className={LABEL}>Respaldo</p>
          <ul className="space-y-3">
            {entries.map((entry) => (
              <EvidenceItem
                key={entry.id}
                entry={entry}
                inCv={entry.url !== "" && inCvLinks(profile, entry.url)}
                onCv={() => {
                  let result = "added";
                  edit((draft) => void (result = addCvLink(draft, entry.url)));
                  setNotice({
                    text:
                      result === "added"
                        ? "Lo pusimos entre los enlaces de tu CV."
                        : result === "full"
                          ? "Ya tenés tres enlaces en tu CV, que es lo que entra: sacá uno en Datos personales."
                          : "Ya estaba entre los enlaces de tu CV.",
                  });
                }}
                onRemove={() => {
                  edit((draft) => void removeEvidence(draft, target, entry.id));
                  setNotice({
                    text: "Quitaste el respaldo.",
                    undo: () => {
                      let result = "gone" as ReturnType<typeof restoreEvidence>;
                      edit((draft) => void (result = restoreEvidence(draft, target, entry.id)));
                      return result === "restored"
                        ? "Listo: lo recuperamos."
                        : result === "full"
                          ? `Ya hay ${MAX_EVIDENCE} respaldos acá: quitá alguno para recuperar este.`
                          : result === "already"
                            ? "Ya tenés uno igual."
                            : "No lo encontramos.";
                    },
                  });
                }}
              />
            ))}
          </ul>
        </>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-ink-2" data-evidence-notice-line>
          {notice.text}
          {notice.undo ? (
            <>
              {" "}
              <button
                type="button"
                className={UNDO}
                onClick={() => {
                  const next = notice.undo?.();
                  setNotice(next ? { text: next } : null);
                }}
              >
                Deshacer
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {canAdd ? (
        <AddEvidence target={target} linksOn={linksOn && room} registriesOn={registriesOn && room} photo={reading} endedIn={endYear(profile, target)} onAdded={setNotice} />
      ) : !room && (linksOn || canRegistry) ? (
        <p className="text-xs text-ink-3">Ya hay {MAX_EVIDENCE} respaldos acá: quitá alguno para agregar otro.</p>
      ) : null}
    </div>
  );
}
