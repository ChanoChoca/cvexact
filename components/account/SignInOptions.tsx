"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { TurnstileWidget } from "@/components/account/TurnstileWidget";
import { signIn } from "@/lib/auth-client";

/**
 * The ways in that need no password to be made up: Google, and a link sent to the address. They go under the form of usuario y contraseña in the account page
 * (`AccountPanel`), which is the one place to sign in.
 *
 * `callbackURL` is where the person lands once they are in. The profile in this browser stays where it is either way; signing in
 * does not move it (clause 2 of the privacy policy: nothing goes up, or comes down, without a tap).
 */
export function SignInOptions({
  googleEnabled,
  mailAvailable,
  turnstileSiteKey,
  callbackURL,
  initialEmail = "",
}: {
  googleEnabled: boolean;
  /** Whether "Enviarme un enlace" can work at all — the server's `magicLink` plugin only loads with mail configured. */
  mailAvailable: boolean;
  turnstileSiteKey: string;
  callbackURL: string;
  /** The address already known, if it looks like one: the link goes there unless they type another. */
  initialEmail?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    const result = await signIn.social({ provider: "google", callbackURL });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "No pudimos iniciar el ingreso con Google.");
  };

  /**
   * "Enviarme un enlace": creates the account if it did not exist, no password anywhere. Opening the mail on this same
   * device lands back on `callbackURL` with the session already set by Better Auth's own verify endpoint, so there is
   * nothing else to wire up here beyond asking for the address.
   */
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
      callbackURL,
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
    <div className="space-y-3">
      {googleEnabled ? (
        <Button variant="secondary" disabled={busy} onClick={withGoogle}>
          Continuar con Google
        </Button>
      ) : null}
      {mailAvailable ? (
        linkSentTo ? (
          <p className="text-sm text-ink-2">
            Te mandamos un enlace a <strong className="text-ink">{linkSentTo}</strong>. Abrilo en este mismo celular o computadora.
          </p>
        ) : (
          <form className="space-y-3" onSubmit={sendLink}>
            <Field label="O te mandamos un enlace, sin contraseña" hint="Tocalo desde este mismo celular o computadora">
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
      ) : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
    </div>
  );
}
