import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Clause, LegalDoc, Pending } from "@/components/legal/parts";
import {
  GOOGLE_EUROPE,
  GOOGLE_FREE_FACTS,
  GOOGLE_PAID_FACTS,
  GOOGLE_TERMS_IN_FORCE,
  GOOGLE_TERMS_READ_ON_TEXT,
  GOOGLE_TERMS_URL,
  WITHOUT_AI,
} from "@/lib/ai/google-terms";
import { operator } from "@/lib/legal/operator";

/**
 * Dinámica, no estática con revalidación por hora. Esta fue la página en la
 * que se confirmó el bug: `operator()` (abajo) lee variables de entorno
 * (`LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_RNBD_NUMBER`…) que
 * sólo existen en el pod de producción, nunca durante el `docker build`. Con
 * `revalidate` el HTML queda grabado con «[pendiente de carga]» desde el
 * build, y la regeneración en segundo plano no lo corrigió en la práctica —
 * se verificó sirviendo ese texto con `x-nextjs-cache: HIT` mucho después de
 * vencido el plazo. Ver `app/page.tsx` para el detalle completo.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Qué datos personales trata cvexact, a quién se transfieren, por cuánto tiempo se " +
    "conservan y cómo ejercer los derechos de acceso, rectificación y supresión.",
};

/**
 * La política de privacidad.
 *
 * El art. 6 de la Ley 25.326 obliga a informar, en el momento de recolectar, la
 * finalidad, los destinatarios, el carácter facultativo de las respuestas y cómo
 * se ejercen los derechos — y esa obligación no depende de que se venda nada:
 * es este documento, no los términos, el que sigue siendo obligatorio con la
 * venta apagada (ver `salesEnabled` en `lib/payments/sales.ts`).
 *
 * Reescrita para una instalación que no vende nada: la versión anterior decía
 * que el perfil viajaba a DeepSeek, en China, en los planes pagos. Eso dejó de
 * ser cierto en cuanto la venta se apagó —sin tier de servicio, toda
 * generación es BYOK— y avisar de una transferencia que no ocurre no es
 * prudente, es información incorrecta sobre destinatarios, que es justo lo que
 * el art. 6 obliga a dar bien. Tampoco se habla ya de compras, saldo, ARCA ni
 * Factura C: nada de eso ocurre. El texto de DeepSeek está en el historial de
 * git, para cuando esta instalación vuelva a vender.
 *
 * Se mantiene la seudonimización del prompt —sacar nombre, teléfono, email,
 * links y la URL de los proyectos antes de la llamada al modelo— que sigue
 * corriendo igual (`lib/ai/prompts/shared.ts`, `IDENTITY_WITHHELD`) sea cual
 * sea el proveedor: el nombre real se repone recién en la respuesta, del lado
 * del servidor (`restoreCandidateName`). Si algún día deja de ser cierto, hay
 * que volver a escribir la cláusula 5 y subir `LEGAL_VERSION` en
 * `lib/legal/operator.ts` antes que el código.
 *
 * Los anclajes importan: `components/onboarding/AiAction.tsx` enlaza
 * `#c7` (datos sensibles) y `components/legal/TransferConsent.tsx` cita «la
 * cláusula 5» en prosa. Los números de cláusula no se movieron por eso —solo
 * cambió el contenido de 1, 3, 4, 5 y 9— así que los dos enlaces siguen
 * cayendo donde corresponde.
 *
 * Segunda pasada, cuando las donaciones también se apagaron y volvieron
 * (persona física sin monotributo: la cláusula de donaciones está en los
 * términos, no acá). Se sacó la mención a Mercado Pago de las cláusulas 3, 4
 * y 5 — no queda ningún destinatario de pago porque no hay ningún pago. La
 * cláusula 5 nombra en su lugar los tres destinatarios que siempre
 * estuvieron pero nunca se habían declarado con precisión: Hostinger
 * (servidor y base, Brasil), Cloudflare (CDN y filtrado, EE. UU.) y
 * Bunny.net (backups, UE). La cláusula 9 suma la retención de esos backups.
 *
 * Tercera pasada: la cláusula 5 decía que los tres estaban «en la Unión
 * Europea» y que por eso no había transferencia internacional que declarar.
 * Eso nunca fue cierto — el servidor está en Hostinger/Brasil desde el
 * primer despliegue y Cloudflare siempre estuvo delante del tráfico — y
 * declarar mal a los destinatarios es justo la infracción que el art. 6 de
 * la Ley 25.326 existe para evitar. Se corrigió nombrando país real de cada
 * uno y la base legal que sostiene la transferencia a Brasil y EE. UU.
 * (cláusulas contractuales modelo, Disp. AAIP 60-E/2016), y se agregó a la
 * cláusula 1 la identificación del encarregado que exige la LGPD brasileña
 * por el tratamiento en ese territorio (art. 41). La cláusula 9 se corrigió
 * en el mismo sentido: decía 90 días de retención de sesión y el código
 * nunca configuró más que el default de Better Auth (7 días) — ver el
 * comentario en `lib/auth.ts` junto a `advanced.ipAddress`.
 *
 * Cuarta pasada: el correo dejó de salir por Gmail y pasó a Resend (relay
 * SMTP, ver `lib/email/mailer.ts` y `lib/email/budget.ts`). La cláusula 5
 * nunca había llegado a nombrar al proveedor de correo —ni siquiera cuando
 * era Gmail—, así que de paso se corrige esa omisión: pasa a ser el cuarto
 * destinatario, en Estados Unidos, cubierto por la misma vía que Hostinger y
 * Cloudflare (cláusulas contractuales modelo). A diferencia de esos dos,
 * Resend firma un DPA del art. 28 RGPD para toda cuenta sin trámite aparte,
 * que es lo que efectivamente sostiene la base legal de este destinatario.
 *
 * Quinta pasada: alertas de empleo por correo (`lib/db/schema.ts#jobAlert`,
 * `app/api/jobs/alerts/`). Se agregó como cláusula 14, al final —no en medio,
 * a pesar de encajar temáticamente cerca de la 5— porque `AiAction.tsx` ancla
 * `#c7` y `TransferConsent.tsx` cita "cláusula 5" por número en prosa, y
 * varios archivos más citan la 8 y la 9 (ver el comentario de
 * `Clause` en `components/legal/parts.tsx`): renumerar significaba tocar
 * esas referencias para ganar un orden que agregar al final ya daba igual. Se
 * sumó además un bullet a la 4 (la alerta es un correo más, hay que
 * declararlo) y a la 9 (cuánto vive la configuración guardada). Ningún
 * destinatario nuevo: el puntaje se calcula en nuestro propio servidor con
 * las mismas reglas deterministas de `lib/jobs/score.ts` que ya corren en el
 * navegador — no hay una llamada a un modelo de lenguaje de por medio, así
 * que la cláusula 5 no necesitó tocarse.
 *
 * Sexta pasada: el toggle opcional de afinidad semántica en Empleos
 * (`useSemanticJobsEnabled`, `app/(app)/empleos/embedder.worker.ts`). A
 * diferencia de todo lo anterior, acá el navegador sí se conecta directo a
 * un tercero — Hugging Face, para bajar los pesos del modelo — sin que
 * nuestro servidor intermedie esa conexión ni la vea. No es un destinatario
 * de datos personales en el sentido del art. 6 (no le mandamos el perfil,
 * sólo bajamos archivos estáticos), así que no hizo falta tocar la cláusula
 * 5 ni la 4; igual se declara en una cláusula propia (15, al final por el
 * mismo motivo que la 14) por transparencia sobre con quién habla el
 * navegador. `next.config.ts` documenta el mismo hecho del lado de la CSP
 * (`connect-src`).
 *
 * Séptima pasada, sobre la cláusula 9: decía que el consumo agregado se
 * guardaba "indefinidamente, porque no identifica a nadie", pero eso sólo
 * describía a `generation_usage` — `usage_counter` (el contador del tope
 * diario) queda atado a la cuenta o a un hash de IP, y `scripts/prune.mjs`
 * poda las dos a los 90 días, no indefinidamente. Se separaron en dos
 * bullets con su plazo real. De paso se agregó `legal_request` (3 años tras
 * resolverse, ver el comentario de `LEGAL_REQUEST_DAYS` en `prune.mjs`), que
 * no estaba en esta cláusula, y se corrigió el backup: decía "sin borrado
 * automático" y ahora lo tiene (`scripts/prune-backups.mjs`, 30 días).
 *
 * Pasada del 2026-09-18, de la auditoría legal previa a la publicación. Cada
 * cambio corrige una frase que el código ya contradecía; ninguno cambia lo que
 * el servicio hace.
 *  - Cl. 3: «nunca el documento del CV» era falso al sincronizar
 *    (`application.data`, `app/api/sync/route.ts`). Se declara además el texto
 *    del aviso (`application.jd_text`) y el correo que se tipea en un ingreso
 *    fallido (`login_attempt`), que no figuraban.
 *  - Cl. 5: Resend no ve «solo el texto fijo»: las alertas, el aviso de
 *    abandono y los recordatorios llevan puesto, empresa y la nota del usuario
 *    (`lib/email/templates.ts`). «Qué se envía» al modelo omitía el país, los
 *    proyectos, los intereses y el bloque práctico de `serializeProfile`
 *    (`lib/ai/prompts/shared.ts`). El backup es cada 2 horas, no diario.
 *  - Cl. 8: el export no trae credenciales, y ahora lo dice.
 *  - Cl. 10: «cifrado de punta a punta» era inexacto: Cloudflare termina la
 *    conexión (lo admite la cl. 5). Ahora dice que las conexiones van cifradas
 *    con HTTPS, que se puede afirmar sin depender del modo SSL de Cloudflare.
 *  - Cl. 9: plazo para los datos de terceros del seguimiento
 *    (`THIRD_PARTY_DAYS` en `scripts/prune.mjs`) y para los intentos de ingreso
 *    y los contadores de frecuencia, que no figuraban.
 *  - Cl. 16 a 19: el texto del aviso, el dominio real del alias (era un
 *    ejemplo que quedó publicado), cómo lee la página la extensión, y que hoy
 *    sólo está en Chrome. Al publicarla en Firefox, volver a nombrarlo acá.
 * `LEGAL_VERSION` sube en la misma pasada (`lib/legal/operator.ts`).
 *
 * Pasada del 2026-09-19 (cuarta auditoría legal). Dos correcciones; ninguna cambia
 * lo que el servicio hace.
 *  - Cl. 1: el domicilio del responsable sale cuando `LEGAL_OPERATOR_ADDRESS` está
 *    cargada, haya venta o no (`operator()`): el art. 6 b) de la Ley 25.326 lo
 *    pide independientemente de la venta. Sin la variable, la cláusula no cambia.
 *  - Cl. 13: prometía «avisamos por correo a quienes tengan cuenta» y no existe
 *    ningún envío que lo cumpla (`lib/email/templates.ts` no tiene una plantilla
 *    de cambio de política y ningún CronJob la manda). Ahora describe lo que sí
 *    pasa: la versión y la fecha de esta página, y la pausa de las dos funciones
 *    cuyo consentimiento va atado a `LEGAL_VERSION` (`hasJobAlertsConsent` y
 *    `hasTrackerMailConsent`, en `lib/legal/consent.ts`). La detección por email
 *    (cl. 17) NO se pausa: su consentimiento no se compara con la versión. Si se
 *    construye el aviso por correo, volver a prometerlo acá y en la cl. 10 de los
 *    términos.
 * `LEGAL_VERSION` sube en la misma pasada.
 *
 * Segunda pasada del 2026-09-19: Empleos ordena los avisos poniendo primero los
 * del país del visitante, que el servidor toma del header `CF-IPCountry` de
 * Cloudflare (`lib/client-country.ts`). Cl. 3: párrafo nuevo diciendo que se usa
 * ese dato, que se usa en el momento y que no se guarda; y se sacó el
 * «únicamente» del párrafo sin cuenta, que decía que la IP sólo servía para
 * contar el uso y frenar abusos. Ningún destinatario nuevo: Cloudflare ya figura
 * en la cl. 5. `LEGAL_VERSION` sube a `2026-09-19.2` en la misma pasada.
 *
 * Pasada del 2026-09-22: ingreso por enlace de correo (magic link,
 * `better-auth/plugins`, ver `lib/auth.ts`) y dos puntos de contacto nuevos con
 * IA en el armado guiado del perfil.
 *  - Cl. 3: párrafo nuevo — entrar sin contraseña sigue guardando el nombre y el
 *    correo, y la sesión se registra igual; el token del enlace vence a los 15
 *    minutos y se borra al usarse (`consumeVerificationValue`, en el propio
 *    paquete de Better Auth — de un solo uso, verificado contra el código antes
 *    de afirmarlo acá).
 *  - Cl. 4 y 5 (Resend): «enlaces de acceso» sumado a la lista de correos de
 *    texto fijo — es la misma plantilla, un destinatario que ya figuraba.
 *  - Cl. 5: la excepción de «importar un CV» —el documento viaja tal como
 *    está, nombre real incluido— se amplía a contar el recorrido con las
 *    propias palabras y a separar una respuesta en hechos (`lib/ai/prompts/
 *    extract.ts`, `lib/ai/prompts/split.ts`): ninguna de las dos pasa el
 *    perfil ni lo seudonimiza, mandan el texto tal cual se escribió, por lo
 *    que caen bajo la misma excepción y no bajo «qué se envía» / «qué no se
 *    envía», que describen el generador de CV.
 *  Ningún destinatario nuevo. `LEGAL_VERSION` sube a `2026-09-22` en la misma
 *  pasada, lo que deja desactualizado el consentimiento de las alertas de
 *  empleo (cl. 13): se vuelve a pedir.
 *
 * Pasada del 2026-09-23: botón de dictado por voz en los campos de texto libre
 * del armado guiado del perfil (`SpeechRecognition`/`webkitSpeechRecognition`,
 * sin backend propio). Se agrega como cláusula 20, al final por el mismo
 * motivo que la 14 y la 15: no renumerar lo que `AiAction.tsx` (`#c7`) y
 * `TransferConsent.tsx` («cláusula 5») ya anclan por número. Un destinatario
 * nuevo y de naturaleza distinta a la cláusula 5: ahí la persona elige y
 * configura su propio proveedor; acá quien recibe el audio lo trae el
 * navegador —Google en Chrome/Chromium, Apple en Safari— sin que medie
 * nuestro servidor ni una key. En los navegadores sin esta API (Firefox) el
 * botón no se renderiza; ver el chequeo de soporte junto a donde se usa.
 * `LEGAL_VERSION` sube a `2026-09-23` en la misma pasada, lo que vuelve a
 * pedir el consentimiento de las alertas de empleo (cl. 13).
 *
 * Pasada del 2026-09-28: el resultado de cada generación de documentos (CV,
 * respuestas, email, entrevista, guion de video) se guarda un día en
 * `generation_result`, cifrado (AES-256-GCM) con una clave derivada de la clave
 * aleatoria que genera el navegador para ese pedido
 * (`lib/generation/result-cache.ts`). Existe para recuperar un resultado que no
 * llegó o que el navegador no pudo guardar sin generarlo ni cobrarlo otra vez.
 *  - Cl. 21 nueva, al final por el mismo motivo que la 20: no renumerar lo que
 *    ya se ancla por número.
 *  - Cl. 2: la excepción, dicha en un párrafo. Cl. 9: el plazo.
 *  Verificado contra el código antes de afirmarlo: la fila no tiene `user_id`
 *  ni IP, guarda el SHA-256 de la clave y nunca la clave (`hashKey`), y se
 *  borra por `expires_at` al leer y por `scripts/prune.mjs` en disco. Ningún
 *  destinatario nuevo: queda en la misma base y en las mismas copias de
 *  seguridad que la cl. 9 ya describe.
 *  `LEGAL_VERSION` sube a `2026-09-28` en la misma pasada, lo que vuelve a pedir
 *  el consentimiento a la transferencia (`hasTransferConsent`, tiers pagos), el
 *  de las alertas de empleo (cl. 13) y el del aviso del seguimiento.
 *
 * Pasada del 2026-10-04: dos cambios y el consentimiento de lectura, en una sola
 * versión.
 *  - Cl. 5: la excepción de los textos que se leen (importar un CV, contar el
 *    recorrido, separar una respuesta) dejó de decir «tal como está». Antes de
 *    enviarlo, el navegador tapa los datos personales que el producto no usa
 *    —nacimiento, edad, documento, estado civil, sexo, hijos y domicilio, por su
 *    rótulo— y toda la sección de referencias (`lib/parse/redact.ts`, aplicado
 *    en `extractWithAi` y en `splitWithAi`), y hace lo mismo con la copia del
 *    documento que guarda el navegador. Verificado contra el código: lo que
 *    mira `tests/redact.test.ts` es el cuerpo del pedido. Lo que no lleva rótulo
 *    no se reconoce, y la cláusula lo dice en vez de prometer más.
 *  - Cl. 5, además: una foto o un escaneo del CV (`/api/generate/transcribe`,
 *    `lib/ai/vision.ts`) se lee con el modelo de la persona, y es lo único que
 *    no se puede tapar antes —nadie sabe dónde está el documento en una imagen
 *    hasta haberla leído—. Va entera, solo con key propia (la ruta rechaza los
 *    tiers pagos: `byok_required`), y la cláusula lo dice. Verificado contra el
 *    código: la ruta no guarda la imagen, que viaja con el pedido; el navegador
 *    la redibuja en un canvas antes de enviarla (`lib/import/photo.ts`), que
 *    descarta sus metadatos; y el texto que vuelve es lo que se muestra para
 *    comparar con la foto y de donde sí se tapan los datos.
 *  - Cl. 5, además: cuarta excepción, solo si la persona la activa —un
 *    experimento, apagado para todos—: que su IA elija cuál de las preguntas
 *    fijas del motor sigue a una respuesta (`/api/generate/followup`,
 *    `lib/ai/followup.ts`). Manda la respuesta, con los datos personales ya
 *    tapados (`chooseFollowUpWithAi`), y la lista; vuelve el id de una de esas
 *    preguntas o «none»: no escribe nada, y la ruta lo vuelve a comprobar. Solo
 *    con key propia, como la foto.
 *  - Cl. 2: la sincronización sigue siendo una acción de la persona, ahora de
 *    dos maneras: el botón, o «Mantener sincronizado», un permiso aparte que se
 *    pide antes de activarlo (`enableAutoSync`) y se apaga cuando quiera. Sube
 *    solo el perfil —no las postulaciones—, después de mirar que la cuenta no
 *    haya cambiado desde otro dispositivo (`lib/profile/auto-sync.ts`); si
 *    cambió, frena y pregunta. Ningún destinatario ni dato nuevo: es el mismo
 *    `POST /api/sync` que el botón, con el mismo perfil.
 *  - `TransferConsent` tiene variante de lectura (`kind="read"`) y dice lo que
 *    pasa con un texto que se lee (`lib/legal/data-flow.ts`): antes describía
 *    solo la generación, y quien daba el permiso para importar un CV leía que su
 *    nombre no viaja.
 *  `LEGAL_VERSION` sube a `2026-10-04` en la misma pasada, lo que vuelve a pedir
 *  el consentimiento a la transferencia (`hasTransferConsent`, tiers pagos), el
 *  de las alertas de empleo (cl. 13) y el del aviso del seguimiento.
 *
 * Pasada del 2026-10-07: lo que cambió en el producto entre el 4 y el 7 de
 * octubre —las etapas 1 a 5 de «el perfil en el tiempo»—, en
 * UNA sola versión: ninguna de esas etapas se desplegó antes de ésta, y nada de lo
 * que está apagado entra: su texto espera en la cola de
 * `docs/legal/versiones.md`, para escribirse cuando se prenda. Cada frase se
 * verificó contra el código antes de afirmarla, y está sostenida por un test
 * (`tests/legal-data-flow.test.ts`).
 *  - Cl. 2: el navegador puede borrar el perfil (Safari, tras siete días de uso sin
 *    entrar al sitio; los demás, si falta espacio), y la frase «no podemos perderlo»
 *    sola no lo decía. Qué hace la app: `lib/storage/durability.ts`, `docs/durabilidad.md`.
 *  - Cl. 3: lo que sube la sincronización. La frase anterior listaba los contenidos y
 *    callaba lo que el perfil lleva con cada uno, que ya viajaba: de dónde salió y la
 *    frase del documento que lo respalda (`source.quote`), la fecha en que se agregó y
 *    la de la última confirmación (`confirmedAt`), el vencimiento de una credencial y
 *    el de la licencia (`expires`, `driverLicenseExpires`), lo que se contestó que no
 *    se tiene, con su fecha y la línea del aviso (`declined`), los datos prácticos, las
 *    notas y lo que no encajó en ninguna sección, las preguntas que se dejaron para
 *    después y el paso del armado. Lo que NO sube lo hace `forSync`
 *    (`lib/profile/sync.ts`): el historial, lo quitado y el nombre de los archivos.
 *  - Cl. 5: leer con IA ya no manda el nombre ni el contacto. Antes de enviar, el
 *    navegador los reemplaza por marcas y las repone en la respuesta
 *    (`lib/parse/mask-contact.ts`, en `extractWithAi`, `splitWithAi` y
 *    `chooseFollowUpWithAi`); el contacto de un CV lo leen los patrones, nunca el
 *    modelo. Se dice lo que reconoce y lo que no. El grupo y factor sanguíneo y ser
 *    donante se suman a lo que se tapa por rótulo (`PERSONAL_DATA_LABELS`). Las
 *    condiciones del nivel gratuito de Google salen de `lib/ai/google-terms.ts`, que
 *    es lo mismo que dicen las pantallas antes de armar la key: ahí está cada frase al
 *    lado de la de los términos (en vigencia desde el 23 de marzo de 2026, leídos el 7
 *    de octubre). De los demás proveedores no se afirma nada: no se leyeron. Las
 *    fechas, los vencimientos y los «no» no llegan a ningún modelo
 *    (`tests/credentials.test.ts`, `tests/declined.test.ts`).
 *  - Cl. 7: la licencia guarda la clase y, si la persona quiere, el vencimiento; no el
 *    número ni la foto. Que una licencia argentina trae grupo y factor sanguíneo lo cita
 *    e5 desde una ordenanza municipal y no desde InfoLEG: la cláusula lo dice sin citar la
 *    ley, y queda para la asesoría legal.
 *  - Cl. 12: la API de Gemini exige 18 años y el servicio es desde los 16: se dice, con
 *    lo que funciona sin IA. No se pregunta la edad (Q10 queda abierta).
 *  No se tocaron los términos: la cláusula 4 ya dice que el contrato con el proveedor de
 *  la key es entre la persona y él. No se afirma si la cláusula de Google sobre «uso
 *  profesional, no de consumo» alcanza a quien usa su propia key: es Q2, de la asesoría.
 *  Ningún destinatario nuevo. `LEGAL_VERSION` sube a `2026-10-07` en la misma pasada, lo
 *  que vuelve a pedir el consentimiento a la transferencia (`hasTransferConsent`, tiers
 *  pagos), el de las alertas de empleo (cl. 13) y el del aviso del seguimiento.
 */
export default function PrivacyPage() {
  const o = operator();
  // El ejemplo del alias de la cláusula 17 tiene que ser el dominio real: un
  // dominio inventado ahí ya estuvo publicado. `.example.com` está reservado
  // para ejemplos, así que si la variable falta se nota que es uno.
  const trackerDomain = process.env.TRACKER_EMAIL_DOMAIN?.trim() || "tracker.example.com";

  return (
    <LegalDoc
      title="Política de privacidad"
      intro={
        <p>
          Lo más importante en tres líneas: tu perfil vive en tu navegador salvo que crees una
          cuenta para sincronizarlo. Para generar un CV, el contenido de tu perfil se envía al
          proveedor de modelos de lenguaje que vos elegiste y configuraste con tu propia API
          key: el país y la empresa los elegís vos, no nosotros.
        </p>
      }
    >
      <Clause n={1} title="Quién es responsable de tus datos">
        <p>
          El responsable de la base de datos es <Pending>{o.name}</Pending>
          {o.taxId ? (
            <>
              , CUIT <Pending>{o.taxId}</Pending>
            </>
          ) : null}
          {o.address ? (
            <>
              , con domicilio en <Pending>{o.address}</Pending>
            </>
          ) : null}
          .
        </p>
        <p>
          Para cualquier cuestión sobre tus datos, incluido el ejercicio de los derechos de la
          cláusula 8, escribí a <Pending>{o.email}</Pending>.
        </p>
        <p>
          El servidor que procesa tus datos está en Brasil (cláusula 5), así que además de la
          Ley 25.326 argentina se aplica la Lei Geral de Proteção de Dados (LGPD) brasileña por
          el tratamiento realizado en su territorio. A los efectos de la LGPD, la misma persona
          identificada arriba actúa como encarregado (art. 41), y se la contacta por la misma
          vía.
        </p>
      </Clause>

      <Clause n={2} title="Dónde viven tus datos, por defecto">
        <p>
          Esto es lo primero porque cambia todo lo demás:{" "}
          <strong>tu perfil y tus postulaciones se guardan en tu propio navegador</strong>, no
          en nuestros servidores. Si usás el producto sin crear cuenta, no tenemos tu
          currículum: no podemos leerlo, entregarlo ni perderlo.
        </p>
        <p>
          Lo que sí puede pasar es que <strong>tu navegador lo borre</strong>, y no podemos
          evitarlo: Safari, en una pestaña, borra lo que un sitio guarda cuando pasan siete
          días de uso del navegador sin que entres a ese sitio, y los demás pueden borrarlo
          si al equipo le falta espacio. Por eso la app te dice, en Ajustes, dónde vive tu
          perfil en tu navegador y qué lo cuida: agregarla a la pantalla de inicio, pedirle
          al navegador que lo conserve y bajar una copia a un archivo, que podés proteger con
          una contraseña que sólo conocés vos: sin ella no se puede abrir, tampoco por
          nosotros, y no hay forma de recuperarla.
        </p>
        <p>
          Hay una sola excepción, breve y a propósito: el resultado de cada documento que
          generás queda un día en nuestra base, cifrado con una clave que sólo tiene tu
          navegador, para que puedas recuperarlo si no te llegó o no se pudo guardar. Lo
          explicamos en la cláusula 21.
        </p>
        <p>
          Cuando creás una cuenta y sincronizás, recién ahí se sube una copia a nuestra base,
          para que puedas recuperarla en otro dispositivo. La sincronización es una acción
          tuya, explícita: ocurre cuando tocás «Subir a mi cuenta» y, solo si activás{" "}
          <strong>«Mantener sincronizado»</strong>, también cada vez que cambiás tu perfil, sin
          que lo pidas. Ese es un permiso aparte: se te pide antes de activarlo y lo apagás cuando
          quieras. En ese caso se sube únicamente el perfil —nunca tus postulaciones— y antes de
          cada subida se mira que tu cuenta no tenga cambios hechos desde otro dispositivo: si los
          tiene, se frena y te lo preguntamos, sin borrar nada. Podés bajar todo o borrarlo
          cuando quieras.
        </p>
      </Clause>

      <Clause n={3} title="Qué datos tratamos">
        <p>
          <strong>Si no creás cuenta:</strong> solo un identificador derivado de tu dirección
          IP, para contar el uso y frenar abusos. No guardamos la IP: lo que se
          almacena es un hash con sal, del que no se puede volver a la dirección.
        </p>
        <p>
          <strong>Con o sin cuenta:</strong> Cloudflare nos informa, en cada visita, el país
          desde el que llegás, que deduce de tu dirección IP. Lo usamos en el momento para
          ordenar la lista de Empleos (primero los avisos de tu país) y no lo guardamos ni lo
          asociamos a tu cuenta ni a tu perfil.
        </p>
        <p>
          <strong>Si creás cuenta con correo:</strong> tu nombre, tu correo electrónico y tu
          contraseña (guardada como hash, nunca en claro). Cada sesión registra además la
          dirección IP y el navegador desde el que iniciaste, para poder detectar accesos
          indebidos. Cuando alguien falla al ingresar, guardamos también el correo que tipeó
          y cuántas veces falló, para frenar los intentos de adivinar una contraseña. Lo
          hacemos exista o no una cuenta con ese correo: si sólo pasara con las que existen,
          el bloqueo delataría cuáles son.
        </p>
        <p>
          <strong>Si entrás con un enlace que te mandamos por correo:</strong> lo mismo que si
          creás cuenta con correo, pero sin contraseña —no hace falta, y no la guardamos—: tu
          nombre (la primera vez) y tu correo electrónico, y cada sesión registra igual la IP y
          el navegador desde el que iniciaste. El enlace es un token de un solo uso, vence a
          los 15 minutos y se borra apenas lo usás.
        </p>
        <p>
          <strong>Si creás cuenta con Google:</strong> lo mismo, más la foto de tu perfil de
          Google, que usamos únicamente para mostrarla en tu cuenta. No accedemos a nada más
          de tu cuenta de Google: ni contactos, ni calendario, ni archivos.
        </p>
        <p>
          <strong>Si sincronizás:</strong> el contenido de tu perfil profesional —nombre,
          contacto, enlaces, ciudad, experiencia laboral, formación, aptitudes, idiomas,
          certificaciones y los textos libres que hayas escrito— y las postulaciones que
          generaste, junto con el aviso que les dio origen.
        </p>
        <p>
          Con cada dato del perfil sube lo que el perfil sabe de él: de dónde salió (si salió
          de un documento, la frase de ese documento que lo respalda, y si lo leyó una IA),
          cuándo lo agregaste y cuándo lo confirmaste por última vez, y, en una
          certificación y en la licencia de conducir, hasta cuándo valen. Sube también lo que
          contestaste que no tenés, con la fecha en que lo dijiste y la línea del aviso a la
          que se lo dijiste; tus datos prácticos (disponibilidad, clase de licencia, vehículo,
          mudanza y permiso de trabajo); tus notas, los textos de tus documentos que no
          encajaron en ninguna sección y los desacuerdos entre ellos; las preguntas que
          dejaste para después y el paso del armado en el que estás. De cada documento que
          importaste sube su tipo, cuándo lo importaste, cómo se leyó, las fechas que el
          propio archivo declara y una huella para no leerlo dos veces: no el archivo, ni su
          nombre, ni su texto. No sube el historial de tus cambios ni lo que quitaste del
          perfil.
        </p>
        <p>
          <strong>Si usás el seguimiento de postulaciones (cláusula 16):</strong> el puesto,
          la empresa, la ubicación, el salario, la fuente y el texto de cada aviso que
          guardás o marcás como postulado, el estado del proceso y su historial de cambios, y
          las notas o contactos que cargues a mano. El seguimiento por sí solo no guarda el
          documento del CV: ese sigue en tu navegador, salvo que sincronices, y entonces viaja
          con las postulaciones que describe el párrafo anterior.
        </p>
        <p>
          También llevamos un registro de consumo agregado por día, acción y modelo, para
          saber qué cuesta prestar el servicio. Ese registro no contiene tu identificador ni
          el contenido de nada que hayas generado.
        </p>
      </Clause>

      <Clause n={4} title="Para qué los usamos">
        <Bullets
          items={[
            "Generar los documentos que nos pedís, que es el objeto del servicio.",
            "Mantener tu cuenta y sincronizar tu perfil entre dispositivos.",
            "Frenar abusos y accesos indebidos: límites de uso, bloqueo por intentos fallidos.",
            "Mandarte los correos imprescindibles: verificación, recuperación de contraseña, enlaces de acceso, confirmación de borrado, avisos de seguridad y las constancias legales.",
            "Si activaste las alertas de empleo, avisarte por correo de avisos nuevos que puedan interesarte (cláusula 14).",
            "Si lo activaste en tu seguimiento, avisarte por correo cuando una postulación pase a «sin respuesta» (cláusula 16).",
          ]}
        />
        <p>
          No usamos tus datos para publicidad, no los vendemos y no los cedemos a terceros
          fuera de lo que dice la cláusula 5. No mandamos correos comerciales.
        </p>
      </Clause>

      <Clause n={5} title="Adónde va tu perfil cuando generás algo">
        <p>
          Para generar un CV, una respuesta o un email hace falta enviarle a un modelo de
          lenguaje el contenido de tu perfil y el texto del aviso. Ese modelo no corre en
          nuestros servidores: corre en el proveedor que vos elegiste y configuraste con tu
          propia API key, en{" "}
          <Link href="/ajustes" className="underline underline-offset-4 hover:text-ink">
            Ajustes
          </Link>
          .
        </p>
        <p>
          <strong>El proveedor lo elegís vos, y el país donde procesa tus datos
          también.</strong> No tenemos ninguna relación contractual con ese proveedor: es un
          contrato entre vos y él, y sus condiciones, su política de privacidad y su plazo de
          retención son las suyas, no las nuestras. Vale la pena leer la política de privacidad
          del proveedor que elijas antes de cargar su key, sobre todo si no sabés dónde
          procesa los datos.
        </p>
        <p>
          <strong>Los niveles gratuitos tienen condiciones propias.</strong> La key que te
          enseñamos a armar —la de Google, gratuita y sin tarjeta— es el caso que conocemos.
          Según los términos de la API de Gemini, en vigencia desde el {GOOGLE_TERMS_IN_FORCE}
          y que leímos el {GOOGLE_TERMS_READ_ON_TEXT}, en su nivel gratuito:
        </p>
        <Bullets items={GOOGLE_FREE_FACTS.map((fact) => fact.says)} />
        <p>
          Con una key del nivel pago, Google dice otra cosa: {GOOGLE_PAID_FACTS[0].says}{" "}
          {GOOGLE_PAID_FACTS[1].says} {GOOGLE_EUROPE.says} Nosotros no podemos saber de qué
          nivel es tu key —lo sabés vos, que la armaste—, así que te lo decimos antes de que
          la armes, en Ajustes y antes de leer una foto con una key de Google, y podés elegir
          entre la key gratuita, una del nivel pago o seguir sin IA. Son las condiciones de
          Google, no las nuestras, y pueden cambiar: están en{" "}
          <a
            href={GOOGLE_TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-ink"
          >
            ai.google.dev/gemini-api/terms
          </a>
          . De los demás proveedores no decimos nada, porque no leímos sus condiciones: cada
          uno tiene las suyas.
        </p>
        <p>
          <strong>Qué hace nuestro servidor con la key.</strong> La recibe de tu navegador, la
          usa para llamar al proveedor que elegiste, y la descarta apenas termina la llamada:
          no la almacena ni la registra en ningún log (la cláusula 6 tiene el detalle). El
          servidor está en el medio porque es quien arma el pedido y procesa la respuesta, no
          porque retenga nada de ese tránsito.
        </p>
        <p>
          <strong>Qué se envía.</strong> Tu ciudad y tu país, tu titular, tu experiencia
          laboral, tu formación, tus proyectos, tus certificaciones, tus aptitudes, tus
          idiomas, lo que hayas anotado como voluntariado, comunidad, deporte o intereses, y
          los textos libres que hayas escrito, junto con el texto del aviso que pegaste. Si
          completaste los datos prácticos de tu perfil, también van: la disponibilidad
          horaria, el carnet de conducir (la clase, no su vencimiento), si tenés vehículo propio, si podés mudarte por
          trabajo y el permiso de trabajo. Lo que no quieras que llegue al proveedor, no lo
          cargues (cláusula 7). Tu nombre viaja como un token genérico —no el texto real— y
          nuestro servidor lo repone recién en la respuesta que te llega: el proveedor del
          modelo nunca lo ve.
        </p>
        <p>
          <strong>Qué no se envía.</strong> Tu nombre real, tu teléfono, tu correo
          electrónico, tus enlaces y la dirección de tus proyectos personales quedan de este
          lado: no hacían falta para escribir nada, así que no llegan al proveedor. El CV los
          lleva porque se los agrega nuestro servidor después de generarlo, y lo mismo la
          firma del email de presentación. Tampoco se envía tu contraseña ni tu dirección IP. Y no llegan a ningún modelo las
          fechas en que confirmaste cada dato, ni hasta cuándo vale una credencial o tu
          licencia, ni lo que contestaste que no tenés: sirven a tu perfil, no a un modelo.
        </p>
        <p>
          Las excepciones son <strong>importar un CV</strong>, <strong>contarle tu recorrido
          con tus propias palabras</strong>, <strong>separar una respuesta en hechos más
          cortos</strong> y —solo si lo activás, porque es un experimento— que{" "}
          <strong>tu IA elija cuál de nuestras preguntas fijas sigue</strong> según lo que
          contestaste: en los cuatro casos se procesa el texto que escribiste o subiste, al
          mismo proveedor que elegiste para esto. Es inevitable, porque justamente lo que se
          le pide al modelo es que lea ese texto para completar tu perfil o para elegir qué
          preguntarte; en el último caso no escribe nada: elige una de las preguntas de una
          lista nuestra. Todo lo que contás de tu experiencia viaja con él.
        </p>
        <p>
          <strong>Lo que no viaja es quién sos.</strong> Antes de enviarlo, tu navegador
          reemplaza tu nombre, tus correos, tus teléfonos y los enlaces de tus perfiles
          (LinkedIn, GitHub y similares) por marcas como «[NOMBRE_1]» o «[CORREO_1]», sin
          mover ninguna línea: el modelo recibe la marca y no el dato, y cuando su respuesta
          vuelve, tu navegador pone cada dato en el lugar de su marca. Tu nombre y tus datos
          de contacto los lee tu navegador del documento, con sus propias reglas, y no el
          modelo. Tapa lo que reconoce, y no más: el correo y los enlaces de tus perfiles
          donde estén; el teléfono y los demás enlaces donde un documento guarda sus datos de
          contacto (arriba de todo, bajo «Contacto» o «Datos personales», o en una línea que
          abre con un rótulo como «Tel.:»); y tu nombre, completo o con sus palabras en otro
          orden, donde aparezca: el que ya tiene tu perfil y, en un CV, el que abre el
          documento. No reconoce un apodo, un nombre de pila solo, un nombre que ni tu perfil
          ni el comienzo del documento tienen como tuyo, ni un teléfono escrito con
          palabras: si no querés que lleguen al proveedor, no los cargues (cláusula 7).
        </p>
        <p>
          <strong>Salvo los datos personales que el producto no usa.</strong> Antes de
          enviarlo, tu navegador tapa la fecha y el lugar de nacimiento, la edad, el documento
          de identidad, el estado civil, el sexo o género, los hijos, el domicilio y los
          datos de salud que trae una licencia de conducir (el grupo y factor sanguíneo y ser
          donante de órganos) —los que reconoce por su rótulo, como «Fecha de nacimiento:» o
          «DNI:»— y toda la sección de referencias, que tiene datos de otras personas. Eso no sale de tu dispositivo, y
          tampoco queda en la copia del documento que guardamos en tu navegador para que veas
          de dónde salió cada dato. Lo que no lleva rótulo, o está escrito de otra manera, no
          se reconoce: si no querés que llegue al proveedor, no lo cargues (cláusula 7).
        </p>
        <p>
          <strong>Una foto o un escaneo de tu CV es la excepción de la excepción.</strong> Es lo
          único que se lee con IA sin poder tapar nada antes: en una imagen nadie sabe dónde está
          tu documento hasta haberla leído. Por eso se envía entera —con tu nombre, tus datos de
          contacto y también los datos personales que el producto no usa, si salen en ella—, solo
          con tu propia API key y nunca a nuestro proveedor, y la pantalla desde la que la pedís
          te lo dice antes. Tu navegador la achica y la vuelve a codificar antes de enviarla, lo
          que descarta sus metadatos (como el lugar donde se sacó). La imagen no se guarda en
          nuestros servidores: viaja con el pedido al proveedor que elegiste y se descarta con él.
          Lo que el modelo lee vuelve a tu navegador como texto, para que lo compares con tu foto
          antes de leerlo como un perfil, y de ese texto sí se tapan los datos personales antes de
          usarlo y de guardar la copia del documento. Si preferís que tu nombre y tus datos
          de contacto no lleguen al proveedor, copiá el texto de la foto y pegalo: de ese
          texto sí se tapan antes de leerlo con tu IA.
        </p>
        <p>
          Fuera del proveedor que elegís vos, hay cuatro destinatarios más. <strong>Hostinger</strong>,
          en Brasil, aloja el servidor y la base de datos. <strong>Cloudflare</strong>, en Estados
          Unidos, está delante de todo el tráfico del sitio: filtra abusos y termina la conexión
          cifrada antes de que llegue a nuestro servidor. <strong>Resend</strong>, también en
          Estados Unidos, entrega los correos de la cláusula 4. Por ahí pasan tu dirección de
          correo y el texto de cada aviso: en los de verificación, recuperación de contraseña,
          enlaces de acceso, confirmación de borrado y seguridad, un texto fijo; en las alertas de empleo, el
          puesto, la empresa, el link y el porcentaje de compatibilidad de cada aviso; en el
          aviso de postulaciones sin respuesta, el puesto y la empresa de cada una; y en un
          recordatorio de seguimiento, además, la nota que vos escribiste. Tu perfil en sí
          —experiencia, formación, contacto— nunca pasa por ahí.{" "}
          <strong>Bunny.net</strong>, con infraestructura en la Unión Europea, guarda la copia de
          seguridad de la base, una cada 2 horas —cifrada antes de subirse, así que Bunny nunca
          ve tu perfil en claro, solo el archivo cifrado.
        </p>
        <p>
          Brasil y Estados Unidos no integran la lista de países con protección adecuada de la
          Disposición 60-E/2016 de la Agencia de Acceso a la Información Pública, así que estas
          tres transferencias necesitan una base legal además del contrato de alojamiento: la que
          usamos son las <strong>cláusulas contractuales modelo</strong> que esa misma
          disposición habilita entre responsable y encargado (art. 12, Ley 25.326), firmadas con
          cada proveedor —Resend trae la suya, un DPA del artículo 28 del RGPD, ya firmada para
          toda cuenta, sin trámite aparte. No hace falta tu consentimiento individual para esto
          —a diferencia de la transferencia al proveedor de modelos, que es la que describe el
          párrafo de arriba y que elegís vos— porque la base legal ya está puesta del lado
          nuestro.
        </p>
      </Clause>

      <Clause n={6} title="Sobre tu API key, con precisión">
        <p>
          Si configurás una key propia, se guarda únicamente en tu navegador. En cada
          generación viaja a nuestro servidor, porque es el servidor el que hace la llamada al
          proveedor: <strong>no la almacenamos, no la registramos en ningún log y se descarta
          apenas termina la llamada</strong>. Decimos esto con detalle porque «no sale de tu
          máquina» sería más lindo y no sería cierto.
        </p>
      </Clause>

      <Clause n={7} title="Datos sensibles: por favor, no los cargues">
        <p>
          Los campos de texto libre son tuyos y no los revisamos. Justamente por eso conviene
          decirlo: <strong>no cargues datos sensibles</strong> —salud, discapacidad,
          afiliación sindical o política, religión, origen étnico, vida sexual— en tu perfil.
          No hacen falta para armar un CV, la Ley 25.326 les da una protección reforzada, y si
          los escribís van a viajar al proveedor del modelo junto con el resto del texto.
        </p>
        <p>
          <strong>La licencia de conducir y otras credenciales.</strong> Si cargás tu licencia,
          el perfil te pide la clase y, si querés, hasta cuándo vale, para preguntarte dentro
          de la app si la renovaste cuando se acerque la fecha; no te pide el número, ni el
          grupo sanguíneo, ni una foto, porque una licencia trae datos de salud. Si los copiás
          dentro de un texto que leemos con tu IA, tu navegador los tapa por su rótulo antes
          de enviarlo (cláusula 5); si los escribís en un campo libre, sin rótulo, no los
          reconoce. Con el vencimiento de un carnet, una matrícula o un curso pasa lo mismo
          que con el de la licencia: se guarda la fecha para preguntártelo, no llega nunca a un
          modelo, y se sincroniza si sincronizás tu perfil (cláusula 3).
        </p>
        <p>
          Si un aviso te pide algo así, es tu decisión responderlo, y en la mayoría de los
          casos no está obligado a preguntártelo.
        </p>
      </Clause>

      <Clause n={8} title="Tus derechos, y cuánto tardamos">
        <p>
          Tenés derecho a acceder a tus datos, a rectificarlos, a actualizarlos y a pedir su
          supresión. Los plazos son los de la ley y los cumplimos:
        </p>
        <Bullets
          items={[
            "Acceso: dentro de los 10 días corridos de tu pedido (art. 14, Ley 25.326). El acceso es gratuito a intervalos no menores a seis meses.",
            "Rectificación, actualización o supresión: dentro de los 5 días hábiles (art. 16).",
          ]}
        />
        <p>
          La forma más rápida es desde tu cuenta: <strong>Bajar de mi cuenta</strong> te
          descarga en un archivo todo lo que tenemos tuyo —salvo lo que sólo sirve para
          autenticarte: el hash de tu contraseña y los tokens de sesión y de la extensión—, y{" "}
          <strong>Borrar mi cuenta</strong>{" "}
          lo elimina, con una confirmación por correo para que nadie pueda borrar tus datos
          teniendo tu computadora abierta. Si no podés entrar a tu cuenta, escribí a{" "}
          <Pending>{o.email}</Pending>.
        </p>
        <p>
          La <strong>Agencia de Acceso a la Información Pública</strong> es el órgano de
          control de la Ley 25.326, y podés presentarle un reclamo si considerás que no
          atendimos tu pedido como corresponde.
        </p>
        <p className="text-[13px] text-ink-3">
          «El titular de los datos personales tiene la facultad de ejercer el derecho de
          acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses,
          salvo que se acredite un interés legítimo al efecto conforme lo establecido en el
          artículo 14, inciso 3 de la Ley N.º 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN
          PÚBLICA, Órgano de Control de la Ley N.º 25.326, tiene la atribución de atender las
          denuncias y reclamos que se interpongan con relación al incumplimiento de las
          normas sobre protección de datos personales» (leyenda de la Disposición DNPDP
          10/2008).
        </p>
        {o.rnbdNumber ? (
          <p>
            La base está inscripta en el Registro Nacional de Bases de Datos bajo el número{" "}
            {o.rnbdNumber}.
          </p>
        ) : o.rnbdFile ? (
          <p>
            La base está en trámite de inscripción en el Registro Nacional de Bases de Datos,
            expediente {o.rnbdFile}.
          </p>
        ) : (
          <p>
            La base está en trámite de inscripción en el Registro Nacional de Bases de Datos.{" "}
            <Pending>{"[pendiente de carga]"}</Pending>
          </p>
        )}
      </Clause>

      <Clause n={9} title="Cuánto tiempo conservamos las cosas">
        <Bullets
          items={[
            "Perfil y postulaciones sincronizados: mientras tengas la cuenta abierta. Al borrarla se eliminan junto con ella.",
            "Sesiones, con su IP y su navegador: hasta 7 días.",
            "Intentos fallidos de ingreso, con el correo que se tipeó (cláusula 3): hasta 7 días.",
            "Contadores de frecuencia de las pantallas de cuenta y de la API: 2 días, atados a un hash salteado de tu IP — nunca a la IP en sí.",
            "Consumo agregado por día, acción y modelo: 90 días. No identifica a nadie — es un total, sin usuario ni IP.",
            "Contador de uso diario, el que sostiene el tope de intentos: 90 días. Va atado a tu cuenta si estás logueado, o a un hash salteado de tu IP si no — nunca a la IP en sí.",
            "Configuración de alertas de empleo (cláusula 14): mientras esté activada. Se borra si la desactivás o si borrás la cuenta.",
            "Seguimiento de postulaciones (cláusula 16): mientras tengas la cuenta abierta, igual que el perfil. Podés borrar una postulación en cualquier momento desde el propio seguimiento, sin esperar a borrar la cuenta.",
            "Datos de otras personas dentro de tu seguimiento (cláusula 19) —los contactos que cargaste y el remitente y el asunto de los correos que detectó la casilla—: se borran cuando pasó un año desde el último movimiento de esa postulación, o desde que se cargaron si eso es más reciente. La postulación y tu historial no vencen.",
            "Consentimiento al aviso por correo de postulaciones sin respuesta (cláusula 16): mientras esté activado. Se borra si lo desactivás o si borrás la cuenta.",
            "Solicitudes de arrepentimiento o baja, una vez resueltas: 3 años — el plazo de prescripción de las acciones del consumidor (Res. SCI 424/2020), que es cuánto tiempo puede hacer falta probar que se recibieron y se atendieron. Mientras estén pendientes no tienen plazo: se conservan hasta resolverse.",
            "Resultado de cada documento que generás, cifrado con una clave que sólo tiene tu navegador (cláusula 21): un día. Después se borra solo.",
            "Copia de seguridad de la base: una copia cifrada cada 2 horas, guardada en Bunny.net, que se borra automáticamente a los 10 días. Si borrás tu cuenta, tu perfil puede seguir existiendo, cifrado, en copias ya hechas hasta que venza ese plazo.",
            "Los resultados cifrados de la cláusula 21 también quedan en esas copias hasta que venzan, igual de ilegibles sin la clave de tu navegador.",
          ]}
        />
      </Clause>

      <Clause n={10} title="Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas para proteger tus datos, conforme al
          artículo 9 de la Ley 25.326: las conexiones al sitio van cifradas con HTTPS, las contraseñas se
          guardan como hash, el acceso a la base está restringido y hay límites de uso y bloqueo
          por intentos fallidos de acceso.
        </p>
        <p>
          Ningún sistema es infalible. Si ocurriera un incidente que afecte tus datos, te
          avisamos y damos intervención a la Agencia de Acceso a la Información Pública y, por
          el tratamiento que ocurre en Brasil (cláusula 5), también a la Autoridade Nacional de
          Proteção de Dados (ANPD).
        </p>
      </Clause>

      <Clause n={11} title="Cookies">
        <p>
          Usamos una sola cookie, la de sesión, que es la que te mantiene con la sesión
          iniciada. No hay cookies de publicidad ni de seguimiento de terceros, y no hay
          analítica que te siga entre sitios.
        </p>
      </Clause>

      <Clause n={12} title="Menores">
        <p>
          El servicio está pensado para personas de 16 años o más. Si sos madre, padre o tutor
          y creés que un menor a tu cargo cargó datos acá, escribinos a{" "}
          <Pending>{o.email}</Pending> y los eliminamos.
        </p>
        <p>
          <strong>Con IA, puede haber una edad más.</strong> La IA funciona con una key propia,
          y cada proveedor tiene su propia edad mínima. La de Google, que es la key que te
          enseñamos a armar, exige 18 años o más: si tenés 16 o 17, no actives una key de Google.{" "}
          {WITHOUT_AI.works} {WITHOUT_AI.needs} Antes de que armes la key, la pantalla te lo
          dice.
        </p>
      </Clause>

      <Clause n={13} title="Cambios en esta política">
        <p>
          Cada versión de esta política queda identificada por la fecha de vigencia y el número
          de versión que figuran al principio de esta página. Si la cambiamos de manera
          sustantiva, publicamos la versión nueva acá y actualizamos esos dos datos, que son la
          referencia para saber si cambió desde la última vez que la leíste.
        </p>
        <p>
          Dos funciones opcionales dependen de un consentimiento atado a la versión que
          aceptaste: las alertas de empleo (cláusula 14) y el aviso por correo de postulaciones
          sin respuesta (cláusula 16). Cuando la versión cambia, esos dos avisos se pausan hasta
          que vuelvas a aceptar desde la app.
        </p>
      </Clause>

      <Clause n={14} title="Alertas de empleo por correo (opcional)">
        <p>
          Desde <Link href="/empleos" className="underline underline-offset-4 hover:text-ink">
            Empleos
          </Link>{" "}
          podés activar que te avisemos por correo cuando aparezca un aviso que encaje con tu
          perfil. Está <strong>apagado por defecto</strong>, y para activarlo hace falta cuenta
          y perfil sincronizado (cláusula 2): sin eso no hay nada contra qué comparar los
          avisos.
        </p>
        <p>
          <strong>Qué guardamos.</strong> La búsqueda y los filtros que elegiste —palabras
          clave, modalidad, puntaje mínimo— y cuándo te mandamos el último aviso, para no
          repetirte el mismo dos veces.
        </p>
        <p>
          <strong>Cómo se calcula el puntaje.</strong> Con las mismas reglas de comparación de
          palabras que ya corren en tu navegador cuando mirás Empleos —qué tan bien tus
          aptitudes y tu experiencia cubren lo que pide el aviso—, corridas en nuestro servidor
          porque el envío es lo único que hace falta de este lado. No pasa por ningún modelo de
          lenguaje ni sale de nuestra infraestructura: a diferencia de generar un CV (cláusula
          5), acá no hay ningún proveedor externo en el medio.
        </p>
        <p>
          Los correos van por el mismo proveedor de la cláusula 5 (Resend) y bajo el mismo
          presupuesto de envío que protege el resto de nuestros correos. No son publicidad —no
          promocionamos ningún aviso ni cobramos por mostrarlo— y podés apagar la alerta cuando
          quieras desde Empleos, sin tener que borrar la cuenta. Al apagarla, borramos la
          configuración guardada.
        </p>
      </Clause>

      <Clause n={15} title="Afinidad semántica en Empleos (opcional)">
        <p>
          En <Link href="/empleos" className="underline underline-offset-4 hover:text-ink">
            Empleos
          </Link>{" "}
          podés activar «ordenar por afinidad semántica» para que la lista se reordene con un
          criterio más flexible que la coincidencia de palabras —útil cuando un aviso describe
          el mismo puesto con otro vocabulario. Está <strong>apagado por defecto</strong>.
        </p>
        <p>
          <strong>Qué pasa al activarlo.</strong> Tu navegador descarga un modelo (unos 100–130
          MB la primera vez) y lo corre ahí mismo, en segundo plano, para comparar tu perfil con
          los avisos de la página que estás mirando. El cálculo entero pasa en tu equipo: a
          diferencia de generar un CV (cláusula 5) o de las alertas (cláusula 14), acá no le
          mandamos tu perfil a nuestro servidor ni a nadie para este cálculo puntual.
        </p>
        <p>
          <strong>El único destinatario nuevo es la descarga del modelo en sí.</strong> Tu
          navegador se conecta directamente a Hugging Face (huggingface.co y su red de
          distribución) para bajar esos archivos —nosotros no somos parte de esa conexión ni
          vemos qué pediste—, de la misma forma en que ya se conecta a un sitio para cargar una
          fuente o una imagen. Una vez descargado, el navegador lo guarda para no volver a
          bajarlo. Si apagás la opción, dejamos de correrlo y liberamos la memoria que estaba
          usando; no guardamos en nuestros servidores que la activaste.
        </p>
      </Clause>

      <Clause n={16} title="Seguimiento de postulaciones (con cuenta)">
        <p>
          Con cuenta, podés llevar el seguimiento de a qué avisos te postulaste y en qué estado
          está cada proceso —un tablero tipo kanban, en{" "}
          <Link href="/postulaciones" className="underline underline-offset-4 hover:text-ink">
            Postulaciones
          </Link>
          . Sin cuenta, esa pantalla sigue mostrando el historial de siempre, guardado sólo en
          tu navegador: el tablero, la detección de abandono (más abajo) y los recordatorios
          necesitan un servidor que los revise todos los días, y eso pide una cuenta.
        </p>
        <p>
          <strong>Qué guardamos.</strong> El puesto, la empresa, la ubicación, el salario, la
          fuente y el link del aviso, y el texto del aviso tal como lo pegaste o lo capturaste
          —que a veces incluye el nombre o el contacto de quien lo publicó (cláusula 19)—; el
          estado del proceso y un historial de cada cambio de estado (para que las
          estadísticas de conversión sean confiables); las notas y contactos que cargues a
          mano; y, si generaste un CV adaptado para ese aviso, un identificador de qué versión
          de tu CV es. El seguimiento no guarda el documento del CV en sí: ese sigue en tu
          navegador, salvo que sincronices (cláusula 3).
        </p>
        <p>
          <strong>Por qué.</strong> Es la función misma: sin guardar esto en un servidor no hay
          tablero que arrastrar, no hay forma de avisarte que un proceso lleva 21 días sin
          respuesta, y no hay recordatorio de seguimiento posible.
        </p>
        <p>
          <strong>Detección de abandono, con nombre honesto.</strong> Todos los días revisamos
          las postulaciones activas y marcamos como «sin respuesta» a las que llevan más de 21
          días sin novedades. No es una falta tuya ni del proceso: es lo más común. Podés
          revertir esa marca en un click si el proceso sigue vivo.
        </p>
        <p>
          <strong>Aviso por correo, opcional.</strong> Esa detección se ve siempre en tu
          tablero, la actives o no. Lo que es opcional, apagado por defecto y necesita tu
          consentimiento explícito —tildar un casillero, nunca precargado— es que además te
          mandemos un correo avisándote cuando pase, con un máximo de un correo por día. Podés
          activarlo o retirarlo cuando quieras desde tu seguimiento, sin que eso afecte a la
          detección en sí.
        </p>
        <p>
          Podés borrar cualquier postulación del seguimiento cuando quieras, exportar todo a CSV
          o JSON sin límites desde la propia pantalla, o pedir el export completo de tu cuenta
          (cláusula 8), que incluye esto. Borrar la cuenta borra el seguimiento entero con ella.
        </p>
      </Clause>

      <Clause n={17} title="Detección de estados por email (opcional, con consentimiento aparte)">
        <p>
          Desde{" "}
          <Link href="/postulaciones" className="underline underline-offset-4 hover:text-ink">
            Postulaciones
          </Link>{" "}
          podés activar que actualicemos el estado de una postulación solos, cuando el
          reclutador o el sistema de postulación te escriben. <strong>No leemos tu casilla de
          correo</strong> —no usamos ni pedimos acceso a Gmail ni a ningún otro proveedor por
          API—: te damos una dirección propia (algo así como
          «u_7f3a9b@{trackerDomain}») y sos vos quien configura, en tu propio
          proveedor de correo, un filtro que reenvía ahí los mensajes de los sistemas de
          postulación que uses. Está <strong>apagado por defecto</strong>, y activarlo pide un
          consentimiento aparte del resto de esta política —un tildado explícito, no
          precargado, el que exige el art. 5 de la Ley 25.326 para cualquier tratamiento que
          no esté ya autorizado por otra vía— porque activa el reenvío de correspondencia con
          un tercero.
        </p>
        <p>
          <strong>Qué hacemos con lo que llega a esa dirección.</strong> Un programa (no una
          persona, no un modelo de lenguaje) mira el remitente y busca palabras clave en el
          asunto y el cuerpo para adivinar si es una invitación a entrevista, una evaluación,
          una oferta, un rechazo o sólo el acuse de recibo de la postulación. Guardamos el
          remitente, el asunto y ese resultado —nunca el cuerpo del correo—; si hace
          falta mirar el cuerpo para clasificar, se procesa en memoria en el momento y se
          descarta. Cuando la señal es suficientemente clara, actualizamos el estado solos.
          Cuando no, dejamos una nota proponiendo el cambio y esperamos que lo confirmes vos.
          Un correo que parece un resumen de varios avisos en vez de una novedad puntual se
          descarta sin guardar nada. Todo cambio, lo haga el sistema o vos a mano, queda
          identificado como tal en el historial de la postulación.
        </p>
        <p>
          <strong>A dónde va el correo reenviado.</strong> A Cloudflare (EE. UU.), que enruta el
          mensaje a un programa nuestro que corre en su infraestructura —el mismo proveedor que
          ya filtra el tráfico de todo el sitio (cláusula 5)— y de ahí a nuestro servidor en
          Brasil, igual que el resto de tus datos.
        </p>
        <p>
          Podés desactivarlo en cualquier momento desde la misma pantalla: se borra la
          dirección (un correo que siga llegando ahí ya no encuentra a quién avisarle) y todo
          lo que se detectó por este medio, sin tocar el resto del historial de tus
          postulaciones.
        </p>
      </Clause>

      <Clause n={18} title="Extensión de navegador (opcional)">
        <p>
          Hay una extensión opcional para Chrome que guarda el aviso que estás
          mirando en tu <Link href="/postulaciones" className="underline underline-offset-4 hover:text-ink">
            seguimiento
          </Link>{" "}
          con un click, sin copiar y pegar nada a mano. Instalarla es una decisión aparte:
          nada de esta cláusula pasa si no la instalás, y el resto del seguimiento
          (cláusula 16) funciona igual sin ella.
        </p>
        <p>
          <strong>Qué permisos pide.</strong> Tres, y ninguno más: guardar el token de tu
          cuenta en el almacenamiento local de la extensión, acceso a la pestaña activa por
          el instante en que abrís el popup, y leer el HTML de esa pestaña cuando se lo
          pedís. No pide permiso sobre ningún sitio en particular, así que al instalarla no
          aparece el aviso de «puede leer y modificar tus datos en todos los sitios que
          visitás»: técnicamente no puede hacerlo.
        </p>
        <p>
          <strong>Qué lee, y cuándo.</strong> Cada vez que abrís el popup con la sesión
          conectada, le manda a nuestro servidor la URL de la pestaña activa —sólo la URL,
          no el contenido— para avisarte si ese aviso ya está en tu seguimiento. Leer el
          HTML completo de la página pasa únicamente cuando apretás «Capturar este aviso»:
          nunca antes, nunca en segundo plano, nunca en una pestaña distinta de la que
          tenías abierta en ese momento. Si en ese momento tenés texto seleccionado, la
          extensión lo usa sólo para saber cuál de las publicaciones de un listado querés
          guardar —por ejemplo, en el feed de LinkedIn— y captura esa publicación en lugar de
          toda la página; el texto seleccionado no se manda aparte.
        </p>
        <p>
          <strong>Qué hacemos con ese HTML.</strong> Se procesa en el momento para extraer el
          puesto, la empresa y los demás datos del aviso, y se descarta: no queda nada
          guardado hasta que vos elegís «Guardar» o «Ya me postulé», que es cuando recién se
          crea la postulación, con los mismos datos y las mismas reglas de la cláusula 16.
        </p>
        <p>
          <strong>Lo que la extensión nunca hace.</strong> No corre en segundo plano, no deja
          nada instalado en las páginas que visitás ni modifica lo que ves en ellas —para
          capturar, ejecuta un fragmento de código en la pestaña activa por el instante en
          que apretás el botón, que lee la página y termina—, no completa formularios por vos
          y no lee ninguna pestaña que no hayas abierto vos mismo. El token que la conecta a tu
          cuenta se genera desde{" "}
          <Link href="/postulaciones" className="underline underline-offset-4 hover:text-ink">
            Postulaciones
          </Link>{" "}
          y podés revocarlo ahí cuando quieras, lo que desconecta la extensión sin tocar el
          resto de tu cuenta.
        </p>
      </Clause>

      <Clause n={19} title="Datos de otras personas que vos cargás">
        <p>
          El seguimiento de postulaciones (cláusula 16) también puede guardar datos de otras
          personas: el nombre, el correo, el cargo o el link de LinkedIn de un reclutador o
          contacto que cargás a mano, y —si activaste la detección por email (cláusula
          17)— el remitente y el asunto de los correos que te escriben sobre tu propia
          postulación. También el texto del aviso que guardaste (cláusula 16), que a veces
          menciona a quien lo publicó.
        </p>
        <p>
          Esos datos no nos los da la persona que describen: los cargás vos, para llevar tu
          propio seguimiento de un proceso de selección en el que participás. Sos vos quien
          decide qué anotar y para qué lo usás; nuestra parte es guardarlo como el resto de
          tu seguimiento, con las mismas reglas de acceso y de borrado, y no usarlo para nada
          más que mostrártelo a vos.
        </p>
        <p>
          Si sos la persona mencionada —un reclutador, alguien de una empresa a la que se
          postularon— y querés saber qué se guardó sobre vos, corregirlo o pedir que se
          borre, escribí a <Pending>{o.email}</Pending>: lo tratamos con el mismo criterio de
          la cláusula 8, aunque no tengas cuenta acá.
        </p>
        <p>
          Los contactos y el remitente y el asunto de los correos se borran solos cuando pasa
          un año sin movimiento en la postulación (cláusula 9). El texto del aviso se
          conserva con el resto de la postulación, mientras siga en tu cuenta.
        </p>
      </Clause>

      <Clause n={20} title="Dictado por voz (opcional)">
        <p>
          En los campos de texto libre del armado guiado de tu perfil —cuando contás tu
          recorrido con tus propias palabras, o respondés una de las preguntas que lo
          completan— podés ver un botón de micrófono para dictar en lugar de escribir. Sólo
          aparece si tu navegador lo soporta: hoy eso es Chrome y los navegadores basados en
          Chromium; en Firefox, por ejemplo, el botón directamente no está.
        </p>
        <p>
          <strong>No se activa sola.</strong> Mientras no toques el botón, no se captura ni se
          envía nada. Al tocarlo, tu navegador te pide permiso para usar el micrófono —si ya
          lo diste antes, no vuelve a preguntar— y transcribe lo que decís mientras el
          micrófono sigue abierto.
        </p>
        <p>
          <strong>Quién transcribe, y con quién no tenemos relación.</strong> La transcripción
          no la hacemos nosotros ni corre en nuestro servidor: la hace el propio navegador,
          apoyándose en el reconocimiento de voz de su fabricante —Google en Chrome y los
          navegadores basados en Chromium, Apple en Safari—, de la misma forma en que ya usás
          el micrófono de tu teclado para dictar en cualquier otra aplicación. A diferencia
          del proveedor de modelos de la cláusula 5, acá no elegís vos a quién le llega el
          audio: es el que trae tu navegador, y no tenemos ninguna relación contractual con
          él. Vale la misma advertencia que en la cláusula 5: lo que no quieras que llegue
          ahí, no lo dictes.
        </p>
        <p>
          El texto que resulta se escribe en el mismo campo en el que hubieras escrito a
          mano, y sigue exactamente el mismo camino desde ahí: se guarda como algo que vos
          dijiste, se puede editar o borrar como cualquier otro texto, y no pasa por ningún
          paso adicional nuestro.
        </p>
      </Clause>

      <Clause n={21} title="Recuperar un documento que no te llegó">
        <p>
          Cuando generás un CV, las respuestas de un formulario, un email de presentación, la
          preparación de una entrevista o un guion de video, tu navegador le pone a ese pedido
          una clave aleatoria que sólo él conserva. Guardamos el resultado de esa generación —y,
          para un CV, el aviso al que responde—{" "}
          <strong>durante un día</strong>, cifrado con esa clave, para una sola cosa: que si la
          conexión se corta antes de que te llegue, o tu navegador no logra guardarlo, puedas
          recuperarlo sin generarlo de nuevo ni volver a pagarlo, sea con nuestros créditos o con
          la cuota de tu propia key.
        </p>
        <p>
          <strong>Sin tu navegador no se puede leer.</strong> En nuestra base queda el resultado
          cifrado y una huella de la clave, nunca la clave misma, y nada que te identifique: ni tu
          cuenta, ni tu correo, ni tu IP. Sin la clave que conserva tu navegador, ni nosotros ni
          quien acceda a la base o a sus copias de seguridad puede abrirlo. La clave sólo pasa por
          nuestro servidor cuando tu navegador la manda: al generar y al pedir que se recupere.
        </p>
        <p>
          Pasado el día se borra solo, y en las copias de seguridad de la base queda, cifrado de la
          misma forma, hasta que esas copias vencen (cláusula 9). Aplica también si usás tu propia
          key y no tenés cuenta: es la excepción que menciona la cláusula 2, y existe para que un
          documento que ya se generó no se pierda.
        </p>
      </Clause>
    </LegalDoc>
  );
}
