"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  changePassword,
  deleteUser,
  requestPasswordReset,
  revokeOtherSessions,
  sendVerificationEmail,
  signIn,
  signUp,
  useSession,
} from "@/lib/auth-client";
import { useHydrated, useStoredProfile } from "@/lib/storage/hooks";
import { accountPrefill } from "@/lib/profile/account-identity";
import { useBillingStatus } from "@/lib/api/billing";
import { AutoSyncControl } from "@/components/account/AutoSyncControl";
import { useAutoSyncStatus } from "@/lib/api/auto-sync";
import { describeUpload, pullAllWithGuard, uploadWithGuard } from "@/lib/api/sync-client";
import { autoSyncOn, syncLine, syncStatus } from "@/lib/profile/sync-status";
import { useSyncState } from "@/lib/storage/sync-state";
import { PayButtons } from "@/components/billing/PayButtons";
import { PurchaseTerms } from "@/components/billing/PurchaseTerms";
import { SignInOptions } from "@/components/account/SignInOptions";
import { TurnstileWidget } from "@/components/account/TurnstileWidget";
import { exportBackup } from "@/lib/storage/local";
import { downloadJson, todayStamp } from "@/lib/storage/download";
import { SignOutDialog } from "@/components/account/SignOutDialog";

/**
 * Sign in, subscription, and sync — all optional. The whole product works
 * signed out; an account only buys cross-device sync and the paid tier.
 *
 * `turnstileSiteKey` llega del servidor por request (ver ajustes/page.tsx):
 * cuando está definida, cada llamada que dispara correo lleva el token del
 * widget en el header `x-captcha-response`, y el servidor lo exige. Sin key,
 * ni widget ni header: los flujos quedan como siempre.
 */
export function AccountPanel({
  turnstileSiteKey = "",
  googleEnabled = false,
  authAvailable = true,
  mailAvailable = false,
}: {
  turnstileSiteKey?: string;
  googleEnabled?: boolean;
  /** Whether this installation has accounts at all: without them there is nothing to sign in to. */
  authAvailable?: boolean;
  /** Whether «Enviarme un enlace» can work — the server's `magicLink` plugin only loads with mail configured. */
  mailAvailable?: boolean;
}) {
  const { data: session, isPending } = useSession();
  const hydrated = useHydrated();

  if (!hydrated || isPending) {
    return (
      <Card>
        <p className="text-sm text-ink-3">Cargando…</p>
      </Card>
    );
  }

  return session?.user ? (
    <SignedIn
      userId={session.user.id}
      email={session.user.email}
      verified={session.user.emailVerified !== false}
      turnstileSiteKey={turnstileSiteKey}
    />
  ) : authAvailable ? (
    <SignedOut turnstileSiteKey={turnstileSiteKey} googleEnabled={googleEnabled} mailAvailable={mailAvailable} />
  ) : (
    <Alert tone="info">Las cuentas no están disponibles acá. CV Exact funciona igual sin una: todo se guarda en este navegador.</Alert>
  );
}

function SignedOut({
  turnstileSiteKey,
  googleEnabled,
  mailAvailable,
}: {
  turnstileSiteKey?: string;
  googleEnabled?: boolean;
  mailAvailable?: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  // What the profile already has: the name and the email on the CV are, for most people, the ones they sign up with.
  // Editable, and not sent anywhere until they submit — nothing here is chosen for them that they cannot change.
  const known = accountPrefill(useStoredProfile());
  const [name, setName] = useState(known.name);
  const [email, setEmail] = useState(known.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  // Sin premarcar: un tildado que ya viene puesto no es una aceptación, es un
  // valor por defecto. Sólo se lee al crear cuenta con correo — ver el
  // comentario sobre `signInWithGoogle` para por qué el alta con Google no
  // pasa por esta misma puerta.
  const [ageAndTermsConfirmed, setAgeAndTermsConfirmed] = useState(false);

  /** El header que el plugin captcha exige; vacío si Turnstile está apagado. */
  const captchaFetchOptions = turnstileSiteKey
    ? { headers: { "x-captcha-response": captchaToken } }
    : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (turnstileSiteKey && !captchaToken) {
      setError("Confirmá que no sos un robot antes de seguir.");
      return;
    }
    if (mode === "signup" && !ageAndTermsConfirmed) {
      setError("Confirmá que tenés 16 años o más y que aceptás los términos antes de seguir.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    const result =
      mode === "signup"
        ? await signUp.email({ name: name || email, email, password, fetchOptions: captchaFetchOptions })
        : await signIn.email({ email, password, fetchOptions: captchaFetchOptions });

    setBusy(false);
    if (result.error) {
      setError(
        result.error.status === 503
          ? "Esta instalación no tiene cuentas habilitadas."
          : (result.error.message ?? "No pudimos completar la operación."),
      );
      return;
    }

    if (mode === "signup") {
      setNotice(
        "Te mandamos un correo para confirmar tu dirección. Podés seguir usando la app mientras tanto.",
      );
    }
  };

  /**
   * Asks for a reset link.
   *
   * The confirmation is deliberately the same sentence whether or not the
   * address has an account. Saying "no existe esa cuenta" would turn this form
   * into a way to find out who has one, which is the first step of every
   * credential-stuffing run — so the answer says what we did, not what we found.
   */
  const forgot = async () => {
    if (!email.trim()) {
      setError("Escribí tu correo primero y volvé a tocar el enlace.");
      return;
    }
    if (turnstileSiteKey && !captchaToken) {
      setError("Confirmá que no sos un robot antes de seguir.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await requestPasswordReset({
      email,
      redirectTo: "/cuenta/reset",
      fetchOptions: captchaFetchOptions,
    });
    setBusy(false);

    if (result.error?.status === 503) {
      setError("Esta instalación no tiene cuentas habilitadas.");
      return;
    }
    setNotice(
      "Si esa dirección tiene una cuenta, te llega un correo con el enlace para elegir una contraseña nueva.",
    );
  };

  return (
    <Card>
      <SectionTitle>Iniciar sesión</SectionTitle>
      <p className="mb-4 text-sm text-ink-2">
        Opcional. Sirve para sincronizar tu perfil entre tus celulares y computadoras, y para
        suscribirte. Sin cuenta, todo sigue funcionando y se guarda en este navegador.
      </p>

      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" ? (
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        ) : null}
        <Field label="Email">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="Contraseña" hint={mode === "signup" ? "Mínimo 8 caracteres." : undefined}>
          <Input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </Field>

        {mode === "signup" ? (
          <Checkbox
            checked={ageAndTermsConfirmed}
            onChange={(e) => setAgeAndTermsConfirmed(e.target.checked)}
            className="items-start gap-3 text-[13.5px] leading-relaxed"
            label={
              <>
                Tengo 16 años o más y acepto los{" "}
                <Link
                  href="/legales/terminos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  términos y condiciones
                </Link>{" "}
                y la{" "}
                <Link
                  href="/legales/privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  política de privacidad
                </Link>
                .
              </>
            }
          />
        ) : null}

        {turnstileSiteKey ? (
          <TurnstileWidget siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
        ) : null}

        {error ? <Alert tone="bad">{error}</Alert> : null}
        {notice ? <Alert tone="good">{notice}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {mode === "signup" ? "Crear cuenta" : "Entrar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signup" ? "Ya tengo cuenta" : "Crear una cuenta"}
          </Button>
        </div>

        {mode === "signin" ? (
          <button
            type="button"
            disabled={busy}
            onClick={forgot}
            className="text-sm text-ink-2 underline decoration-oro-soft underline-offset-4 hover:text-ink disabled:cursor-not-allowed"
          >
            ¿Olvidaste tu contraseña?
          </button>
        ) : null}
      </form>

      {mode === "signup" ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Esa casilla es para crear cuenta con correo. Si en cambio continuás con Google, no
          hay casilla que tildar: al hacerlo, igual aceptás los{" "}
          <Link href="/legales/terminos" className="underline underline-offset-4 hover:text-ink">
            términos y condiciones
          </Link>{" "}
          —incluida la edad mínima de la cláusula 3— y la{" "}
          <Link
            href="/legales/privacidad"
            className="underline underline-offset-4 hover:text-ink"
          >
            política de privacidad
          </Link>
          .
        </p>
      ) : null}

      {googleEnabled || mailAvailable ? (
        <>
          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-rule" />
            <span className="font-solar text-xs tracking-widest text-ink-3 uppercase">o</span>
            <span className="h-px flex-1 bg-rule" />
          </div>
          <SignInOptions
            googleEnabled={Boolean(googleEnabled)}
            mailAvailable={Boolean(mailAvailable)}
            turnstileSiteKey={turnstileSiteKey ?? ""}
            callbackURL="/cuenta"
            initialEmail={email}
          />
        </>
      ) : null}
    </Card>
  );
}

function SignedIn({
  userId,
  email,
  verified,
  turnstileSiteKey = "",
}: {
  userId: string;
  email: string;
  verified: boolean;
  turnstileSiteKey?: string;
}) {
  return (
    <div className="space-y-6">
      <SessionCard email={email} verified={verified} turnstileSiteKey={turnstileSiteKey} />
      <AccountCard userId={userId} verified={verified} />
    </div>
  );
}

/**
 * The session: who is in, the confirmation of the address, and the ways out —this browser's, and everyone else's—. Apart from the account's own settings
 * (`AccountCard`): signing in and out is something done to the session; the account is what it holds.
 */
function SessionCard({
  email,
  verified,
  turnstileSiteKey = "",
}: {
  email: string;
  verified: boolean;
  turnstileSiteKey?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [signOutOpen, setSignOutOpen] = useState(false);

  const resendVerification = async () => {
    setBusy("verify");
    setError(null);
    setMessage(null);
    const result = await sendVerificationEmail({
      email,
      callbackURL: "/cuenta",
      // `/send-verification-email` está detrás del captcha cuando hay site key:
      // el reenvío es el flujo que un flood puede repetir sin fin.
      fetchOptions: turnstileSiteKey
        ? { headers: { "x-captcha-response": captchaToken } }
        : undefined,
    });
    setBusy(null);
    if (result.error) {
      setError(result.error.message ?? "No pudimos reenviar el correo.");
      return;
    }
    setMessage("Listo, te mandamos el correo de nuevo. Puede tardar un par de minutos.");
  };

  const closeOtherSessions = async () => {
    setBusy("sessions");
    setError(null);
    setMessage(null);
    const result = await revokeOtherSessions();
    setBusy(null);
    if (result.error) {
      setError(result.error.message ?? "No pudimos cerrar las otras sesiones.");
      return;
    }
    setMessage("Cerramos la sesión en tus otros celulares y computadoras.");
  };

  return (
    <Card>
      <SectionTitle action={<Badge tone="good">Sesión iniciada</Badge>}>Sesión</SectionTitle>
      <p className="text-sm text-ink-2 wrap-anywhere">{email}</p>

      {/* Not a blocker: the app keeps working unverified. Sync and starting a
          subscription are what the server refuses, so say so before they try. */}
      {!verified ? (
        <Alert tone="warn">
          Todavía no confirmaste tu correo. Hasta que lo hagas no podés sincronizar.
          <span className="mt-3 block">
            {/* El reenvío manda un mail y está detrás del captcha: el widget
                vive acá, junto al botón que lo necesita. */}
            {turnstileSiteKey ? (
              <TurnstileWidget siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
            ) : null}
            <Button variant="secondary" disabled={busy !== null} onClick={resendVerification}>
              {busy === "verify" ? "Enviando…" : "Reenviar correo"}
            </Button>
          </span>
        </Alert>
      ) : null}

      {message ? (
        <Alert tone="good">
          <span className="mt-3 block">{message}</span>
        </Alert>
      ) : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
        <Button variant="ghost" disabled={busy !== null} onClick={() => setSignOutOpen(true)}>
          Cerrar sesión
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={closeOtherSessions}>
          {busy === "sessions" ? "Cerrando…" : "Cerrar sesión en mis otros celulares y computadoras"}
        </Button>
      </div>

      <SignOutDialog open={signOutOpen} onClose={() => setSignOutOpen(false)} email={email} onError={setError} />
    </Card>
  );
}

/** What the account holds and does, apart from the session (`SessionCard`): sync, what is bought, the password, and the account itself. */
function AccountCard({ userId, verified }: { userId: string; verified: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { status: billing, refresh: refreshBilling } = useBillingStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  // Whether the account has what is on screen, said where it is asked to upload or to download.
  const profile = useStoredProfile();
  const syncState = useSyncState();
  const autoStatus = useAutoSyncStatus();
  const [now] = useState(() => new Date());
  // Kept up to date on its own, "Cambios sin subir" is not what is going on: what is, is said by «Mantener sincronizado», below.
  const inHand = autoSyncOn(syncState, verified ? userId : null) && (autoStatus.phase === "waiting" || autoStatus.phase === "sending" || autoStatus.phase === "retrying");
  const sync = inHand ? null : syncLine(syncStatus(profile, syncState, verified ? userId : null), syncState, now);

  /**
   * Changes the password and drops every other session in the same call.
   *
   * The two belong together: the reason someone changes a password is usually
   * that they think somebody else has it, and leaving that somebody's session
   * signed in makes the change cosmetic.
   */
  const changeMyPassword = async () => {
    const currentPassword = window.prompt("Tu contraseña actual:");
    if (!currentPassword) return;
    const newPassword = window.prompt("La nueva (mínimo 8 caracteres):");
    if (!newPassword) return;

    if (newPassword.length < 8) {
      setError("La contraseña nueva necesita al menos 8 caracteres.");
      return;
    }

    setBusy("password");
    setError(null);
    setMessage(null);
    const result = await changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(null);

    if (result.error) {
      setError(result.error.message ?? "No pudimos cambiar la contraseña.");
      return;
    }
    setMessage("Cambiamos tu contraseña y cerramos las sesiones en tus otros celulares y computadoras.");
  };

  const removeAccount = async () => {
    if (
      !(await confirm(
        "Se borran tu perfil y tus postulaciones guardadas en el servidor, y no se pueden " +
          "recuperar. Los créditos que te queden no se reembolsan. Lo que está en este " +
          "navegador no se toca. Te mandamos un correo para confirmar. ¿Seguimos?",
      ))
    ) {
      return;
    }

    setBusy("delete");
    setError(null);
    setMessage(null);
    const result = await deleteUser({ callbackURL: "/" });
    setBusy(null);

    if (result.error) {
      setError(result.error.message ?? "No pudimos iniciar el borrado.");
      return;
    }
    setMessage("Te mandamos un correo. La cuenta se borra cuando confirmes desde ahí.");
  };

  const push = async () => {
    setBusy("push");
    setError(null);
    setMessage(null);
    try {
      // Over a profile the account already has, this replaces it: said first, with both side by side, and the one that
      // goes is written down before it does (`uploadWithGuard`, the same for every screen that offers it).
      const outcome = await uploadWithGuard(userId, confirm);
      if (outcome.status === "cancelled") return;
      setMessage(describeUpload(outcome.result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Sincroniza este navegador con la cuenta, y de paso descarga un archivo con
   * todo lo que hay del lado del servidor.
   *
   * La cláusula 8 de la política de privacidad promete que este botón "te
   * descarga todo lo que tenemos tuyo en un archivo" — el derecho de acceso
   * del art. 14 de la Ley 25.326. Antes sólo sincronizaba: reemplazaba el
   * perfil y las postulaciones de este navegador sin dejar nada descargable, y
   * `/api/sync` sin más no traía la cuenta, las sesiones, las compras ni los
   * consentimientos. `?export=account` los agrega sin tocar lo que las otras
   * pantallas ya leen de esta misma ruta.
   *
   * Reemplaza las dos cosas, así que hace lo que hace todo toque que reemplaza: dice qué por qué, con las dos partes en números, y baja
   * antes lo que se va (`pullAllWithGuard`). Decía que bajaba antes una copia y no lo hacía.
   */
  const pull = async () => {
    setBusy("pull");
    setError(null);
    setMessage(null);
    try {
      const outcome = await pullAllWithGuard(userId, confirm);
      if (outcome.status === "cancelled") {
        setBusy(null);
        return;
      }
      const { payload, profile: parsed } = outcome;

      // El archivo se arma con lo que ya se acaba de escribir, así que
      // lo que se descarga coincide exactamente con lo que quedó en este
      // navegador — más las columnas que sólo existen en el servidor.
      const fullExport = {
        ...(await exportBackup(parsed ?? undefined)),
        account: payload.account ?? null,
        sessions: payload.sessions ?? [],
        creditPurchases: payload.creditPurchases ?? [],
        consents: payload.consents ?? [],
        legalRequests: payload.legalRequests ?? [],
      };
      downloadJson(`cvexact-datos-${todayStamp()}.json`, fullExport);

      // A clean page over what was just written, as before.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al bajar.");
      setBusy(null);
    }
  };

  /**
   * Opens the Mercado Pago authorisation page for a new subscription. Hands
   * back a url to send the user to.
   */
  const checkout = async () => {
    setBusy("subscribe-mp");
    setError(null);
    try {
      const response = await fetch("/api/mercadopago/subscription", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Error al iniciar el pago.");
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar el pago.");
      setBusy(null);
    }
  };

  const cancelMercadoPago = async () => {
    if (!(await confirm("Se cancela la suscripción y no se vuelve a cobrar. ¿Seguimos?"))) return;
    setBusy("cancel");
    setError(null);
    try {
      const response = await fetch("/api/mercadopago/subscription", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No pudimos cancelar.");
      await refreshBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cancelar.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Retira el consentimiento a la transferencia internacional (cláusula 5 de
   * privacidad). No cancela nada de lo pago: el saldo y la suscripción
   * quedan; lo que deja de poder hacerse es generar con nuestra key, porque
   * eso es lo que manda el perfil a DeepSeek. La próxima generación en un
   * tier pago vuelve a pedirlo desde `TransferConsent`.
   */
  const withdrawConsent = async () => {
    if (
      !(await confirm(
        "Vas a poder seguir usando tu saldo y tu suscripción, pero no vamos a poder generar " +
          "nada con nuestra key hasta que vuelvas a consentir la transferencia. ¿Seguimos?",
      ))
    ) {
      return;
    }
    setBusy("withdraw-consent");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/legales/consentimiento", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No pudimos retirarlo.");
      setMessage("Retiramos tu consentimiento. Te lo volvemos a pedir la próxima vez que generes.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos retirarlo.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <SectionTitle>Mi cuenta</SectionTitle>
      {message ? (
        <Alert tone="good">
          <span className="mt-3 block">{message}</span>
        </Alert>
      ) : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}

      <div>
        <p className="mb-2 text-sm font-medium text-ink-2">Sincronización</p>
        <p className="mb-3 text-sm text-ink-2">
          Tus datos viven en este navegador. Subilos para tenerlos en tu cuenta, o bajalos
          en otro celular o computadora.
        </p>
        {sync ? (
          <p className="mb-3 text-sm text-ink" data-sync-status>
            {sync}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={push}>
            {busy === "push" ? "Subiendo…" : "Subir a mi cuenta"}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={pull}>
            {busy === "pull" ? "Bajando…" : "Bajar de mi cuenta"}
          </Button>
        </div>
        <AutoSyncControl userId={userId} verified={verified} />
      </div>

      {/*
        * Sin ninguna pasarela configurada no hay nada que comprar, pero un
        * saldo o una suscripción de cuando sí la había siguen siendo reales:
        * el gate mira `credits`/`subscription.active` además de `gateways`
        * para que una cuenta con algo pendiente no pierda su propio panel.
        */}
      {billing &&
      (billing.gateways.length > 0 || billing.credits > 0 || billing.subscription?.active) ? (
        <div className="mt-5 border-t border-rule pt-4">
          <p className="mb-2 text-sm font-medium text-ink-2">Que la key la pongamos nosotros</p>

          {/* The balance had no home anywhere in the app: someone who bought a
              pack could not see what was left of it. */}
          {billing.credits > 0 ? (
            <p className="mb-3 text-sm text-ink">
              Te quedan <strong>{billing.credits}</strong> créditos.
            </p>
          ) : null}

          <p className="mb-3 text-sm text-ink-2">
            Sin configurar nada y sin key.
            Recordá que con tu propia key todo esto es gratis y sin límite —{" "}
            <a
              href="/precios"
              className="underline decoration-oro-soft underline-offset-4 hover:text-ink"
            >
              comparar
            </a>
            .
          </p>
          <PurchaseTerms terms={billing.terms} />
          <PayButtons gateways={billing.gateways} onError={setError} />

          <div className="mt-3 flex flex-wrap gap-2">
            {/* Mercado Pago has no billing portal, so a subscriber needs a
                cancel button this app operates. */}
            {billing.subscription?.active && billing.subscription.gateway === "mercadopago" ? (
              <Button variant="ghost" disabled={busy !== null} onClick={cancelMercadoPago}>
                {busy === "cancel" ? "Cancelando…" : "Cancelar suscripción"}
              </Button>
            ) : null}

            {billing.subscription?.canSubscribe.mercadopago &&
            !(billing.subscription.active && billing.subscription.gateway === "mercadopago") ? (
              <Button variant="ghost" disabled={busy !== null} onClick={checkout}>
                {busy === "subscribe-mp" ? "Abriendo…" : "Suscribirme (Mercado Pago)"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Sólo tiene sentido para quien de verdad corre sobre nuestra key:
          un BYOK nunca dio este consentimiento porque nunca lo necesitó. Vive
          acá y no dentro del bloque de arriba porque no depende de que esta
          instalación venda nada — depende de que la cuenta ya haya dado ese
          consentimiento alguna vez. */}
      {billing?.tier === "pro" || billing?.tier === "credits" ? (
        <div className="mt-5 border-t border-rule pt-4">
          <Button variant="ghost" disabled={busy !== null} onClick={withdrawConsent}>
            {busy === "withdraw-consent"
              ? "Retirando…"
              : "Retirar consentimiento de transferencia"}
          </Button>
        </div>
      ) : null}

      <div className="mt-5 border-t border-rule pt-4">
        <p className="mb-2 text-sm font-medium text-ink-2">Seguridad</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={busy !== null} onClick={changeMyPassword}>
            {busy === "password" ? "Cambiando…" : "Cambiar contraseña"}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={removeAccount}>
            {busy === "delete" ? "Enviando…" : "Borrar mi cuenta"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
