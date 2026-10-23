/**
 * Quién presta este servicio, para las obligaciones que exigen decirlo.
 *
 * El art. 4 de la Ley 24.240 y el art. 1100 del CCyC obligan a identificar al
 * proveedor; el art. 6 de la Ley 25.326 obliga a decir quién es el responsable
 * de la base de datos. Hasta ahora el sitio no lo decía en ningún lado.
 *
 * Variables de entorno y no constantes, por la misma razón que `packPriceArs()`
 * en `lib/billing/pack.ts`: son datos que cambian sin que cambie el código —una
 * mudanza, un alta de CUIT, un cambio de figura fiscal— y que tienen que poder
 * corregirse editando el Secret y reiniciando, no abriendo un editor. También
 * es lo que permite que el repo no lleve datos personales del titular.
 *
 * Deliberadamente SIN `server-only`, por la misma razón que
 * `lib/ai/provider-catalog.ts`: `components/landing/parts.tsx` exporta el
 * `Footer` junto con primitivas (`Cta`, `Section`, `Card`) que mañana pueden
 * necesitarse en un componente de cliente, y marcarlo acá convertiría todo ese
 * módulo en server-only de rebote.
 *
 * El costo de esa decisión es que en un contexto de cliente las variables leen
 * `undefined`. Por eso `PENDING` no es una cadena vacía: un dato faltante se
 * VE, en la página, en el lugar donde tendría que estar el CUIT. Un bloque de
 * identificación que se omite en silencio es exactamente la infracción que este
 * módulo existe para evitar.
 */

// Relative, and not `@/…`: `next.config.ts` reaches this file through `lib/experiments.ts`, and its loader does not resolve an alias there.
import { salesEnabled } from "../payments/sales";

/** Lo que se muestra donde falta un dato obligatorio. Visible a propósito. */
const PENDING = "[pendiente de carga]";

function read(name: string): string {
  return process.env[name]?.trim() || PENDING;
}

/**
 * Un valor que está puesto pero no es un dato.
 *
 * El Secret de producción se despliega desde una plantilla que trae `XXXXX` en
 * cada campo por llenar, y contra `PENDING` solo eso ya alcanzaba para pasar:
 * `"XXXXX" !== "[pendiente de carga]"`. O sea que el chequeo que existe para
 * avisar que el pie del sitio salió sin identificar al responsable aprobaba
 * justamente el caso que tenía que atrapar.
 *
 * Se ataja el placeholder que este repo usa de verdad, no cualquier cadena
 * sospechosa: adivinar qué es "un nombre real" es lo que termina rechazando a
 * alguien que se llama X. Una repetición de equis y nada más.
 *
 * Exportada porque `Pending`, en `components/legal/parts.tsx`, la necesita
 * para lo mismo del otro lado: antes sólo resaltaba lo que empieza con `[`,
 * así que un `XXXXX` pasaba a la página como texto común, sin marca — la
 * mitad del mismo bug que este chequeo existe para atrapar del lado de
 * `operatorConfigured()`. Una sola definición de "esto es un placeholder"
 * para los dos lugares que tienen que reconocerlo.
 */
export function isPlaceholder(value: string): boolean {
  return value === PENDING || /^x{3,}$/i.test(value);
}

/**
 * Lo mismo que `read()`, para un campo que es válidamente ausente (`null`)
 * en vez de "pendiente de carga" — `rnbdFile` y, como primer paso, también
 * `rnbdNumber` (ver `readRnbdNumber` para el chequeo completo de ese). La
 * diferencia con `read()` es que acá `"XXXXX"` también cuenta como ausente:
 * sin este chequeo, el placeholder de la plantilla de despliegue se leería
 * como un dato real.
 */
function readOrNull(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && !isPlaceholder(value) ? value : null;
}

/**
 * Si un valor tiene forma de número de expediente GDE (TAD) — p. ej.
 * `"EX-2026-83681646- -APN-DNPDP#AAIP"` — en vez de un número de inscripción
 * del RNBD.
 *
 * Existe porque `isPlaceholder()` no alcanza para distinguirlos: un
 * expediente es un valor real, con forma de dato, así que no lo ataja nada
 * de lo de arriba. Y es un error fácil de cometer — el expediente es lo
 * único que existe mientras el trámite está en curso, así que es lo primero
 * que alguien va a tener a mano para cargar en `LEGAL_RNBD_NUMBER`. Sin este
 * chequeo, ese valor se renderiza en la cláusula 8 como "La base está
 * inscripta ... bajo el número EX-2026-...": exactamente la misma afirmación
 * falsa de inscripción que `readOrNull` existe para evitar con "XXXXX"
 * (B1 de la auditoría legal), con otro texto.
 *
 * El ancla `^EX-\d{4}-\d+` alcanza: es la parte fija de todo número de
 * expediente GDE (año de apertura + correlativo), antes de los códigos de
 * organismo que varían.
 */
function isExpedienteNumber(value: string): boolean {
  return /^EX-\d{4}-\d+/i.test(value);
}

/**
 * Número de inscripción en el RNBD — nunca un expediente. `null` mientras no
 * haya uno real: vacío, `"XXXXX"`, o un expediente GDE cargado por error
 * (ver `isExpedienteNumber`). Los tres casos hacen que la cláusula 8 diga
 * "en trámite de inscripción" en vez de afirmar una inscripción que no
 * existe.
 */
function readRnbdNumber(): string | null {
  const value = readOrNull("LEGAL_RNBD_NUMBER");
  return value && !isExpedienteNumber(value) ? value : null;
}

export type Operator = {
  /** Nombre y apellido, o razón social. */
  name: string;
  /**
   * CUIT/CUIL, como se factura. `null` cuando esta instalación no vende: sin
   * venta el CUIT deja de ser un dato obligatorio para volverse uno que no
   * conviene publicar, así que se omite en vez de mostrarse como
   * "[pendiente de carga]" — esa marca queda reservada para cuando `salesEnabled`
   * es `true` y de verdad falta cargarlo.
   */
  taxId: string | null;
  /**
   * Domicilio del responsable. A diferencia de `taxId`, no depende de la venta:
   * el art. 6 b) de la Ley 25.326 obliga a informar «la identidad y domicilio de
   * su responsable» al recolectar datos, se venda algo o no. Con venta es
   * obligatorio y, si falta, se ve («[pendiente de carga]»). Sin venta es
   * opcional: `null` mientras `LEGAL_OPERATOR_ADDRESS` no esté cargada (vacía o
   * `XXXXX` cuentan como no cargada), y sólo lo publica la cláusula 1 de
   * privacidad — el pie sigue mostrando la identidad fiscal únicamente con
   * venta. Un domicilio publicado no se retira: lo carga quien decidió cuál
   * informar, cuando lo decide.
   */
  address: string | null;
  /** La casilla que se publica para reclamos y para los derechos del art. 14. */
  email: string;
  /** Condición frente al IVA, para la leyenda de precio final. Solo con venta. */
  taxStatus: string | null;
  /**
   * Número de inscripción en el Registro Nacional de Bases de Datos (RNBD),
   * AAIP. `null` mientras no haya uno real: vacío, `"XXXXX"`, o un número de
   * expediente GDE cargado por error (ver `isExpedienteNumber`). En
   * cualquiera de los tres casos la cláusula 8 de privacidad dice "en
   * trámite de inscripción" en vez de afirmar una que no existe — que es
   * exactamente el error que tenía esta página antes de que este campo
   * existiera (afirmaba estar inscripta con el número "[pendiente de
   * carga]"), de nuevo antes de `readOrNull` (con "XXXXX"), y de nuevo antes
   * de `readRnbdNumber` (con el número de expediente).
   */
  rnbdNumber: string | null;
  /**
   * Número de expediente GDE (TAD) del trámite de inscripción en el RNBD,
   * mientras todavía no hay número de inscripción. Se muestra junto a "en
   * trámite" en la cláusula 8 — una referencia concreta y verificable, sin
   * afirmar un estado que no es cierto. `null` si tampoco se cargó éste.
   */
  rnbdFile: string | null;
};

export function operator(): Operator {
  return {
    name: read("LEGAL_OPERATOR_NAME"),
    taxId: salesEnabled ? read("LEGAL_OPERATOR_TAX_ID") : null,
    address: salesEnabled ? read("LEGAL_OPERATOR_ADDRESS") : readOrNull("LEGAL_OPERATOR_ADDRESS"),
    email: read("LEGAL_CONTACT_EMAIL"),
    taxStatus: salesEnabled ? process.env.LEGAL_OPERATOR_TAX_STATUS?.trim() || PENDING : null,
    rnbdNumber: readRnbdNumber(),
    rnbdFile: readOrNull("LEGAL_RNBD_FILE"),
  };
}

/**
 * Si falta algún dato obligatorio de IDENTIDAD — no el estado de la
 * inscripción en el RNBD, que se informa aparte con `rnbdStatus()`.
 *
 * No bloquea el render —una página legal a medias sigue siendo mejor que un
 * 500— pero deja que `app/api/health` y el aviso de desarrollo lo reporten, y
 * que quien despliegue se entere antes que un inspector.
 *
 * Sin venta, `taxId` no es obligatorio: el CUIT es una obligación de quien
 * vende (LDC art. 4, CCyC art. 1100). El domicilio sí lo pide el art. 6 b) de
 * la Ley 25.326 se venda o no, pero NO se exige acá: mientras quien opera no
 * decide cuál informar, exigirlo haría que `legal` diera `false` por un dato
 * que todavía no existe. Cuando `LEGAL_OPERATOR_ADDRESS` esté en el Secret de
 * producción, sumar `o.address` a `required` sin condición de venta.
 *
 * `rnbdNumber` YA NO es parte de este chequeo — antes lo era, y ahí estaba el
 * problema. El deber de inscribir la base (art. 21, Decreto 1558/2001) se
 * cumple iniciando el trámite, y "en trámite de inscripción" — lo que
 * `rnbdStatus()` devuelve mientras `rnbdNumber` es `null` — es un estado
 * honesto para publicar, no una falta. Exigirlo acá sólo dejaba dos salidas
 * en la práctica: cargar un valor que no es un número de inscripción para
 * que esto diera `true` (el expediente GDE, B1 de la auditoría legal), o que
 * `legal` diera `false` mientras la AAIP resuelve el trámite — que puede
 * tardar meses y no es algo que este sitio controle.
 */
export function operatorConfigured(): boolean {
  const o = operator();
  const required = [o.name, o.email, ...(salesEnabled ? [o.taxId, o.address] : [])];
  if (!required.every((value) => value !== null && !isPlaceholder(value))) return false;

  // El correo es el único de los cuatro que tiene una forma verificable, y es
  // el que más caro sale mal: es la vía por la que se ejercen los derechos del
  // art. 14, así que una casilla que no puede recibir nada es una vía cerrada.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email);
}

/**
 * Estado de la inscripción en el RNBD, separado de `operatorConfigured()`
 * (ver su comentario para el porqué). Nunca es un `boolean`: "en trámite" es
 * un estado válido para publicar mientras la AAIP no resolvió, no un error,
 * así que no tiene sentido que participe de un chequeo de "algo falta".
 */
export function rnbdStatus(): "inscripto" | "en trámite" {
  return operator().rnbdNumber !== null ? "inscripto" : "en trámite";
}

/**
 * La versión de los textos legales que el usuario aceptó.
 *
 * Va guardada junto al consentimiento: "aceptó los términos" sin decir cuáles
 * no prueba nada, y el consentimiento a la transferencia internacional de datos
 * (Ley 25.326 art. 12) tiene que poder apuntar al texto que describía esa
 * transferencia. Subir esta constante cuando el cambio sea sustantivo —no por
 * corregir una coma— y dejar la fecha de vigencia de abajo alineada.
 *
 * Cada subida vuelve a pedir tres consentimientos (los de `lib/legal/consent.ts` que se
 * comparan con ella), y por eso se sube **una vez por lote** de cambios y no por cambio:
 * qué entró en cada versión, la regla y lo que espera para la próxima están en
 * `docs/legal/versiones.md`, y `tests/legal-versions.test.ts` mantiene las tres cosas
 * —esta constante, la fecha de abajo y ese registro— de acuerdo.
 */
export const LEGAL_VERSION = "2026-10-07";

/** Cómo se muestra la vigencia en las páginas. */
export const LEGAL_EFFECTIVE_DATE = "7 de octubre de 2026";
