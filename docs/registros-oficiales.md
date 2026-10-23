# Los registros oficiales

Los atajos de registros oficiales abren, en otra pestaña, el buscador oficial donde una persona puede buscarse a sí misma: el de los
títulos universitarios, el de los profesionales de la salud y la lista de instaladores matriculados de cada distribuidora de gas. La persona
mira, vuelve y cuenta qué vio; eso, con el día, es lo que se guarda (un respaldo de tipo `registry`, `lib/profile/evidence.ts`). Está construido
y apagado: el interruptor es `official_registries` (el registro de experimentos).

## Lo que hace la app y lo que no

- **Abre la página del registro y nada más.** La dirección no lleva nada del perfil ni nada nuestro (ni nombre, ni documento, ni matrícula), el
  vínculo se abre con `target="_blank"` y `rel="noopener noreferrer"` —el registro no sabe de qué página viene la persona— y no hay ningún pedido
  desde la app al registro: `tests/registries.test.ts` y `tests/evidence-ui.test.ts` lo fijan.
- **No comprueba nada.** No lee la ficha, no compara lo que la persona escribió con lo que dice el registro y no marca un «no figura» como un
  desacuerdo: que alguien no aparezca en un registro dice poco (los registros se alimentan de lo que informa cada jurisdicción o cada
  distribuidora, y el de graduados empieza en 2012). Lo que se guarda es lo que la persona dice que vio.
- **No pide nada para ver una persona.** Cada registro es público y sin usuario; si alguno pide ingresar, no va.

## Las direcciones, y el día que se leyeron

Leídas el **2026-10-07** (campo `verifiedOn` de cada una en `lib/evidence/registries.ts`), abriendo cada página y mirando que tuviera el buscador
público y dijera lo que `covers` dice:

| Registro | Dirección | Qué se hace ahí | Qué cubre |
| --- | --- | --- | --- |
| Registro Público de Graduados Universitarios | https://registrograduados.siu.edu.ar/ | Buscar por tipo y número de documento, o por apellido y nombre | Diplomas intervenidos desde 2012 y títulos extranjeros convalidados desde 2010 (lo dice la página) |
| REFEPS (SISA, Ministerio de Salud) | https://sisa.msal.gov.ar/ | «Buscador de Establecimientos y profesionales» → pestaña REFEPS → buscar por documento, matrícula o apellido y nombre | Lo que informa cada jurisdicción |
| Camuzzi Gas Pampeana y del Sur | https://www.camuzzigas.com/guia-de-tramites/gasistas-matriculados/ | Elegir provincia, localidad y categoría | Gran parte de Buenos Aires, La Pampa, Neuquén, Río Negro, Chubut, Santa Cruz y Tierra del Fuego |
| MetroGAS | https://www.metrogas.com.ar/colaboradores/listado-de-gasistas-con-matricula/ | El buscador «Buscá tu gasista con matrícula» | Ciudad de Buenos Aires y parte del Gran Buenos Aires |
| Naturgy BAN | https://apps.naturgy.com.ar/Matriculados/Jsp/Nomina.jsp | «Seleccione el Partido a consultar» | La zona de Buenos Aires que atiende Naturgy BAN |
| Naturgy NOA | https://www.naturgynoa.com.ar/instaladores | Filtrar por provincia, localidad y categoría | Jujuy, Salta, Santiago del Estero y Tucumán |
| Litoral Gas | https://www.litoralgas.com.ar/site/hogares-y-comercios/info-y-tramites/listado-de-gasistas-y-profesionales/ | Elegir localidad y categoría (M1, M2, M3) | Santa Fe y el norte de la provincia de Buenos Aires |
| Ecogas | https://www.ecogas.com.ar/hogares-comercios/tramites-y-servicios/listado-de-gasistas-matriculados | Elegir provincia, ciudad y categoría, o buscar por nombre | Córdoba, La Rioja, Catamarca, Mendoza, San Juan y San Luis |

Lo que **no** se pudo comprobar ese día, y por eso no está:

- **Gasnea y las distribuidoras chicas** (Redengas y otras): no se encontró una página que se pudiera abrir y leer. Se suman cuando alguien la
  encuentre y la lea.
- **La ruta exacta dentro de SISA.** El portal respondió 503 a una de las dos consultas del día y la otra mostró solo el encabezado de la
  aplicación; el camino («Buscador de Establecimientos y profesionales» → REFEPS) sale de la ayuda en línea del propio SISA. Lo primero que hay que
  mirar cuando alguien diga que no lo encuentra.
- **La Resolución ENARGAS 21/2025**, que según E2 derogó la base nacional unificada de instaladores (Res. 219/2022): se cita porque explica por qué
  son listas por distribuidora, no se reabrió. La app dice que «cada distribuidora tiene su propia lista» y nada más.

## Cómo se vuelven a leer

Las direcciones cambian (E5, costos ocultos: «una URL por distribuidora»), y es lo que más cuesta de mantener. Cuando se revisen:

1. Abrir cada dirección desde un navegador **de Argentina** (algunos sitios oficiales no responden desde afuera) y mirar que cargue, que el
   buscador sea público y que la página siga diciendo lo que `covers` dice.
2. Si cambió, corregir `url` (y `how` o `covers` si hace falta) en `lib/evidence/registries.ts`, y actualizar `verifiedOn`.
3. Correr `pnpm vitest run tests/registries.test.ts`: exige `https`, que no haya nada después de la ruta, que cada registro esté en esta tabla y que
   la fecha sea una fecha.
4. Sumar o sacar un registro es editar esa lista y esta tabla; la pantalla los agrupa sola.

Quién lo hace: el equipo, no la persona. Cada vez que alguien diga «el enlace no abre», es esta revisión.
