"use client";

import { useState } from "react";
import { Alert, Button, CollapsibleCard, Field, Input } from "@/components/ui";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { TurnstileWidget } from "@/components/account/TurnstileWidget";
import { signIn } from "@/lib/auth-client";
import { LINKEDIN_GUIDE } from "@/lib/onboarding/content";
import { profileEmail } from "@/lib/profile/account-identity";
import { useStoredProfile } from "@/lib/storage/hooks";

/**
 * Three small drawings, one per step of the guide. Abstract on purpose: LinkedIn's
 * screens change, and a screenshot that is wrong is worse than a shape that only
 * points at where to look.
 */
function StepArt({ step }: { step: 0 | 1 | 2 }) {
  return (
    <svg viewBox="0 0 120 72" aria-hidden className="h-16 w-auto text-ink-3">
      <rect x="6" y="6" width="108" height="60" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {step === 0 ? (
        <>
          <circle cx="28" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M46 24h52M46 32h36M46 40h44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : step === 1 ? (
        <>
          <rect x="20" y="16" width="44" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M20 34h64M20 44h64M20 54h44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          <rect x="20" y="38" width="64" height="12" rx="2" className="fill-solar-g4/20 stroke-solar-g4" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <path d="M40 14h24l10 10v30H40z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M60 60v-16m-6 6l6-6 6 6" className="stroke-solar-g4" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

/**
 * Hands the export step to a computer: the link signs in on whichever device opens it,
 * `?ruta=linkedin` puts a blank profile there straight into the guide, and the account it
 * creates or signs into means this phone's session is not the only place that later has it.
 * Without mail it is just the address, to copy.
 */
function Handoff({ mailAvailable, turnstileSiteKey }: { mailAvailable: boolean; turnstileSiteKey: string }) {
  const stored = useStoredProfile();
  const [copied, setCopied] = useState(false);
  // The address already in the profile, if there is one: someone who came back to this step has loaded a CV with it.
  const [email, setEmail] = useState(() => profileEmail(stored));
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/perfil/empezar?ruta=linkedin`);
      setCopied(true);
    } catch {
      // Clipboard blocked: the address is in the bar for them to copy by hand.
    }
  };

  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (turnstileSiteKey && !captchaToken) {
      setError("Confirmá que no sos un robot antes de seguir.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signIn.magicLink({
      email,
      callbackURL: "/perfil/empezar?ruta=linkedin",
      fetchOptions: turnstileSiteKey ? { headers: { "x-captcha-response": captchaToken } } : undefined,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "No pudimos mandar el enlace.");
      return;
    }
    setLinkSentTo(email);
  };

  return (
    <div className="space-y-3 border border-rule bg-paper p-4 text-sm text-ink-2">
      <p>Estás en el celular: bajar el PDF es mucho más fácil desde una computadora.</p>

      {mailAvailable ? (
        linkSentTo ? (
          <p>
            Te mandamos un enlace a <strong className="text-ink">{linkSentTo}</strong>. Abrilo en tu computadora: te deja en
            esta misma guía, con la sesión abierta.
          </p>
        ) : (
          <form className="space-y-3" onSubmit={sendLink}>
            <Field label="Enviámelo por correo" hint="Lo abrís en tu computadora y seguís justo acá">
              <div className="flex flex-wrap gap-2">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@example.com"
                  autoComplete="email"
                  className="max-w-xs"
                />
                <Button type="submit" variant="secondary" disabled={busy}>
                  {busy ? "Enviando…" : "Enviarme un enlace"}
                </Button>
              </div>
            </Field>
            {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} onToken={setCaptchaToken} /> : null}
          </form>
        )
      ) : (
        <div>
          <Button variant="secondary" onClick={copyLink}>
            {copied ? "Enlace copiado" : "Copiar el enlace para abrirlo en la computadora"}
          </Button>
        </div>
      )}

      {error ? <Alert tone="bad">{error}</Alert> : null}
    </div>
  );
}

/**
 * How to get a LinkedIn profile out of LinkedIn, and where to put it: the PDF the site makes
 * of a profile, or the data archive. Folded away — most people arrive with a CV, and the ones
 * who do not know where to look — and open when a link asked for it. On a phone it says that
 * this is easier from a computer, and (given a `handoff`) offers to pass the task there.
 *
 * The file goes into the drop zone beside it, not into one of its own: the reader tells a
 * LinkedIn profile from a CV by what is inside.
 */
export function LinkedInGuide({
  open,
  handoff,
  title,
}: {
  open?: boolean;
  handoff?: { mailAvailable: boolean; turnstileSiteKey: string };
  /** Where "¿No tenés CV?" would be wrong — beside a CV that was already read. */
  title?: string;
}) {
  const phone = useIsPhone();
  const heading = phone ? "Traer mi perfil de LinkedIn · mejor desde la computadora" : (title ?? "¿No tenés CV? Traé tu perfil de LinkedIn");
  return (
    <CollapsibleCard title={heading} defaultOpen={open ?? false}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{LINKEDIN_GUIDE.before}</p>
        <ol className="grid gap-3 sm:grid-cols-3">
          {LINKEDIN_GUIDE.steps.map((step, index) => (
            <li key={step.title} className="border border-rule bg-paper p-4">
              <StepArt step={index as 0 | 1 | 2} />
              <p className="mt-3 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Paso {index + 1}</p>
              <p className="mt-1 text-[15px] text-ink">{step.title}</p>
              <p className="mt-1 text-sm text-ink-2">{step.text}</p>
            </li>
          ))}
        </ol>

        <a
          href={LINKEDIN_GUIDE.profileUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 text-sm text-ink-2 underline decoration-oro-soft underline-offset-4 transition-colors hover:text-ink pointer-coarse:min-h-11"
        >
          Abrir mi perfil de LinkedIn ↗
        </a>

        {phone && handoff ? <Handoff {...handoff} /> : null}

        <div className="space-y-1.5">
          <p className="text-sm text-ink-2">Si algo no coincide</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-3">
            {LINKEDIN_GUIDE.ifItDoesNotMatch.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-ink-3">{LINKEDIN_GUIDE.note}</p>
        <p className="text-sm text-ink-3">
          <strong className="font-normal text-ink-2">¿Preferís el archivo de datos (ZIP)?</strong> {LINKEDIN_GUIDE.zipHelp}
        </p>
      </div>
    </CollapsibleCard>
  );
}
