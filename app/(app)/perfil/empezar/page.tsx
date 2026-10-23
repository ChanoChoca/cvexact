import { Onboarding } from "@/components/onboarding/Onboarding";
import { mailConfigured } from "@/lib/email/mailer";
import { ONBOARDING_ROUTES } from "@/lib/schemas/profile-v2";

export const metadata = { title: "Empezar tu perfil" };

/**
 * Dinámica por lo mismo que `/ajustes`: si hay correo para el enlace y la clave del captcha
 * se leen del entorno en cada request y viajan como prop, no se hornean en el bundle.
 * Habilitarlos es tocar el entorno del contenedor, no recompilar.
 */
export const dynamic = "force-dynamic";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ ruta?: string | string[] }> }) {
  // Un enlace puede traer el camino ya elegido: `?ruta=linkedin` abre la guía de LinkedIn (el celular
  // le pasa la tarea a la computadora así) y `?ruta=scratch`, el comienzo guiado. Lo que no es un
  // camino se ignora.
  const { ruta } = await searchParams;
  const initialRoute = ONBOARDING_ROUTES.find((route) => route === ruta);

  return (
    <Onboarding
      // El enlace por correo (el paso del móvil a la computadora) sólo
      // existe cuando el plugin `magicLink` se cargó del lado del servidor —
      // ver `lib/auth.ts` — que a su vez depende de `mailConfigured`.
      mailAvailable={mailConfigured}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      initialRoute={initialRoute}
    />
  );
}
