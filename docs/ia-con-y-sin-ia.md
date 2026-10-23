# La IA, con salvaguardas, y lo que se hace sin ella

El producto enseña a armar una key de Google —la del nivel gratuito, en dos minutos y sin tarjeta— y para la mayoría de la gente esa key
es la IA. Los términos de ese nivel dicen tres cosas que nadie que está por pegarla había leído: lo que se le
manda lo usa Google para mejorar sus productos y personas de Google pueden leerlo; Google pide que no se le mande información sensible,
confidencial ni personal; y la API es para mayores de 18 años. Este documento junta lo que se hizo con eso, qué dicen los términos
(con la fecha en que se leyeron), qué manda cada acción con IA y qué se hace sin ella.

## Lo que dice Google

Leído el **7 de octubre de 2026** en <https://ai.google.dev/gemini-api/terms> (en vigencia desde el **23 de marzo de 2026**) y, para el camino
al nivel pago, en <https://ai.google.dev/gemini-api/docs/billing>. Las frases en inglés son las de Google, y `lib/ai/google-terms.ts` las
guarda al lado de lo que la app dice de ellas (`tests/google-terms.test.ts` lo sostiene):

| La app dice | Google dice |
| --- | --- |
| Lo que le mandás, Google lo usa para mejorar sus productos. | «Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies, including Google's enterprise features, products, and services.» |
| Personas de Google pueden leerlo. | «To help with quality and improve our products, human reviewers may read, annotate, and process your API input and output.» |
| Google pide no mandar ahí información sensible, confidencial ni personal. | «Do not submit sensitive, confidential, or personal information to the Unpaid Services.» |
| Para usar su API hay que tener 18 años o más. | «You must be 18 years of age or older to use the APIs.» |
| En el nivel pago: Google dice que no usa lo que mandás para mejorar sus productos. | «Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products.» |
| Y en el nivel pago: Guarda lo que le mandás un tiempo limitado, solo para detectar usos prohibidos. | «Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy.» |
| Si estás en el Espacio Económico Europeo, Suiza o el Reino Unido, Google trata también al nivel gratuito como al pago. | «If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under "How Google uses Your Data" in "Paid Services" apply to all Services, including Google AI Studio and unpaid quota in the Gemini API, even though they are offered free of charge.» |

El nivel gratuito es, en sus palabras, «Any Services that are offered free of charge like direct interactions with Google AI Studio or unpaid
quota in Gemini API». Los términos dicen también que Google AI Studio y la API son «for developers building with Google AI models for
professional or business purposes, not for consumer use». **La app no lo dice a quien arma una key, y esto no lo resuelve**: si encaja con
una persona que usa su propia key en una aplicación de terceros es una pregunta legal sin contestar, que es de la asesoría y no
de un aviso.

**El camino al nivel pago**, según la documentación de Google: en la página de las keys de Google AI Studio, en el proyecto gratuito, «Set up
billing» bajo la columna del nivel; elegir o crear una cuenta de facturación; cargar un medio de pago (pide una tarjeta); y pagar por uso
o por adelantado. No se escribe cuánto cuesta: cambia.

**Volver a comprobarlo**: cuando Google cambie los términos (o cada tanto), abrir la página, comparar cada frase de la tabla de arriba, y
si alguna cambió, corregir `GOOGLE_FREE_FACTS`, `GOOGLE_PAID_FACTS` y `GOOGLE_EUROPE` en `lib/ai/google-terms.ts` junto con
`GOOGLE_TERMS_IN_FORCE` y `GOOGLE_TERMS_READ_ON`. Lo que dice una pantalla es lo que dice Google, y no una opinión sobre la ley.

## Lo que hace el producto

1. **Antes de que exista la key** (`ByokSetup`, `components/ai/GoogleNotice.tsx`): lo de arriba, en pocas líneas y con el enlace a los términos, y
   tres caminos del mismo peso —«Sigo con la key gratuita», «Uso una key del nivel pago», «Sigo sin IA»—. Hasta elegir uno no hay pasos ni
   campo donde pegar nada. Otro proveedor se elige en Ajustes, con sus propias condiciones. Se ve donde se arma la key: en Ajustes, en el aviso
   de «hace falta una key» y en las acciones con IA que la piden. Se lee en este orden: primero lo que Google pide —18 años, nada
   personal—, después lo que hace con lo que se manda, las cuatro frases de la tabla de arriba tal como están, y lo demás plegado en
   «Qué mandamos y qué no» (lo que tapa el navegador y lo que viaja, lo de Europa, desde cuándo valen los términos). Lo que lleva a este
   aviso dice que Google tiene condiciones y no que la key es gratis.
   **«Sigo sin IA» se recuerda**, en este navegador y nada más (`lib/storage/ai-choice.ts`: el día en que se dijo, sin ninguna key): la
   key no se vuelve a ofrecer al cierre de cada sesión —queda una línea con «Bajar mi CV base» y «Armar una key»—, y elegir una forma de
   tener IA le quita lo anotado.
2. **Si ya hay una key de Google** (en Ajustes, en la fila del proveedor): el mismo aviso, que dice qué cambia con el nivel pago. La app no
   puede saber de qué nivel es una key: lo sabe quien la armó. Con el armado en la página, o con la key ya puesta en la fila, es un renglón
   que se abre —«Ver las condiciones»— y no una segunda caja de lo mismo; para quien va a pegar una key sin haber pasado por el
   armado, está entero.
3. **Antes de leer una foto con una key de Google**: una foto de un CV va entera, con todo lo que se ve, y no se puede tapar antes
   (`GooglePhotoNotice`); y el camino de siempre —copiar el texto de la foto y pegarlo— se dice ahí mismo.
4. **Al leer con IA, tapar quién es la persona** (`lib/parse/mask-contact.ts`, usado por `extractWithAi`, `splitWithAi`, `improveWithAi` y
   `chooseFollowUpWithAi`): antes de enviar un texto, el navegador reemplaza el nombre, los correos, los teléfonos y los enlaces por marcas
   —`[NOMBRE_1]`, `[CORREO_1]`, `[TELEFONO_1]`, `[ENLACE_1]`—, línea por línea y sin mover ninguna, como ya se hacía con los datos personales
   que el producto no usa (`redactPersonalData`). Lo que la IA contesta se vuelve a poner en su lugar **antes** de comprobar nada: una cita
   con una marca se busca en el texto como lo escribió la persona, y un dato que nombra una dirección vuelve con su dirección. El contacto de
   una importación se lee por patrones del texto original (`knownContact`) y **nunca de la IA**: ni lo recibió.
   - El correo se tapa donde esté. El teléfono, solo donde un documento guarda sus datos de contacto (arriba del primer título, bajo
     «Contacto» o «Datos personales», o en una línea con rótulo como «Tel.:»), porque en cualquier otro lugar una tira de dígitos es una fecha o
     una cifra; y no en una línea larga. Un enlace, ahí mismo; en el resto del documento, solo los perfiles de sitios donde la gente guarda uno
     (LinkedIn, GitHub, Behance…): la dirección de lo que alguien hizo es parte de lo que hizo. El nombre, donde esté escrito: completo, o en
     cualquier orden («PÉREZ, Lucía»), con el que tiene el perfil y con el que abre el documento; un nombre de pila solo no se tapa, porque puede ser
     una palabra, un lugar o una empresa.
   - **No promete más de lo que reconoce.** Un apodo, un nombre escrito una sola vez en una frase, un teléfono dicho con palabras: no se tapan. Y
     lo que se cuenta de la experiencia viaja: es lo que se lee.
5. **Todo el perfil funciona sin IA** (abajo, acción por acción).

## Cada acción con IA, y su camino sin ella

«Sin IA» quiere decir: sin ninguna key, sin un modelo. Nada del perfil depende de la IA. Lo que sí la necesita es adaptar un CV a un
aviso y lo que se arma sobre eso. `tests/ai-actions-doc.test.ts` exige que cada ruta de `app/api/generate/` esté en esta tabla con su camino:
una acción nueva con IA no se agrega sin decir qué se hace cuando no hay.

| Acción | Dónde | Ruta | Qué se manda | Sin IA |
| --- | --- | --- | --- | --- |
| Leer un CV con tu IA, «Mejorar la lectura» | Al cargar un CV, y en la revisión | `/api/generate/import` (`cv`) | El texto del documento, sin los datos personales que no usamos (fecha de nacimiento, documento, estado civil, referencias…) y sin tu nombre, tus correos, tus teléfonos y tus enlaces de perfil. | La lectura por patrones del mismo documento, que se hace primero y siempre: se revisa y se corrige en los formularios, con el documento al lado («Cargarlo yo, con el documento al lado»). |
| Contar tu trayectoria con tus palabras | Al empezar el perfil | `/api/generate/import` (`dump`) | Lo que escribiste, con el mismo tapado. | «Seguir con formularios»: el texto queda como nota y se completa con las preguntas. |
| Separar una respuesta en datos más cortos | En las preguntas y en el perfil | `/api/generate/split` | La respuesta, con el mismo tapado. | Un dato por oración, sin modelo (`lib/onboarding/split.ts`). |
| Mejorar los textos del perfil | En el perfil: un botón arriba de «Experiencia laboral», «Formación», «Habilidades, idiomas y certificaciones», «Proyectos» y «Sobre vos y otros datos» —junta en una sola llamada todo lo que se puede mejorar de esa sección—, y uno en cada tarea de un puesto y en la descripción de cada proyecto | `/api/generate/improve` | Los textos que se mejoran —las tareas, las descripciones de proyectos, el título, las menciones y los destacados de cada estudio, el nombre de cada habilidad, idioma y certificación, el titular, «Sobre vos» y «Otros datos»—, con el mismo tapado que la lectura: no van tu nombre, tus correos ni tus teléfonos, ni los datos personales que no usamos. No van los nombres de empresas, escuelas, emisores ni proyectos. Lo que vuelve es una propuesta: se revisa antes de mostrarla —si trae una cifra que no escribiste, no se usa— y no cambia nada hasta que elegís «Usar». | Escribirlos a mano en los mismos cuadros: el perfil funciona entero sin IA. |
| Que tu IA elija qué pregunta sigue (experimento, apagado) | En las preguntas | `/api/generate/followup` | Lo que acabás de contestar, con el mismo tapado, y la lista de nuestras preguntas fijas. | El motor de reglas elige la que sigue, como siempre. |
| Leer una foto de un CV | Al cargar un CV que es una foto o un escaneo | `/api/generate/transcribe` | La foto entera, con todo lo que se ve: no se puede tapar. Solo con tu propia key. | Copiar el texto de la foto y pegarlo («Pegar el texto»), o cargar el CV a mano. |
| Generar un CV para un aviso | `/postular` | `/api/generate/cv` | Tu ciudad, tu experiencia, tu formación y el texto del aviso. Tu nombre va como un token que el servidor repone; tu teléfono, tu correo y tus enlaces no viajan. | El CV base, «Tu CV, con tus palabras, sin adaptar»: Word y PDF desde el perfil, sin IA, sin cuenta y sin aviso. No hay adaptación a un aviso sin IA. |
| Respuestas para el formulario de la oferta | `/postular`, «Preguntas del formulario» | `/api/generate/answers` | Lo mismo que el CV, y las preguntas del formulario. | No hay: se escriben a mano. |
| Email de presentación | `/postular`, «Email de presentación» | `/api/generate/email` | Lo mismo que el CV, y lo que pediste del tono y el largo. | No hay: se escribe a mano. |
| Preparar la entrevista | `/postular`, «Preparar la entrevista» | `/api/generate/interview` | Lo mismo que el CV, y lo que sepas de la entrevista. | No hay: se prepara a mano. |
| Guion del video de presentación | `/postular`, «Video de presentación» | `/api/generate/video` | Lo mismo que el CV, y la duración y el tema que pediste. | No hay: se escribe a mano. |
| Recuperar un resultado que ya se pidió | Al volver a una postulación | `/api/generate/result` | Nada nuevo: el identificador de un pedido anterior. | No hace falta: no es una acción, es el regreso de una. |
| Acortar las líneas de un CV para que entre en una hoja | En `/postular`, cuando el CV se desborda | `/api/generate/condense` | Las líneas del CV que hay que acortar, tal como quedaron en el documento, con el tope de caracteres de cada una —nunca la única evidencia de un requisito excluyente— y con el mismo tapado que la lectura: no van tu nombre, tus correos ni tus teléfonos. Solo con tu propia key. | El ajuste determinista: se mide la página y se quitan las líneas de menor peso para ese aviso, con recibo y «Deshacer» (`lib/cv/fit.ts`). |

## Menores de 18

El primer empleo puede incluir a personas de 16 y 17 años, y la API de Google exige 18. La app no pregunta la edad (y un dato nuevo
es una versión de la política). Lo que hace es decirlo antes de que exista la key —«Si todavía no los tenés, no actives esta
key: tu perfil y tu CV base funcionan sin IA»— y tener el camino sin IA completo para el perfil, que es lo que un primer empleo necesita.

## Lo que la política dice, desde la etapa 6

La política (`app/legales/privacidad/page.tsx`, versión `2026-10-07`) y `lib/legal/data-flow.ts` dicen lo de este documento, y
`tests/legal-data-flow.test.ts` lo sostiene frase por frase. Qué entró en esa versión y qué espera para la próxima:
`docs/legal/versiones.md`.

- **Cláusula 5**: leer un CV, un relato o una respuesta con tu IA ya no manda tu nombre, tus correos, tus teléfonos ni los enlaces de tu
  perfil, que el navegador tapa antes de enviar con lo que reconoce y no más; lo que se cuenta de la experiencia sí viaja; la foto, entera,
  y la pantalla lo avisa. Las condiciones del nivel gratuito de Google, con la fecha en que se leyeron, salen de `lib/ai/google-terms.ts`: son
  las mismas frases que las pantallas, no una copia, y la política dice que la persona es quien sabe de qué nivel es su key. De los demás
  proveedores no afirma nada.
- **Cláusula 7**: la licencia guarda la clase y el vencimiento y no el número ni la foto; el grupo y factor sanguíneo y ser donante se tapan por
  su rótulo antes de leer.
- **Cláusula 12**: la API de Gemini exige 18 años, el servicio es desde los 16, y el perfil funciona entero sin IA.
- `READ`, `readFooter` y `TO_AN_UNVERIFIED_PROVIDER` (`lib/legal/data-flow.ts`), que repiten las pantallas, dicen lo mismo que la cláusula 5.

Lo que **no** dice, porque no se sabe: si la cláusula de Google sobre «uso profesional, no de consumo» alcanza a quien usa su propia key,
ni si alcanza con avisar de la edad sin guardarla. Las dos son de la asesoría legal (`docs/estudios-perfil-especificacion.md`).
