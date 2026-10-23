import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/db";
import { getApplicationDetail } from "@/lib/tracker/service";
import { PostularGuide } from "@/components/wizard/PostularGuide";
import { TOUR_PARAM } from "@/components/wizard/postular-tour";
import { Wizard } from "./Wizard";

export const metadata = { title: "Postular" };

/**
 * `?desde=<applicationId>` es el puente entre el tracker (donde el texto de
 * un aviso capturado por la extensión, o por "Importar por URL", vive en
 * `application.jdText` en el servidor) y este asistente, que hasta ahora
 * sólo sabía leer `jobText` de `localStorage` (`lib/storage/hooks.ts`). Sin
 * esto, capturar una publicación de LinkedIn llenaba el seguimiento pero no
 * evitaba el copiar y pegar de siempre.
 *
 * Deliberadamente sin ruta de API nueva: `getApplicationDetail` (la misma
 * que ya usa `GET /api/tracker/applications/[id]`, ver `DetailPanel.tsx`) ya
 * devuelve la fila completa, `jdText` incluido — esto sólo la lee del lado
 * del servidor, en la propia carga de la página, en vez de agregar un
 * segundo fetch en el cliente.
 *
 * Cualquier error (sin sesión, no es tuya, no existe, sin base de datos)
 * cae en silencio a `initialJobText: ""` — un asistente con el textarea
 * vacío es un estado válido, no hace falta una pantalla de error para esto.
 */
async function loadInitialJobText(applicationId: string): Promise<string> {
  if (!databaseConfigured) return "";
  try {
    const user = await getSessionUser(await headers());
    if (!user) return "";
    const detail = await getApplicationDetail(user.id, applicationId);
    return detail.application.jdText ?? "";
  } catch {
    return "";
  }
}

export default async function ApplyPage({ searchParams }: PageProps<"/postular">) {
  const { app, desde, [TOUR_PARAM]: tour } = await searchParams;
  const applicationId = typeof app === "string" ? app : undefined;
  const desdeId = typeof desde === "string" ? desde : undefined;

  const initialJobText = !applicationId && desdeId ? await loadInitialJobText(desdeId) : undefined;

  // Keyed so switching applications (o la publicación de origen) remounts the
  // wizard with clean local state instead of carrying the previous one's
  // draft job text across.
  return (
    <>
      {/* «Guiame» (`?guia=1`) switches the tour on. Before the wizard in the page, so that the keyboard reaches its buttons without crossing the wizard; the card is
          fixed at the foot of the screen either way. Not keyed: the wizard remounts when the CV is saved, and the tour goes on through it. */}
      <PostularGuide start={tour === "1"} />
      <Wizard
        key={applicationId ?? (desdeId ? `desde-${desdeId}` : "new")}
        applicationId={applicationId}
        initialJobText={initialJobText}
      />
    </>
  );
}
