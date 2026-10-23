import "server-only";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { captcha, magicLink } from "better-auth/plugins";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { authRateLimitStorage } from "@/lib/auth-rate-limit";
import { ipAddressConfig } from "@/lib/client-ip";
import { mailConfigured, sendMail } from "@/lib/email/mailer";
import { deleteAccountMail, magicLinkMail, resetPasswordMail, verificationMail } from "@/lib/email/templates";
import { checkLockout, clearFailures, recordFailure } from "@/lib/auth-lockout";
import { recordTermsConsent } from "@/lib/legal/consent";
import { purgeUsageCounterForUser } from "@/lib/quota";

/**
 * Accounts are optional. The product works fully signed-out with data in the
 * browser; an account exists to sync across devices and to hold a subscription.
 *
 * Without DATABASE_URL there is nowhere to keep users, so auth is disabled
 * rather than half-configured — `authConfigured` gates every call site.
 *
 * Mail is optional on top of that, and gates a second tier of behaviour:
 * verification, password reset, and account deletion all need a link to reach
 * an inbox. Without SMTP they stay off rather than pretending to work, which is
 * why every one of them is wrapped in `mailConfigured` below.
 */

export const authConfigured =
  databaseConfigured && Boolean(process.env.BETTER_AUTH_SECRET);

/** The sign-in endpoint the lockout hooks below care about. */
const SIGN_IN_PATH = "/sign-in/email";

/** The email a sign-in was attempted with, if the body carried a usable one. */
function attemptedEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" && email.trim() ? email : null;
}

function create() {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL:
      process.env.BETTER_AUTH_URL ??
      (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000"),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      /**
       * Verification does not gate signing in.
       *
       * The product works signed out, so an unverified account is not a way in
       * to anything an anonymous visitor could not already do. What it must not
       * reach is the account's own surface — see `requiresVerification`, which
       * `/api/sync` and the subscription route enforce. Blocking the login
       * instead would mean a mail that lands in spam costs someone the profile
       * they already wrote.
       */
      requireEmailVerification: false,
      minPasswordLength: 8,
      /**
       * Without this, `/forget-password` answers "Reset password isn't enabled"
       * and a forgotten password is an account lost for good — there is no
       * other way back into a synced profile.
       */
      sendResetPassword: mailConfigured
        ? async ({ user, url }) => {
            await sendMail(resetPasswordMail(user.email, url));
          }
        : undefined,
    },
    emailVerification: {
      sendVerificationEmail: mailConfigured
        ? async ({ user, url }) => {
            await sendMail(verificationMail(user.email, url));
          }
        : undefined,
      sendOnSignUp: mailConfigured,
      // The link is proof enough of the address; making them type the password
      // again buys nothing and loses people mid-flow.
      autoSignInAfterVerification: true,
      /** A day, matching what `verificationMail` tells the reader. */
      expiresIn: 60 * 60 * 24,
    },
    /**
     * Los dos o ninguno: con el ID solo, Better Auth arrancaría el flujo y
     * Google lo rechazaría en el callback. Better Auth manda 400 («Provider
     * not found») cuando el proveedor no está configurado, que es la señal
     * que el botón de la UI usa para ocultarse (ver ajustes/page.tsx).
     */
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    /**
     * `AccountPanel.tsx` le avisa a quien se registra que acepta los términos y
     * la privacidad vigentes; este hook es lo que convierte ese aviso en una
     * fila de `consent` que se puede acreditar (ver `recordTermsConsent` en
     * `lib/legal/consent.ts`). Corre a nivel de adaptador de base, no de
     * endpoint, así que alcanza por igual el alta con correo y el alta con
     * Google sin duplicar la llamada en dos lugares.
     */
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await recordTermsConsent(user.id);
          },
        },
      },
    },
    user: {
      additionalFields: {
        // Mirrored from Mercado Pago by the webhook so a tier check is one row
        // read rather than an API call on every request.
        subscriptionStatus: { type: "string", required: false, input: false },
        subscriptionCurrentPeriodEnd: { type: "date", required: false, input: false },
      },
      /**
       * Deletion is a security control, not a convenience: without it the only
       * way to get data out of this database is to ask us, and an account
       * whose password leaked cannot be retired by its owner.
       *
       * Every table that references `user.id` is `onDelete: "cascade"`, so the
       * profile, the applications, the tombstones and the sessions go with it
       * without a hook to keep in sync. Confirmed by mail because the session
       * cookie alone should not be enough to destroy someone's data.
       */
      deleteUser: {
        enabled: mailConfigured,
        sendDeleteAccountVerification: mailConfigured
          ? async ({ user, url }) => {
              await sendMail(deleteAccountMail(user.email, url));
            }
          : undefined,
        /**
         * `usage_counter` is the one exception to the cascade above: `subject`
         * is free text, not a foreign key, so nothing deletes it
         * automatically. See `purgeUsageCounterForUser` in lib/quota.ts.
         */
        afterDelete: async (user) => {
          await purgeUsageCounterForUser(user.id);
        },
      },
    },
    /**
     * Rate limiting, in Postgres rather than in this process's memory.
     *
     * The default is memory, which means the limit resets on every deploy and
     * each replica keeps its own copy of a budget that is meant to be global —
     * so shipping a release hands an attacker a fresh allowance. Postgres
     * survives both, at the cost of one indexed upsert per request.
     *
     * Through `customStorage` and not `storage: "database"`: the built-in one
     * keys every bucket on the visitor's address in the clear, which the
     * privacy policy says this app does not keep. See `lib/auth-rate-limit.ts`.
     * It also stops Better Auth from pruning the table on every request at
     * `max(window, 10, 60)` seconds, blind to `customRules` — the incident
     * `lib/rate-limit.ts` describes — so `window` below is now just the general
     * ceiling, not a retention setting.
     *
     * `enabled` is forced on: the default only enables it in production, which
     * is the one environment where nobody would notice it was broken.
     */
    rateLimit: {
      enabled: true,
      customStorage: authRateLimitStorage,
      window: 3600,
      max: 2000,
      customRules: {
        // Tighter than the general ceiling, and far tighter than the 3-per-10s
        // default, which permits ~18 password guesses a minute indefinitely.
        [SIGN_IN_PATH]: { window: 300, max: 10 },
        // The endpoints below all *send mail*. Left at the general ceiling they
        // would make this app a way to deliver thousands of messages an hour to
        // an address of the sender's choosing. See `lib/email/budget.ts` for
        // the per-recipient and global caps that hold even across many IPs.
        "/sign-up/email": { window: 3600, max: 5 },
        "/forget-password": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 5 },
        "/send-verification-email": { window: 3600, max: 5 },
        "/delete-user": { window: 3600, max: 5 },
        "/change-email": { window: 3600, max: 5 },
        "/change-password": { window: 300, max: 5 },
      },
    },
    /**
     * Per-account lockout, which the rate limiter above cannot do.
     *
     * That one keys on the client address, so an attacker spread across a proxy
     * pool never trips it while still spending thousands of guesses on a single
     * account. These two hooks count failures against the account instead. See
     * `lib/auth-lockout.ts` for the backoff and why it is capped.
     */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = attemptedEmail(ctx.body);
        if (!email) return;

        const lock = await checkLockout(email);
        if (!lock.locked) return;

        /**
         * Failures are counted for addresses that have no account too, so this
         * message appears identically whether or not the account exists. That
         * is deliberate: a lockout that only ever fires for real accounts would
         * be a faster way to enumerate users than the login form itself.
         *
         * Thrown from `before`, so the handler never runs and the attempt is
         * not counted again — otherwise hammering a locked account would keep
         * extending its own lock, and the attacker could hold the owner out
         * indefinitely.
         */
        const minutes = Math.max(1, Math.ceil(lock.retryAfterSeconds / 60));
        throw new APIError("TOO_MANY_REQUESTS", {
          message:
            `Demasiados intentos fallidos. Probá de nuevo en ` +
            `${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = attemptedEmail(ctx.body);
        if (!email) return;

        // An endpoint that refused returns the `APIError` itself rather than
        // throwing past the hooks — see `dispatchAuthEndpoint`.
        if (ctx.context.returned instanceof APIError) {
          await recordFailure(email);
        } else {
          await clearFailures(email);
        }
      }),
    },
    // Without this the rate limiter cannot resolve an IP behind Cloudflare and
    // HAProxy, and falls back to a single shared bucket per path — one attacker
    // then exhausts everyone's login allowance. `lib/client-ip.ts` says which
    // header is believed, and why that is a per-deployment decision.
    advanced: { ipAddress: ipAddressConfig },
    /**
     * No `session: { expiresIn }` here on purpose: Better Auth's own default
     * (7 days) governs, and `scripts/prune.mjs` deletes by `session.expires_at`.
     * That number is quoted in clause 9 of `/legales/privacidad`
     * ("Sesiones, con su IP y su navegador: hasta 7 días") — if this ever
     * changes, that clause has to change with it, not after it.
     */
    plugins: [
      /**
       * Entrar por un enlace de correo, sin contraseña — el onboarding lo ofrece
       * en S5 y en el paso del móvil a la computadora (ver `FirstValueStep.tsx`,
       * `LinkedInStep.tsx`). Condicionado a `mailConfigured` igual que
       * `sendResetPassword`/`sendVerificationEmail` arriba, pero como plugin
       * entero y no como opción: `sendMagicLink` no es opcional en su tipo, así
       * que sin correo el plugin ni se carga, en vez de cargarse con un callback
       * que fallaría en cada intento.
       *
       * `disableSignUp` queda en su default (`false`) a propósito: pedir el
       * enlace crea la cuenta si no existía, que es el flujo que el onboarding
       * necesita para alguien que llega sin cuenta.
       *
       * 15 minutos — más que el default del paquete (5) porque el correo puede
       * tardar, y la cláusula 3 de privacidad cita este número: si cambia,
       * cambiarlo ahí también.
       */
      ...(mailConfigured
        ? [
            magicLink({
              expiresIn: 60 * 15,
              rateLimit: { window: 3600, max: 5 },
              sendMagicLink: async ({ email, url }) => {
                await sendMail(magicLinkMail(email, url));
              },
            }),
          ]
        : []),
      /**
       * Turnstile en los endpoints que mandan correo, condicionado a que la env
       * exista — igual que `mailConfigured` y `socialProviders` arriba: sin la
       * key el plugin ni se carga y dev y los tests siguen como estaban. Es lo
       * único que corta el envío automatizado sin depender de la IP; el
       * presupuesto de `lib/email/budget.ts` es la red de contención para
       * cuando algo igual lo pase.
       *
       * El token viaja en el header `x-captcha-response`, que el cliente añade
       * a cada llamada (ver `components/account/AccountPanel.tsx`). Un pedido
       * sin el header es rechazado por el plugin — eso es exactamente lo que
       * separa un script de un navegador con el widget resuelto.
       */
      ...(process.env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: process.env.TURNSTILE_SECRET_KEY,
              // `/forget-password` es un alias de `/request-password-reset`
              // según la versión; estar los dos no cuesta nada y cubre ambos.
              endpoints: [
                "/sign-up/email",
                "/sign-in/email",
                "/forget-password",
                "/request-password-reset",
                "/send-verification-email",
                "/sign-in/magic-link",
              ],
            }),
          ]
        : []),
      nextCookies(),
    ],
  });
}

let cached: ReturnType<typeof create> | null = null;

/** Throws when auth is not configured — check `authConfigured` first. */
export function getAuth() {
  if (!authConfigured) {
    throw new Error("Auth is not configured. Guard with `authConfigured` first.");
  }
  cached ??= create();
  return cached;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEnd?: Date | null;
  /** Which gateway holds the subscription, so the UI offers the right control. */
  subscriptionGateway?: string | null;
};

/** Returns the signed-in user, or null when signed out or auth is disabled. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  if (!authConfigured) return null;
  try {
    const session = await getAuth().api.getSession({ headers });
    return (session?.user as SessionUser | undefined) ?? null;
  } catch {
    // A malformed or expired cookie must read as signed-out, not as a 500.
    return null;
  }
}

/**
 * Whether this user still has to prove they own the address they signed up with.
 *
 * False when there is no mailer, because then nobody was ever sent a link and
 * refusing them would be refusing them for our own missing configuration.
 *
 * Callers gate the *account's own* surface on this — syncing a profile to the
 * server, starting a subscription — and nothing else. Generating documents and
 * buying credits stay open: someone who paid must be able to use what they
 * bought, and a verification mail that went to spam is not a reason to block a
 * purchase.
 */
export function requiresVerification(user: SessionUser | null): boolean {
  return mailConfigured && Boolean(user) && user?.emailVerified !== true;
}

/**
 * Statuses that entitle the holder to the paid tier.
 *
 * Mercado Pago says `authorized` for an active preapproval. Everything absent
 * is inactive by construction — `paused` and `cancelled` included.
 */
const ACTIVE_STATUSES = new Set(["authorized"]);

export function hasActiveSubscription(user: SessionUser | null): boolean {
  if (!user?.subscriptionStatus) return false;
  if (!ACTIVE_STATUSES.has(user.subscriptionStatus)) return false;

  // A gateway can lag on cancellations, so an elapsed period end wins over the
  // stored status. For Mercado Pago that end is the next payment date: access
  // is good until the next charge was due.
  const end = user.subscriptionCurrentPeriodEnd;
  return !end || new Date(end).getTime() > Date.now();
}
