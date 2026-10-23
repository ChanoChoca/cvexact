import { authConfigured } from "@/lib/auth";
import { mailConfigured } from "@/lib/email/mailer";
import { AccountPage } from "./AccountPage";

export const metadata = { title: "Mi cuenta" };

/**
 * Dinámica por lo mismo que `/ajustes` y la entrada: si Google está habilitado, si hay cuentas y si hay correo se lee del entorno en cada request y viaja como prop, no se
 * hornea en el bundle. Es la única página de la sesión: el ingreso, la cuenta y los datos de este navegador; `/ingresar` redirige acá.
 */
export const dynamic = "force-dynamic";

export default function CuentaPage() {
  return (
    <AccountPage
      googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
      authAvailable={authConfigured}
      mailAvailable={mailConfigured}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
