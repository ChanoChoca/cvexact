# Versiones de los textos legales

**Versión vigente: `2026-10-07`** · vigente desde el 7 de octubre de 2026.

La versión (`LEGAL_VERSION`, en `lib/legal/operator.ts`) y la fecha desde la que vale (`LEGAL_EFFECTIVE_DATE`) se muestran al
principio de la política de privacidad y de los términos. Este documento dice qué entró en cada versión, con qué regla se sube una y
qué espera para la próxima. `tests/legal-versions.test.ts` lo mantiene de acuerdo con el código.

## La regla: un lote por versión

Cada subida de `LEGAL_VERSION` vuelve a pedir tres consentimientos, porque se comparan con ella (`lib/legal/consent.ts`):

| Consentimiento | `kind` | Qué queda en pausa hasta que se vuelva a aceptar |
| --- | --- | --- |
| La transferencia al proveedor de los planes pagos | `transfer` | La generación en un plan pago (con la venta apagada, no corre nada) |
| Las alertas de empleo por correo (cláusula 14) | `job_alerts` | Los correos de alertas |
| El aviso por correo de postulaciones sin respuesta (cláusula 16) | `tracker_mail` | Ese correo |

Otros dos consentimientos guardan la versión pero no se comparan con ella, así que una subida no los pausa: `terms`, que se
registra al crear la cuenta, y `tracker_mail_inbox`, que se registra al activar la detección por email.

Pedir los consentimientos cada pocas semanas entrena a aceptar sin leer, que es lo opuesto al consentimiento informado del art. 5 de
la Ley 25.326 («fatiga de consentimiento»). Por eso:

1. **Un cambio que pide versión espera al lote.** Se junta con los demás y se sube una vez. Pide versión lo sustantivo: un dato que la
   política no menciona (aunque no salga del navegador: es la lectura prudente de la regla), un destino nuevo, un uso nuevo de IA, o
   una frase que el código ya contradice. Una coma, un enlace o una redacción que no cambia lo que se hace con los datos, no.
2. **Lo que está apagado no entra.** Decir en la política algo que el producto no hace es información incorrecta sobre el tratamiento,
   que es lo que el art. 6 obliga a dar bien. Lo apagado espera en el registro de experimentos, y entra en la versión en que se prenda.
3. **La política se escribe contra el código.** Cada frase sobre qué se envía, qué se guarda o qué sube está sostenida por un test
   (`tests/legal-data-flow.test.ts`), y lo que dicen las pantallas sale de `lib/legal/data-flow.ts` y de `lib/ai/google-terms.ts`: un
   cambio en el código que contradiga el texto es un test que falla. **Dos archivos alimentan la política, y cambiarlos pide lo mismo que
   cambiarla**: `lib/ai/google-terms.ts` (las frases de Google que la cláusula 5 muestra: cuando Google cambie sus términos y se corrijan ahí,
   cambia la política, y eso puede pedir versión) y `lib/legal/data-flow.ts` (lo que viaja).

## Cómo se sube

1. `lib/legal/operator.ts`: `LEGAL_VERSION` y `LEGAL_EFFECTIVE_DATE`, con la fecha del despliegue. Si se despliega otro día que el de la
   pasada, se cambian las dos y nada más (el test las compara entre sí y con esta tabla).
2. `app/legales/privacidad/page.tsx` —y `app/legales/terminos/page.tsx`, si cambian—: el texto, y una entrada «Pasada del …» en el comentario de
   cabecera que termina con «`LEGAL_VERSION` sube a `…` en la misma pasada».
3. `lib/legal/data-flow.ts` y los avisos que repiten lo que viaja (`TransferConsent`, el pie de `AiAction`, las notas de los proveedores).
4. La tabla de abajo.
5. Los tests (`tests/legal-data-flow.test.ts`, `tests/legal-versions.test.ts`) y el recorrido de navegador `e2e-m8` (M60), que mira la
   versión y la fecha que muestra la página.
6. Al desplegar: las alertas de empleo y el aviso de postulaciones sin respuesta quedan en pausa hasta que cada persona vuelva a aceptar
   desde la app (cláusula 13).

## Qué entró en cada versión

Las siete primeras pasadas de la política son anteriores a la numeración por fecha; están en el comentario de cabecera de
`app/legales/privacidad/page.tsx` y en el historial de git.

| Versión | Qué entró |
| --- | --- |
| `2026-09-18` | La auditoría legal previa a la publicación: lo que el código ya contradecía. Cláusulas 3 (el documento del CV al sincronizar, el texto del aviso, el correo de un ingreso fallido), 5 (qué ve Resend, qué se envía al modelo, el backup cada 2 horas), 8 (el export no trae credenciales), 9 (plazos de los datos de terceros, de los intentos de ingreso y de los contadores), 10 (HTTPS en lugar de «punta a punta») y 16 a 19. |
| `2026-09-19` | La cuarta auditoría legal: el domicilio del responsable (cl. 1) y lo que de verdad pasa al cambiar la política, en lugar de un aviso por correo que no existía (cl. 13). |
| `2026-09-19.2` | Empleos ordena por el país del visitante, que el servidor toma de Cloudflare y no guarda (cl. 3). |
| `2026-09-22` | El ingreso por enlace de correo (cl. 3, 4 y 5) y, en la cláusula 5, que contar el recorrido y separar una respuesta son parte de la excepción de leer. |
| `2026-09-23` | El dictado por voz (cl. 20). |
| `2026-09-28` | El resultado de cada generación se guarda un día, cifrado con una clave que solo tiene el navegador (cl. 21, 2 y 9). |
| `2026-10-04` | Qué se tapa antes de leer con IA (los datos personales que el producto no usa), la foto o el escaneo del CV que va entera, el experimento de la repregunta elegida por la IA, y «Mantener sincronizado» (cl. 2 y 5); la variante de lectura del consentimiento a la transferencia. |
| `2026-10-07` | El perfil en el tiempo, etapas 1 a 5 del plan del perfil, en un solo lote. **Cl. 2**: el navegador puede borrar el perfil, y qué hace la app para cuidarlo (instalar, persistencia, una copia que puede llevar contraseña). **Cl. 3**: todo lo que el perfil lleva con cada dato y sube al sincronizar (de dónde salió, la fecha en que se agregó y la de la última confirmación, los vencimientos, lo que se contestó que no se tiene, lo práctico, las notas, el paso del armado) y lo que no sube. **Cl. 5**: leer con IA ya no manda el nombre, el correo, el teléfono ni los enlaces de perfil, que el navegador reemplaza por marcas y repone en la respuesta; el grupo y factor sanguíneo y ser donante se tapan por su rótulo; las condiciones del nivel gratuito de Google, con la fecha en que se leyeron; y que las fechas, los vencimientos y los «no» no llegan a ningún modelo. **Cl. 7**: la licencia guarda la clase y, si la persona quiere, el vencimiento; no el número ni la foto. **Cl. 12**: la API de Gemini exige 18 años y el servicio es desde los 16; lo que funciona sin IA. |

Las preguntas abiertas de asesoría legal y la cola de lo que está construido y apagado se llevan en un registro privado del operador; este documento sólo publica lo que ya entró en una versión.
