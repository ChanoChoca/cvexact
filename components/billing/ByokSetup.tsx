"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleSetupNotice, GoogleTermsLink } from "@/components/ai/GoogleNotice";
import { Alert, Button, ButtonLink, SecretInput, Spinner, cx } from "@/components/ui";
import { fetchModels } from "@/lib/api/client";
import { GOOGLE_PAID_FACTS, GOOGLE_PAID_STEPS, WITHOUT_AI } from "@/lib/ai/google-terms";
import { PROVIDER_KEY_URL } from "@/lib/ai/provider-catalog";
import { isPreviewReady } from "@/lib/cv/from-profile";
import { forgetWithoutAi, rememberWithoutAi } from "@/lib/storage/ai-choice";
import { useStoredProfile } from "@/lib/storage/hooks";
import { loadSettings, saveSettings } from "@/lib/storage/local";

/**
 * The free path, made walkable by someone who has never seen an API key.
 *
 * BYOK was always the most generous thing this product offers — the whole
 * product, no limit, no cost — and it was buried in a settings form behind the
 * words "API key", which is a wall for most of the people it was meant to help.
 * It is not a fallback here, it is the plan for anyone who cannot or will not
 * pay, so this has to actually work for someone who does not know what any of
 * these words mean.
 *
 * Google only. The other four providers stay in Ajustes for people who already
 * know what they want; offering five choices to someone who does not is how a
 * two-minute task becomes a decision they abandon.
 *
 * But the key it teaches to make is the free tier of a provider whose terms say what is sent to it is used to improve its products, can be
 * read by people there, must not be anything personal, and is for people of 18 or older (`lib/ai/google-terms.ts`). Someone who is led to it
 * is told that first, before the key exists, and chooses with three ways on that weigh the same: the free key, a key of the paid tier, or no
 * model at all. A fourth, another provider, is in Ajustes, where the providers are.
 *
 * «Sigo sin IA» is an answer, and it is kept (`lib/storage/ai-choice.ts`): the offer of a key does not come back at the end of every session as if nothing had been said, and
 * the way on is the one thing that needs no model — the CV the profile already makes. A way to have an AI, chosen later, takes it back.
 */

const FREE_STEPS = [
  {
    title: "Abrí Google AI Studio",
    body: "Entrás con tu cuenta de Google, la misma de Gmail. No pide tarjeta.",
  },
  {
    title: "Tocá «Create API key»",
    body: "Te da una línea larga de letras y números. Copiala entera.",
  },
] as const;

/*
 * Decía "no sale de tu máquina", que es falso y verificable: `lib/api/client.ts`
 * la manda en el header `x-cvp-key` en CADA generación, y `lib/api/context.ts`
 * lee la cadena entera desde un header base64. Lo que sí es cierto —y es lo
 * que tranquiliza— es que no se persiste: `resolveModel` la usa para construir
 * el cliente y la descarta. Una afirmación falsa sobre el manejo de una
 * credencial es lo primero que aparece en un reclamo, así que acá se dice lo
 * que pasa.
 */
const PASTE_STEP = {
  title: "Pegala acá abajo",
  body:
    "Queda guardada solo en este navegador. En cada generación viaja a nuestro servidor " +
    "para llamar al proveedor, y ahí no se guarda ni se registra.",
} as const;

/**
 * Words of Google's own screens, which are in English there: the steps tell the person to tap exactly those, so what they mean is said beside them. Matched by the label between
 * quotation marks, so that the steps themselves stay as `lib/ai/google-terms.ts` and the policy's neighbour say them.
 */
const GLOSS: ReadonlyArray<readonly [english: string, spanish: string]> = [
  ["Create API key", "crear clave de API"],
  ["Set up billing", "configurar la facturación"],
];
export const glossOf = (title: string) => GLOSS.find(([english]) => title.includes(`«${english}»`))?.[1];

type Choice = "free" | "paid" | "none";

type State =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "done" }
  | { name: "failed"; message: string };

function Steps({ steps }: { steps: ReadonlyArray<{ title: string; body: string }> }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center border border-oro-soft font-mono text-[11px] text-oro">
            {index + 1}
          </span>
          <div>
            <p className="text-[14.5px] text-ink">
              {index === 0 ? (
                <a
                  href={PROVIDER_KEY_URL.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-oro-soft underline-offset-4 hover:text-oro pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3"
                >
                  {step.title} ↗
                </a>
              ) : (
                step.title
              )}
              {glossOf(step.title) ? <span className="text-ink-3"> ({glossOf(step.title)})</span> : null}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ByokSetup({
  onDone,
  onCancel,
  inSettings = false,
  cvHere = false,
}: {
  onDone?: () => void;
  onCancel?: () => void;
  /** Mounted in Ajustes itself: «otro proveedor» is not somewhere else to go, and a link to the page already open goes nowhere. */
  inSettings?: boolean;
  /** The CV the profile makes is on this very page, to download: «Sigo sin IA» does not need to send anyone to it. */
  cvHere?: boolean;
}) {
  const profile = useStoredProfile();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [key, setKey] = useState("");
  const [state, setState] = useState<State>({ name: "idle" });

  const save = async () => {
    const apiKey = key.trim();
    if (!apiKey) return;

    setState({ name: "checking" });
    try {
      // Validated by asking the provider what it serves — the same call the
      // model picker in Ajustes makes. It costs no quota and it is the only way
      // to tell a working key from a typo before the user hits a generation.
      await fetchModels("google", apiKey);
    } catch (error) {
      setState({
        name: "failed",
        message:
          error instanceof Error
            ? error.message
            : "No pudimos validar esa key. Revisá que la hayas copiado entera.",
      });
      return;
    }

    // Appended rather than assigned: this is the guided path for someone who
    // has no key yet, but it is reachable from Ajustes with providers already
    // configured, and replacing them there would be a silent deletion.
    const entries = loadSettings().entries.filter((entry) => entry.apiKey.trim() !== apiKey);
    try {
      saveSettings({ entries: [...entries, { provider: "google", apiKey, model: "" }] });
    } catch (error) {
      // A browser with no room left refuses the write: said, and the button is a button again (the notice of the app brings the way to make room).
      setState({ name: "failed", message: error instanceof Error ? error.message : "No pudimos guardar la key en este navegador." });
      return;
    }
    setState({ name: "done" });
    onDone?.();
  };

  if (state.name === "done") {
    return (
      <Alert tone="good" title="Listo">
        Ya podés seguir usando todo sin límite. La key queda guardada en este navegador; si
        cambiás de celular o de computadora, hay que volver a ponerla.
      </Alert>
    );
  }

  // First of all, what Google says, and the ways on. Nothing is asked for, and nothing is made, until one is chosen.
  if (choice === null) {
    return (
      <div className="space-y-4" data-byok-choice>
        <GoogleSetupNotice />
        <div>
          <p className="mb-2 text-[14.5px] text-ink">Elegí cómo seguir:</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                forgetWithoutAi();
                setChoice("free");
              }}
            >
              Sigo con la key gratuita
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                forgetWithoutAi();
                setChoice("paid");
              }}
            >
              Uso una key del nivel pago
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                rememberWithoutAi();
                setChoice("none");
              }}
            >
              Sigo sin IA
            </Button>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            {inSettings ? (
              "Si preferís otro proveedor, tocá «Agregar una key», más abajo: cada uno tiene sus propias condiciones, y conviene leerlas."
            ) : (
              <>
                Si preferís otro proveedor, se elige en{" "}
                <Link href="/ajustes" className="underline decoration-oro-soft underline-offset-4 hover:text-oro pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3">
                  Ajustes
                </Link>
                : cada uno tiene sus propias condiciones, y conviene leerlas.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (choice === "none") {
    const ready = isPreviewReady(profile);
    return (
      <div className="space-y-3" data-byok-choice="none">
        <Alert tone="info" title="Seguís sin IA">
          <p>
            {WITHOUT_AI.works} {WITHOUT_AI.needs}
          </p>
          <p className="mt-2">Lo anotamos en este navegador, para no volver a ofrecerte la key cada vez que cierres una sesión. Podés volver a esto cuando quieras.</p>
        </Alert>
        <div className="flex flex-wrap gap-2">
          {/* The way on that needs no model: the CV the profile already makes. Where it is on the page already there is nowhere to send anyone. */}
          {cvHere ? null : (
            <ButtonLink href={ready ? "/perfil#cv-base" : "/perfil"} variant="primary">
              {ready ? "Bajar mi CV base" : "Armar mi perfil"}
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={() => setChoice(null)}>
            Volver a elegir
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cerrar
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const steps = choice === "free" ? [...FREE_STEPS, PASTE_STEP] : [...GOOGLE_PAID_STEPS, PASTE_STEP];

  return (
    <div data-byok-choice={choice}>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        {choice === "free" ? (
          "Elegiste la key gratuita."
        ) : (
          <>
            Elegiste una key del nivel pago: {GOOGLE_PAID_FACTS[0].says} {GOOGLE_PAID_FACTS[1].says} <GoogleTermsLink />
          </>
        )}{" "}
        <button
          type="button"
          onClick={() => setChoice(null)}
          className="underline decoration-oro-soft underline-offset-4 hover:text-oro pointer-coarse:-my-3 pointer-coarse:py-3"
        >
          Cambiar
        </button>
      </p>

      <Steps steps={steps} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <SecretInput
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="AIza…"
          autoComplete="off"
          spellCheck={false}
          className={cx("min-w-0 flex-1", "font-mono text-[13px]")}
          aria-label="Tu API key de Google AI Studio"
        />
        <Button disabled={!key.trim() || state.name === "checking"} onClick={save}>
          {state.name === "checking" ? <Spinner /> : null}
          {state.name === "checking" ? "Comprobando…" : "Guardar y seguir"}
        </Button>
      </div>

      {state.name === "failed" ? (
        <div className="mt-4">
          <Alert tone="bad">{state.message}</Alert>
        </div>
      ) : null}
    </div>
  );
}
