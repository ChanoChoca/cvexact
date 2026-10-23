# Dónde vive el perfil, y cuánto dura

El perfil vive en el navegador de la persona (`localStorage`) y las postulaciones en IndexedDB. No hay otra copia salvo que
la persona baje un archivo o lo suba a su cuenta. Este documento junta lo que se sabe de cuándo un navegador borra esos datos,
qué hace la app en cada caso y cómo se mediría cuántos perfiles se pierden de verdad.

## Qué hace cada navegador

| Navegador | Qué puede borrar el perfil | Qué ayuda | Fuente |
| --- | --- | --- | --- |
| Safari en una pestaña (iPhone, iPad o Mac) | Todo lo que el sitio guarda por script (IndexedDB, `localStorage`, caché del service worker) después de **siete días de uso de Safari sin interacción con el sitio**. | Agregarlo a la pantalla de inicio (iPhone, iPad) o al Dock (Mac, Safari 17) y una copia fuera del navegador. | [WebKit, «Full Third-Party Cookie Blocking and More» (2020)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/): el post trata la protección contra el rastreo «en iOS y iPadOS 13.4 y Safari 13.1 en macOS» |
| App de la pantalla de inicio de un iPhone o un iPad (Safari) | No es parte de Safari: cuenta sus propios días de uso. WebKit dice que no espera que esas apps pierdan sus datos. | Además, pedir persistencia: Safari 17 la concede según heurísticas, por ejemplo si el sitio se abre como app de la pantalla de inicio. | Mismo post; [WebKit, «Updates to Storage Policy» (2023)](https://webkit.org/blog/14403/updates-to-storage-policy/) |
| App del Dock de una Mac (Safari 17) | **No se sabe.** WebKit explica cómo se agrega (Archivo → Agregar al Dock) y que Safari le copia las cookies y no comparte más datos del sitio, y no dice nada de cuándo se borran sus datos. El post de los siete días es de 2020, anterior a estas apps. | Pedir persistencia, y una copia fuera del navegador. | [WebKit, «WebKit Features in Safari 17.0» (2023)](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/), sección «Web Apps on Mac» |
| Chrome, Edge, Brave, Samsung Internet; Firefox | Los datos del sitio son «best-effort»: el navegador puede borrarlos sin avisar si al equipo le falta espacio. | `navigator.storage.persist()` (Chrome decide solo, por cuánto se usa el sitio o si está instalado; Firefox le pregunta a la persona). Instalar la app también pesa. | MDN, «Storage quotas and eviction criteria» |
| Otro navegador en iOS (Chrome, Firefox, la ventana de una app), instalado o no | Usa WebKit pero no es Safari: el post de WebKit habla solo de Safari. No sabemos si aplica el límite de siete días. | Una copia fuera del navegador. | — |

Tres matices que importan para el texto de la app:

- En Safari en una pestaña **no se ofrece el botón de persistencia**: Safari 17 lo concede sobre todo a las apps de la pantalla de
  inicio, hay un error abierto que lo reporta siempre negado ([WebKit Bugzilla 271401](https://bugs.webkit.org/show_bug.cgi?id=271401),
  2024) y, de todos modos, la persistencia protege de la falta de espacio, no de los siete días. Lo que se ofrece es instalarla.
- La frase «según el equipo de Safari, así no debería perder lo que guardaste» es de WebKit sobre la **pantalla de inicio de un
  iPhone o un iPad** y se dice solo ahí, como suya. Para el Dock de la Mac la app dice que Safari no dice cuándo borra, y que la copia
  en un archivo sigue siendo lo seguro; para otro navegador en iOS, que puede ayudar y no es una garantía.
- La copia en un archivo es lo único que no depende del navegador, y es lo que la app siempre ofrece.

## Qué hace la app

Todo está en `lib/storage/durability.ts` (puro, con tests en `tests/durability.test.ts`) y se lee del navegador con
`useBrowserSetting` (`lib/pwa/install.ts`).

- **«Mis datos»** (2026-10-19; `components/storage/DataCard.tsx`, la última tarjeta de `/cuenta`, ancla `#datos`): solo los botones «Descargar perfil» (la copia completa), «Introducir perfil» (leer
  una copia, abierta o con contraseña) y «Borrar los datos de este navegador», con una casilla «Con contraseña» para la copia que se baja y la que se toma antes de borrar. Reemplazó a «Tu perfil a
  salvo» (dónde vive el perfil, qué lo puede borrar, la fecha de la última copia y la línea de la cuenta), «Espacio en este navegador» y «Tu actividad en este navegador». `offersFor`, `RISK_TEXT` y
  `lastCopyLine` quedan en `lib/storage/durability.ts`, con sus tests, sin una pantalla que los muestre.
- **Lo que ayuda a que el navegador no borre, sin pantalla** (2026-10-19). «Pedirle al navegador que no lo borre» se pide solo, al terminar un CV (`keepDataQuietly`, `lib/storage/usage.ts`: hasta tres veces
  por navegador, y en Firefox cada una es un permiso que el navegador muestra) y «Agregar a la pantalla de inicio» se ofrece una sola vez, al tocar «Descargar» un CV (`offerInstallOnce`, `lib/pwa/install.ts`):
  el diálogo de instalación es del navegador y exige un toque que acaba de pasar. En iPhone y en Safari de Mac no hay API para ninguna de las dos instalaciones: ya no se dice nada.
- **Sin lugar** (2026-10-19). `SpaceWarning` avisa antes de llenar (80 % del espacio chico, 90 % del total) y, cuando el navegador rechazó una escritura, en el momento (`STORAGE_FULL_EVENT`, que emite
  `StorageWriteError`); trae «Liberar espacio» (`FreeSpaceButton`, `freeSpace` en `lib/storage/local.ts`): baja antes la copia completa y borra las postulaciones guardadas, los borradores, los caches de la IA
  y la actividad, y deja el perfil, los documentos de los que se leyó, las keys y el estado de la cuenta. Generar un CV no depende del espacio: lo que no entra es guardarlo, y queda en pantalla con su aviso.
- **El perfil ya no pide la copia por su cuenta** (2026-10-19). La tarea «Guardá una copia de tu perfil» —que decía el riesgo de este navegador (`COPY_REASON`) y, en una pestaña
  de Safari, volvía a pedir una copia a los **7 días** con cambios, no a los 30 (`copyWindowDays`)— salió de «Para hacer», y con ella los avisos de la cuenta («Subir», «Juntar los dos»,
  «Se pausó la sincronización»). La copia se baja desde los botones del perfil y desde «Mis datos», en `/cuenta`; al pie del perfil queda la fecha de la última (`copyFooter`).
- **Recuperar** (`components/onboarding/useRecoverHere.ts`): quien perdió el perfil aterriza en `/perfil/empezar`, donde antes no
  había forma de volver a cargar una copia (los botones del perfil no se ven con el perfil vacío). La zona de carga acepta el `.json` de una copia
  —del perfil o completa, abierta o con contraseña—: un solo `.json` se recupera, no se lee como un CV (`isCopyFile` en `lib/import/formats.ts`),
  con un aviso en el perfil de lo que se trajo y, si el archivo no era una copia, dicho bajo la zona. La línea «¿Ya tenías un perfil acá? Recuperalo con tu copia o
  entrá a tu cuenta» salió de la entrada con la nueva carga del perfil, que quedó con la zona, «Crear perfil vacío» y tres sellos: quien tiene cuenta entra por
  «Iniciar sesión», en el menú «Cuenta» de la barra, y la oferta de traer el perfil de su cuenta (`AccountOffer`) sigue arriba de la zona de carga.
- **Después de bajar una copia** (`useCopyActions`, `copySavedLines`): tres renglones desde cualquier pantalla que ofrezca una copia —dónde quedó según el sistema
  («Archivos › Descargas» en un iPhone, «Descargas» en Android y en una computadora), que se guarde también fuera de este celular o computadora, y cómo se recupera— durante 20 segundos;
  y, en un celular que sabe compartir un archivo, «Compartir la copia» (`lib/storage/share-copy.ts`): la hoja de compartir es del sistema y de la persona, y cvexact no manda el archivo a ningún lado.
- **Copia con contraseña** (`lib/storage/locked-copy.ts`, `lib/storage/copy-file.ts`, `components/storage/CopyPassword.tsx`), para
  una computadora que usa más de una persona: PBKDF2-SHA-256 (600.000 vueltas) y AES-GCM del propio navegador. «Bajar una
  copia con contraseña» en los botones del perfil, la casilla «Con contraseña» de «Mis datos», y las casillas de «Borrar los datos de este navegador» y de «Cerrar y borrar datos», que bajan la copia
  completa con contraseña antes de borrar (`useWipeWithCopy`). Sin la contraseña no hay forma de abrirla, tampoco nosotros, y la app lo dice antes.
- **La cuenta cuenta como copia**. Con una cuenta confirmada, la tarjeta no dice «todavía no hay ninguna copia» sobre «tu cuenta tiene tu perfil al día»
  (`useAccountSync`, `lastCopyLine` con `accountHasIt`). Mientras se lee la sesión, un navegador que ya conoció una cuenta no dice «vive solo en este navegador».
- **«Ahora no» no dura más que el riesgo** vivía en las tareas de la copia y de la cuenta del perfil, que salieron (2026-10-19): `snoozeDays`, `snoozeProfileBackup` y
  `snoozeSyncNotice` quedan sin una pantalla que los use. La copia se volvía a mostrar a las dos semanas, y a la semana en una pestaña de Safari, que borra a los siete días.
- **Recuperar una copia es una sola lectura**: `lib/storage/recover-copy.ts` toma un perfil, una copia completa o un archivo de postulaciones, abierta o con contraseña, dice qué
  reemplaza por qué y baja antes lo que se va. La usan la entrada y el perfil («Recuperar una copia») y «Mis datos» («Introducir perfil»).
- **Medición local:** `profile_recovered` (un perfil traído de un archivo o de la cuenta a un navegador donde no había) y
  `persistence_granted` (el navegador aceptó conservar los datos), en `lib/metrics/counters.ts`. Se escriben en el navegador y no salen de ahí (desde 2026-10-19 ninguna pantalla los muestra).

## Cuánto dura un perfil, medido

Lo que no sabemos: cuántos perfiles se pierden por el borrado del navegador, y si las mitigaciones funcionan. Se contesta sin
datos de usuarios, con perfiles de prueba.

**Equipos y modos** (uno por fila):

| | Navegador | Modo |
| --- | --- | --- |
| 1 | Safari en iPhone | Pestaña |
| 2 | Safari en iPhone | Agregada a la pantalla de inicio |
| 3 | Safari en Mac | Pestaña |
| 4 | Safari en Mac | Agregada al Dock |
| 5 | Chrome en Android | Pestaña |
| 6 | Chrome en Android | Instalada |
| 7 | Chrome en iPhone | Pestaña |

**Procedimiento:**

1. Cargar en cada uno el mismo perfil de prueba (un CV de ejemplo de `tests/fixtures/cv-samples.ts`) y anotar en «Tu perfil
   a salvo» qué dice la tarjeta y si el navegador aceptó conservar los datos.
2. Seguir usando el navegador normalmente, **sin entrar a cvexact**, y abrirlo a los **8, 30 y 90 días**.
3. En cada visita anotar: si el perfil sigue, si la app redirige a `/perfil/empezar` (perfil perdido) y qué dice «Tu perfil
   a salvo» (la tarea de la copia ya no está en el perfil).
4. Si se perdió, recuperar la copia con «Recuperar una copia» y anotar si el contador `profile_recovered` sube.

**Qué se espera** (para comparar): la fila 1 y la 3 pierden el perfil a los 8 días; la 2 no; la 4 **es justo lo que no se sabe**
(la que más interesa); la 5 y la 6 no, salvo con el equipo lleno; la 7 no se sabe. Si la fila 2 lo pierde, el texto «según el
equipo de Safari, así no debería perder lo que guardaste» se cambia ese mismo día; si la 4 no lo pierde, el Dock pasa a decir lo
mismo que la pantalla de inicio (`riskOf`: `dock` → `own_counter`) y el recordatorio sigue en el mes.

**Costo en privacidad:** ninguno; son perfiles de prueba en equipos del equipo.
