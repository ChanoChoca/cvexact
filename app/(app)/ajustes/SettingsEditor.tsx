"use client";

import { useId, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeading,
  SectionTitle,
  SecretInput,
  Select,
} from "@/components/ui";
import { CrashGuard } from "@/components/ui/CrashGuard";
import { GoogleRowNotice } from "@/components/ai/GoogleNotice";
import { ByokSetup } from "@/components/billing/ByokSetup";
import { ApiError, fetchModels } from "@/lib/api/client";
import {
  useHydrated,
  useProviderNotes,
  useProviderNotesWritable,
  useSettings,
} from "@/lib/storage/hooks";
import { formatElapsed } from "@/lib/tracker/format";
import {
  clearProviderNote,
  emptyEntry,
  noteIsFresh,
  recordProviderNotes,
  resolvedModel,
  saveSettings,
  type ProviderEntry,
  type ProviderNote,
} from "@/lib/storage/local";
import { TO_AN_UNVERIFIED_PROVIDER } from "@/lib/legal/data-flow";
import type { GenerationErrorKind } from "@/lib/ai/error-kind";
import {
  ACCOUNT_ID_LABEL,
  BYOK_PROVIDERS,
  DEFAULT_MODEL,
  isExperimental,
  needsAccountId,
  PROVIDER_KEY_URL,
  PROVIDER_LABEL,
  PROVIDERS,
  type ModelOption,
  type ProviderId,
} from "@/lib/ai/provider-catalog";

/**
 * How each provider reads to a user choosing one. The catalogue above holds the
 * facts the server also needs — ids, labels, default models, key URLs — so this
 * page cannot drift from what the server will actually do with the key. What
 * stays here is only the copy, which is the server's business not at all.
 */
export const PROVIDER_NOTE: Record<ProviderId, string> = {
  google:
    "Tiene un nivel gratuito con límites diarios, que es la opción más barata, y uno pago. Las condiciones de cada uno " +
    "—qué hace Google con lo que le mandás— están en el aviso de arriba.",
  cerebras:
    "Su nivel gratuito da 1 millón de tokens por día, sin tarjeta, y se recarga solo. " +
    "Deja 30.000 tokens por minuto y 65.000 de contexto: alcanza de sobra para generar " +
    "un CV entero. A cambio acepta pocos pedidos por minuto, así que conviene no " +
    "apurar una generación atrás de la otra.",
  cloudflare:
    "Da 10.000 «neurons» por día que se recargan solos a la medianoche UTC, sin tarjeta y " +
    "sin vencimiento: alcanzan para varios CV diarios. Pedile un token de tipo «Workers AI» " +
    "y copiá además el Account ID, que está en el panel de Cloudflare, en Workers & Pages " +
    "(son 32 caracteres). Sin los dos no anda.",
  openrouter:
    "Da acceso a muchos modelos con una sola key. Los que terminan en «:free» no " +
    "cuestan nada pero tienen un tope de pedidos por día.",
  groq:
    "El más rápido de todos. Su nivel gratuito limita a 8000 tokens por minuto, que no " +
    "alcanzan para generar un CV: para eso hace falta su plan pago. El resto " +
    "(email, respuestas) sí entra. Poniendo otro proveedor debajo, el CV cae solo " +
    "en ese y el resto sigue saliendo por acá.",
  mistral:
    "Tiene un nivel gratuito sin tarjeta (~1000 millones de tokens por mes) pero con pocos " +
    "pedidos por minuto; para más volumen es de pago.",
  nvidia:
    "Da 1000 créditos por mes que se renuevan, sin tarjeta, con más de 100 modelos " +
    "abiertos detrás de una sola key.",
  requesty:
    "Deja 200 pedidos por día sin tarjeta, que se recargan solos. Su lista gratuita es " +
    "en la práctica un solo modelo (el que viene por defecto): de los otros, la mayoría " +
    "entrena con lo que le mandás, y eso queda avisado en «Ver modelos disponibles».",
  bazaarlink:
    "Deja 50 pedidos por día sin tarjeta, que se recargan solos y no vencen.",
  airforce:
    "Deja 1000 pedidos por día sin tarjeta, pero solo 1 por minuto: como un CV son varias " +
    "llamadas seguidas, generar uno entero tarda unos tres minutos. Su nivel gratuito son " +
    "modelos abiertos (gpt-oss, Mistral, Gemma); el resto del catálogo gasta créditos.",
  cohere:
    "Su key de prueba es gratuita (1000 llamadas por mes) pero solo permite uso no " +
    "comercial; para cualquier otra cosa hace falta una key de producción, que es paga.",
  llm7:
    "El token sale con solo poner un mail, sin tarjeta ni consola, y da 40 pedidos por " +
    "minuto y un millón de tokens cada 24 horas, que se recargan solos. Ojo: de su " +
    "catálogo son gratis apenas seis modelos, y «Ver modelos disponibles» muestra " +
    "únicamente esos.",
  // Never rendered: Together is in `SERVICE_ONLY_PROVIDERS`, so it is not in
  // `BYOK_PROVIDERS` and cannot be picked here. The entry exists because this
  // table is exhaustive over `ProviderId` by type, and that exhaustiveness is
  // the thing that stops the *next* provider from reaching this page without a
  // description — which is what `tests/provider-catalog.test.ts` guards.
  together:
    "Es el proveedor con el que corremos nuestra propia key para quien paga. Es prepago: " +
    "no tiene nivel gratuito, así que no se ofrece acá.",
  // Never rendered, same reason as `together` above.
  deepseek:
    "El otro proveedor con el que corremos nuestra propia key para quien paga. También " +
    "prepago y sin nivel gratuito, así que tampoco se ofrece acá.",
};

/**
 * Why each provider `isExperimental` says so about is one, in the words the
 * user gets to read before pasting a key.
 *
 * Split from the flag on purpose, the same way `PROVIDER_NOTE` is split from
 * the catalogue: `lib/ai/provider-catalog.ts` owns the fact because the server
 * reads that file too, and this page owns the sentence because nothing on the
 * server has any use for it. The reasons are per-provider rather than one
 * shared string — both are resellers, but what is unverifiable about each is
 * not the same thing, and a warning that says nothing specific teaches the
 * reader to skip the next one.
 */
export const EXPERIMENTAL_WARNING: Partial<Record<ProviderId, string>> = {
  bazaarlink:
    "Es un servicio nuevo que revende acceso de otros proveedores, y no hay forma de " +
    `verificar de dónde sale ese acceso. Tené en cuenta lo que le llega: ${TO_AN_UNVERIFIED_PROVIDER}`,
  airforce:
    "Revende acceso de otros proveedores sin procedencia verificable, y varios servicios " +
    "de reputación marcan el dominio. No pudimos comprobar que ninguna de esas marcas sea " +
    `cierta, pero tampoco lo contrario. Lo que le llega: ${TO_AN_UNVERIFIED_PROVIDER}`,
  llm7:
    "Lo mantiene una sola persona y revende acceso a modelos de Anthropic, OpenAI, Google " +
    "y xAI bajo nombres propios, sin forma de verificar de dónde sale ese acceso ni qué " +
    `pasa con lo que le mandás. Lo que le llega: ${TO_AN_UNVERIFIED_PROVIDER}`,
};

/** What the "Ver modelos disponibles" button is doing, if anything. */
type Catalogue =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; models: ModelOption[] }
  | { state: "failed"; message: string };

export function SettingsEditor() {
  const stored = useSettings();
  const hydrated = useHydrated();
  const [saved, setSaved] = useState(false);
  /** Why the last change was not kept, when the browser refused it: otherwise the field takes the typing and the key is not there. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * The guided setup made a key, in this visit. It says «Listo», and it has to stay on screen to say it: the moment the key is saved the page has one (`usingOwnKey`), and the
   * block that made it would go with the word. `cycle` starts the setup over when that key is taken out again right after.
   */
  const [keyJustSaved, setKeyJustSaved] = useState(false);
  const [cycle, setCycle] = useState(0);
  /**
   * Keyed by row: each provider has its own catalogue, and one shared slot
   * would show OpenRouter's four hundred models in Groq's field.
   */
  const [catalogues, setCatalogues] = useState<Record<number, Catalogue>>({});

  /**
   * What each key was last seen refusing, written by whatever generated last.
   *
   * Through the same `useSyncExternalStore` seam as the settings themselves, so
   * clearing a note on an edit repaints without this component tracking a copy
   * of what is already in the store.
   */
  const notes = useProviderNotes();

  /**
   * Whether those notes are making it to storage at all. False means the order
   * below stopped learning: every generation keeps paying the same failed calls
   * in the same order, and the errors on screen are the ones from the last time
   * a write succeeded — which is exactly the state that reads as "my keys
   * stopped working" while the keys are fine.
   */
  const notesWritable = useProviderNotesWritable();

  const noteFor = (entry: ProviderEntry): ProviderNote | undefined => {
    if (!entry.provider) return undefined;
    return notes[`${entry.provider}:${resolvedModel(entry)}`];
  };

  // Counted here rather than per-row, so someone with several backups does not
  // have to read every row to notice most of the chain is currently down.
  const freshNoteCount = stored.entries.filter((entry) => noteIsFresh(noteFor(entry))).length;

  const commit = (entries: ProviderEntry[]) => {
    try {
      saveSettings({ entries });
      setSaved(true);
      setSaveError(null);
    } catch (error) {
      setSaved(false);
      setSaveError(error instanceof Error ? error.message : "No pudimos guardar el cambio en este navegador.");
    }
  };

  const update = (index: number, changes: Partial<ProviderEntry>) => {
    // Editing a row answers whatever its note was complaining about — a new key
    // for a rejected one, a new model id for a retired one. Keeping the old
    // note would leave the page insisting the problem is still there.
    const previous = stored.entries[index];
    if (previous?.provider) {
      clearProviderNote(previous.provider, resolvedModel(previous));
    }
    commit(stored.entries.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));
  };

  const remove = (index: number) => {
    commit(stored.entries.filter((_, i) => i !== index));
    setCatalogues({});
  };

  /** Swaps a row with the one above it. Order is the fallback order. */
  const moveUp = (index: number) => {
    if (index === 0) return;
    const entries = [...stored.entries];
    [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
    commit(entries);
    setCatalogues({});
  };

  /**
   * Asks the provider what it serves. Nothing is cached: a retired model is
   * exactly the situation this answers, so an answer from ten minutes ago is
   * the wrong kind of help.
   */
  const loadCatalogue = async (
    index: number,
    provider: ProviderId,
    apiKey: string,
    accountId?: string,
  ) => {
    const set = (state: Catalogue) => setCatalogues((prev) => ({ ...prev, [index]: state }));
    set({ state: "loading" });
    try {
      set({ state: "ready", models: await fetchModels(provider, apiKey, accountId) });
    } catch (error) {
      set({
        state: "failed",
        message: error instanceof Error ? error.message : "No pudimos consultar los modelos.",
      });
    }
  };

  if (!hydrated) return <p className="text-sm text-ink-3">Cargando…</p>;

  const usingOwnKey = stored.entries.some((entry) => entry.provider && entry.apiKey.trim());
  // The key that was just made was taken out: no «Listo» about a key that is not there, and the setup begins again.
  if (keyJustSaved && !usingOwnKey) {
    setKeyJustSaved(false);
    setCycle((value) => value + 1);
  }
  /** While the guided setup is on the page, nothing else says what Google says: its notice is the one, and the one in the row of Google is a line. */
  const guided = !usingOwnKey || keyJustSaved;

  return (
    <div className="space-y-10" data-panel="wide">
      <PageHeading eyebrow="Preferencias" title="Mis keys">
        Las keys de la IA con la que generás.
      </PageHeading>

      <section id="tu-ia" className="space-y-4">
        <p className="text-sm text-ink-2">
          Poné tu propia API key y el producto es entero, ilimitado y gratis. Es lo que hace falta para generar: no corremos nuestra key para quien no paga.
        </p>

        <Card>
          <SectionTitle
            action={
              usingOwnKey ? (
                <Badge tone="good">Usando tu key</Badge>
              ) : (
                <Badge tone="warn">Falta tu key</Badge>
              )

            }
          >
            Tus propias API keys
          </SectionTitle>

          <Alert tone="info">
            Las keys se guardan <strong>solo en este navegador</strong> y viajan en cada pedido
            para hablar con el proveedor. No las guardamos en nuestro servidor ni quedan en los
            registros. Si usás una computadora compartida, borralas al terminar.
          </Alert>

          {/*
            * The guided path first, and the provider form under it.
            *
            * The form was the only way in, and it asks someone who has never held
            * an API key to pick a provider before it tells them what one is. This
            * is the same destination reached by answering nothing: click, copy,
            * paste. Anyone who already knows what they want scrolls past it, which
            * costs them a second and costs everyone else the whole feature.
            */}
          {guided ? (
            <div className="mt-5 border-t border-rule pt-5">
              {keyJustSaved ? null : (
                <>
                  <p className="mb-1 text-sm font-medium text-ink">
                    Conseguir una key, paso a paso
                  </p>
                  <p className="mb-5 text-sm text-ink-2">
                    Google la da con la misma cuenta de Gmail, sin tarjeta, y su nivel gratuito
                    tiene condiciones: las ves primero. Con una key tuya el producto no tiene
                    tope de nuestro lado.
                  </p>
                </>
              )}
              <ByokSetup key={cycle} inSettings onDone={() => setKeyJustSaved(true)} />
            </div>
          ) : null}

          <div className="mt-5 space-y-4 border-t border-rule pt-5">
            {stored.entries.length > 1 ? (
              <p className="text-sm text-ink-2">
                Se usan en este orden. Si el primero se queda sin cuota, sin crédito, no
                acepta el pedido o tarda demasiado, seguimos con el siguiente
                automáticamente. Cada generación prueba hasta tres, así que tener varios
                respaldos no alarga la espera.
              </p>
            ) : null}

            {!notesWritable ? (
              <Alert tone="warn">
                No pudimos guardar el estado de tus keys en este navegador, así que el orden de
                abajo puede estar desactualizado. Lo volvemos a intentar en la próxima generación.
              </Alert>
            ) : null}

            {freshNoteCount > 0 ? (
              <Alert tone="warn">
                {freshNoteCount === stored.entries.length
                  ? "Los proveedores de abajo muestran un error reciente."
                  : `${freshNoteCount} de ${stored.entries.length} proveedores de abajo muestran un error reciente.`}{" "}
                Usá «Probar esta key» en cada uno para ver si ya se resolvió.
              </Alert>
            ) : null}

            {stored.entries.map((entry, index) => (
              <ProviderRow
                key={index}
                entry={entry}
                index={index}
                total={stored.entries.length}
                catalogue={catalogues[index] ?? { state: "idle" }}
                note={noteFor(entry)}
                guided={guided}
                onChange={(changes) => update(index, changes)}
                onRemove={() => remove(index)}
                onMoveUp={() => moveUp(index)}
                onLoadCatalogue={(provider, apiKey, accountId) =>
                  void loadCatalogue(index, provider, apiKey, accountId)
                }
                onResetCatalogue={() =>
                  setCatalogues((prev) => ({ ...prev, [index]: { state: "idle" } }))
                }
              />
            ))}

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                type="button"
                onClick={() => commit([...stored.entries, emptyEntry()])}
              >
                {stored.entries.length === 0 ? "Agregar una key" : "Agregar un respaldo"}
              </Button>
              {saved ? (
                <span className="font-mono text-[11px] tracking-widest text-ink-3 uppercase">
                  Guardado
                </span>
              ) : null}
            </div>
            {saveError ? <Alert tone="bad">{saveError}</Alert> : null}
          </div>
        </Card>
      </section>
    </div>
  );
}

/**
 * What each status means on its own, for a note that carries no kind.
 *
 * The fallback path, not the main one: every note this version writes also
 * carries a `kind`, and this is what a note from an older release gets — see
 * `ProviderNote` in `@/lib/storage/local`.
 */
const STATUS_HEADLINE: Record<number, string> = {
  401: "Key rechazada",
  402: "Sin crédito",
  413: "Pedido demasiado grande",
  429: "Sin cuota",
  503: "Proveedor saturado",
  504: "Tardó demasiado",
  400: "Modelo inválido",
};

/**
 * The kind in three words, so the row leads with what to do about it.
 *
 * A closed `Record`, so a member added to `GenerationErrorKind` fails to
 * compile here until it has words to show — the same guarantee `PROVIDER_NOTE`
 * gets from its type and the settings-page test from its loop. It matters most
 * for the pair a status cannot tell apart: `model_retired` and
 * `model_not_in_plan` both arrive as a 400, and "Modelo retirado" and "Modelo
 * fuera de tu plan" send the user to two different places.
 *
 * The provider's own sentence follows this and is usually the more useful
 * half — the label is what lets someone scanning four rows find the broken one.
 *
 * Exported for the test that holds every kind to a non-empty headline, the
 * same way `PROVIDER_NOTE` is.
 */
export const KIND_HEADLINE: Record<GenerationErrorKind, string> = {
  key_rejected: "Key rechazada",
  no_credit: "Sin crédito",
  request_too_large: "Pedido demasiado grande",
  rate_limited: "Sin cuota",
  model_retired: "Modelo retirado",
  model_not_in_plan: "Modelo fuera de tu plan",
  overloaded: "Proveedor saturado",
  timeout: "Tardó demasiado",
  cancelled: "Cancelado",
  unclassified: "No pudo atender un pedido",
};

/**
 * What the row leads with. Exported for the tests that hold both halves: a note
 * with a known kind to its words, and one written by an older release to the
 * status fallback.
 */
export function noteHeadline(note: ProviderNote): string {
  if (note.kind) return KIND_HEADLINE[note.kind];
  return STATUS_HEADLINE[note.status] ?? "No pudo atender un pedido";
}

function ProviderRow({
  entry,
  index,
  total,
  catalogue,
  note,
  guided,
  onChange,
  onRemove,
  onMoveUp,
  onLoadCatalogue,
  onResetCatalogue,
}: {
  entry: ProviderEntry;
  index: number;
  total: number;
  catalogue: Catalogue;
  /** What this entry was last seen refusing, if anything. */
  note?: ProviderNote;
  /** The guided setup, with its own notice of what Google says, is on the page: the row does not say it again in full. */
  guided: boolean;
  onChange: (changes: Partial<ProviderEntry>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onLoadCatalogue: (provider: ProviderId, apiKey: string, accountId?: string) => void;
  onResetCatalogue: () => void;
}) {
  const modelListId = useId();
  const active = PROVIDERS.find((id) => id === entry.provider);
  /** Whether the note below is still one the chain acts on — see `noteIsFresh`. */
  const noteFresh = noteIsFresh(note);
  const [testState, setTestState] = useState<"idle" | "loading" | "ok">("idle");

  /**
   * Whether a model the user typed by hand is missing from a catalogue we
   * actually asked the provider for.
   *
   * Only for an explicit id: a blank field means AUTO — the app's pinned
   * default — and warning about a model the user never chose would turn our
   * decision into their mistake. It is also deliberately not a verdict: a
   * catalogue is filtered on purpose (Requesty keeps only schema-capable
   * models, airforce hides the ones reporting an outage, NVIDIA's endpoint
   * answers without auth and filters by name), so a model absent from it can
   * still work. The wording says so, and nothing here writes a note, reorders
   * the chain or blocks a generation.
   */
  const explicitModelMissing =
    catalogue.state === "ready" &&
    entry.model.trim() !== "" &&
    catalogue.models.length > 0 &&
    !catalogue.models.some((model) => model.id === entry.model.trim());

  /**
   * Pings the provider without running a generation — the same call "Ver
   * modelos disponibles" makes, but for a row that already has a model typed
   * in and just wants to know whether the key works again. Success clears a
   * stale note the same way editing the row does; failure records a fresh one
   * through the same path a real generation would, so the label matches.
   *
   * Only checks auth/reachability, the same limit `fetchModels` always had: a
   * per-minute budget too small for a CV, or a schema-compliance failure, only
   * shows up on a real `generateObject` call and can still pass this check.
   */
  const testKey = async () => {
    if (!active || !entry.apiKey.trim()) return;
    setTestState("loading");
    const modelId = resolvedModel(entry);
    try {
      await fetchModels(active, entry.apiKey.trim(), entry.accountId?.trim());
      clearProviderNote(active, modelId);
      setTestState("ok");
    } catch (error) {
      if (error instanceof ApiError) {
        recordProviderNotes([
          { provider: active, modelId, status: error.status, message: error.message },
        ]);
      }
      setTestState("idle");
    }
  };

  return (
    <div className="space-y-4 border border-rule p-5">
      <SectionTitle
        action={
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="secondary" type="button" onClick={onMoveUp}>
                Subir
              </Button>
            ) : null}
            <Button variant="danger" type="button" onClick={onRemove}>
              Quitar
            </Button>
          </div>
        }
      >
        {index === 0 ? "Principal" : `Respaldo ${index}`}
      </SectionTitle>

      {/* Shown only when this exact key/model has actually refused work. A
          rejected key or a retired model id keeps costing a failed call on
          every generation, and this is the only place that says so.
          A note past its trust window is shown quieter and said out loud as
          expired: `orderedChain` no longer acts on it, so without that sentence
          the panel reads as "this key is broken" while the app is asking it
          first — which is exactly how a working provider gets blamed. */}
      {note ? (
        <p
          className={`border border-rule bg-paper-2 px-3 py-2 text-xs ${
            noteFresh ? "text-ink-2" : "text-ink-3"
          }`}
        >
          <span className="font-medium">{noteHeadline(note)}</span> — {note.message}
          {noteFresh ? null : (
            <>
              {" "}
              <span className="font-medium">Vencida {formatElapsed(note.at)}</span> — el
              proveedor ya se vuelve a intentar.
            </>
          )}
        </p>
      ) : null}

      <Field label="Proveedor">
        <Select
          value={entry.provider}
          onChange={(e) => {
            onResetCatalogue();
            setTestState("idle");
            // The model and the account id both belong to the provider being
            // replaced, not to the row: a Cloudflare account id left behind on
            // a Groq row would be sent with every generation and reappear the
            // moment the user switched back.
            onChange({
              provider: e.target.value as ProviderEntry["provider"],
              model: "",
              accountId: undefined,
            });
          }}
        >
          <option value="">Elegí un proveedor</option>
          {/* `BYOK_PROVIDERS`, not `PROVIDERS`: the catalogue also holds the
              provider this deployment runs its own key on, which has no free
              tier and no business being offered to somebody who came here
              because they cannot pay. `active` below still resolves against
              the full list, so a row that somehow names one renders correctly
              rather than emptying itself. */}
          {BYOK_PROVIDERS.map((id) => (

            <option key={id} value={id}>
              {PROVIDER_LABEL[id]}
            </option>
          ))}
        </Select>
      </Field>

      {active ? (
        <>
          {isExperimental(active) ? (
            <Alert tone="warn" title="Proveedor experimental">
              {EXPERIMENTAL_WARNING[active]}
            </Alert>
          ) : null}

          {/* In full for whoever is about to paste a key and has not been told; a line once the key is in the row, or the setup above has said it. */}
          {active === "google" ? <GoogleRowNotice startFolded={guided || entry.apiKey.trim() !== ""} /> : null}

          <p className="text-sm text-ink-2">
            {PROVIDER_NOTE[active]}{" "}
            <a
              href={PROVIDER_KEY_URL[active]}
              target="_blank"
              rel="noreferrer"
              className="text-oro underline underline-offset-4"
            >
              Conseguir una key
            </a>
          </p>

          {/*
           * Above the key rather than below it, and not a password field: it is
           * an address, not a secret, and a masked field would invite pasting
           * the token into it — the one mistake this row can make that
           * Cloudflare answers with a 404 from a URL the user never sees.
           */}
          {needsAccountId(active) ? (
            <Field
              label={ACCOUNT_ID_LABEL[active] ?? "Account ID"}
              hint="En el panel de Cloudflare, en Workers & Pages. No es la API key."
            >
              <Input
                autoComplete="off"
                spellCheck={false}
                value={entry.accountId ?? ""}
                placeholder="32 caracteres"
                onChange={(e) => {
                  onResetCatalogue();
                  setTestState("idle");
                  onChange({ accountId: e.target.value });
                }}
              />
            </Field>
          ) : null}

          <Field label="API key">
            <SecretInput
              autoComplete="off"
              spellCheck={false}
              value={entry.apiKey}
              placeholder="Pegá tu key acá"
              onChange={(e) => {
                onResetCatalogue();
                setTestState("idle");
                onChange({ apiKey: e.target.value });
              }}
            />
          </Field>

          <CrashGuard
            title="No pudimos mostrar el catálogo de modelos"
            hint="Podés escribir el nombre del modelo a mano."
          >
            <div>
              <Field label="Modelo" hint={`Dejalo vacío para usar ${DEFAULT_MODEL[active]}.`}>
                {/*
                 * A datalist rather than a `Select`, even once the catalogue has
                 * loaded: typing still has to work. It is what makes OpenRouter's
                 * four hundred models usable, and it is the way out when a key
                 * serves something the listing endpoint does not mention.
                 *
                 * The datalist is a sibling of `Field` rather than a second child
                 * of it — `Field` only wires up the label when it is given
                 * exactly one control.
                 */}
                <Input
                  value={entry.model}
                  placeholder={DEFAULT_MODEL[active]}
                  list={catalogue.state === "ready" ? modelListId : undefined}
                  onChange={(e) => onChange({ model: e.target.value })}
                />
              </Field>

              {explicitModelMissing ? (
                <p className="mt-2 border border-rule bg-paper-2 px-3 py-2 text-xs text-ink-2">
                  Tu key no lista «{entry.model.trim()}». Puede estar retirado, fuera de tu plan,
                  o no aparecer por cómo se filtra la lista. Si algo falla, elegí otro modelo de
                  los que ofrece «Ver modelos disponibles».
                </p>
              ) : null}

              {catalogue.state === "ready" ? (
                <datalist id={modelListId}>
                  {catalogue.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label ?? model.id}
                    </option>
                  ))}
                </datalist>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={!entry.apiKey.trim() || catalogue.state === "loading"}
                  onClick={() =>
                    onLoadCatalogue(active, entry.apiKey.trim(), entry.accountId?.trim())
                  }
                >
                  {catalogue.state === "loading" ? "Consultando…" : "Ver modelos disponibles"}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={!entry.apiKey.trim() || testState === "loading"}
                  onClick={() => void testKey()}
                >
                  {testState === "loading" ? "Probando…" : "Probar esta key"}
                </Button>
                {testState === "ok" ? (
                  <span className="text-xs text-ink-3">Funciona ahora mismo.</span>
                ) : null}
                {catalogue.state === "ready" ? (
                  <span className="text-xs text-ink-3">
                    {catalogue.models.length === 0
                      ? "Tu key no lista ningún modelo de texto."
                      : `${catalogue.models.length} modelos disponibles: escribí en el campo para filtrarlos.`}
                  </span>
                ) : null}
                {!entry.apiKey.trim() ? (
                  <span className="text-xs text-ink-3">Pegá la key para consultar el catálogo.</span>
                ) : null}
              </div>

              {catalogue.state === "failed" ? (
                <div className="mt-3">
                  <Alert tone="bad">{catalogue.message}</Alert>
                </div>
              ) : null}
            </div>
          </CrashGuard>

          {index === 0 && total === 1 ? (
            <p className="text-xs text-ink-3">
              Podés agregar un respaldo abajo: si esta key se queda sin cuota, seguimos con
              la siguiente sin cortar lo que estabas haciendo.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
