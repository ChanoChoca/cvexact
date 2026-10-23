# El banco de avisos

Lo que un aviso pide se lee en el navegador, sin IA (`lib/jobs/requirements.ts`), y de esa lectura sale la pregunta que
`/postular` le hace a la persona después del CV (`lib/jobs/requirement-ask.ts`). Ese lector es un
diccionario (`lib/jobs/requirement-words.ts`) y unas reglas escritas a mano, y es tan bueno como los avisos que vio. El banco
son avisos copiados con lo que piden marcado por una persona; el informe (`lib/jobs/bank.ts`) dice cuánto lee bien, y es el lugar
donde se suma un aviso que el lector entiende mal (qué precisión logra el extractor determinista en avisos de oficios).

## Qué hay hoy, y qué tan firme es

`tests/fixtures/avisos/` tiene **40 avisos de ejemplo** (`origen: "ejemplo"`) con **247 requisitos marcados**: 17 de oficios, 9 de
primer empleo, 7 técnicos y 7 administrativos. Hay prosa corrida, listas con viñetas y sin ellas, encabezados con emoji, avisos en
mayúsculas o todo en minúsculas, un mensaje de grupo de WhatsApp, un aviso técnico con «Must have» y «Nice to have», y el aviso de un
oficio y de un puesto de oficina para cada cosa que el producto pregunta.

**Los escribió quien escribió el lector. No son avisos reales.** Copian cómo se ven, pero los números de abajo son un techo y no una
promesa: lo que dice cuánto sirve en la calle son los avisos reales que sume el equipo, y hasta que haya (los 100 a 200 que pide el
estudio) **la pregunta sigue abierta**.

Los 40 se hicieron en tres tandas, y conviene saberlo para no leer de más las tablas:

1. **Avisos 1 a 20**: se escribieron y marcaron primero, y el lector se construyó mirándolos. Su tabla no dice nada de avisos nuevos.
2. **Avisos 21 a 30**: otros estilos (mayúsculas, emoji, numerados, una línea de WhatsApp, un aviso de HTML sin etiquetas). Se
   marcaron antes de que el lector los leyera, y esta fue **la primera lectura, sin tocar nada**. Después se arregló el lector con lo
   que mostraron (encabezados en medio de un párrafo, texto en minúsculas, palabras en mayúsculas que no son siglas, los encabezados
   «Must have» y «Se solicita», el aviso sin viñetas) y se los sumó a la tabla de arriba.
3. **Avisos 31 a 40**: lo mismo, con otros oficios y otro registro. **Segunda lectura, sin tocar nada.** Después se arregló lo que
   mostró (a qué parte de una línea pertenece un «deseable» que está en el medio de una lista, «preferentemente» dicho al pasar,
   «Suma:», «herramientas propias», «disponibilidad para viajar»).

| | Herramienta | Tarea | Condición | Credencial | Rasgo | Otro | Obligatoriedad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Primera lectura de 21–30**: precisión | 80 % | 100 % | 100 % | 100 % | 75 % | 89 % | |
| ídem: cobertura | 80 % | 50 % | 100 % | 100 % | 50 % | 62 % | 35 de 38 (92 %) |
| **Primera lectura de 31–40**: precisión | 100 % | 100 % | 91 % | 100 % | 80 % | 100 % | |
| ídem: cobertura | 89 % | 88 % | 92 % | 100 % | 67 % | 73 % | 46 de 51 (90 %) |
| **Hoy, los 40**: precisión | 100 % | 100 % | 100 % | 100 % | 96 % | 98 % | |
| ídem: cobertura | 98 % | 96 % | 100 % | 100 % | 86 % | 94 % | 237 de 237 |
| **Hoy, los 40, como los da el feed** (una línea, sin viñetas): precisión | 100 % | 100 % | 100 % | 100 % | 95 % | 98 % | |
| ídem: cobertura | 98 % | 91 % | 100 % | 100 % | 79 % | 94 % | 232 de 232 |

Lo que la persona verá es lo que se **pregunta** (herramienta, tarea, condición y credencial). Sobre eso, en la primera lectura de
cada tanda, con el lector sin tocar: precisión 93 % y 97 %, cobertura 77 % y 90 %. La precisión importa más que la cobertura: una
pregunta de más es una que la persona tiene que contestar, y una de menos es una que no se hizo; por eso el lector se equivoca hacia
el lado de preguntar menos. Lo que falló la primera vez fueron palabras y formas que el diccionario no conocía y se pudieron sumar,
y lo que falló la segunda fue más chico: no hay razón para pensar que con avisos reales no aparezcan otras, y por eso el banco existe.

Una etiqueta se tocó después de ver al lector, por ser un error de quien la puso y no del lector: en el aviso 17 una sola etiqueta
juntaba «manejo de Figma» (herramienta) y «nociones de motion graphics» (tarea), y se separó en dos. Otra (aviso 27, «Experiencia
diseñando APIs REST») se cambió de tarea a herramienta y se volvió a dejar como estaba: es una tarea que nombra una tecnología, y las
dos lecturas se defienden.

## El formato

Un archivo por aviso, con el nombre de su `id`, en `tests/fixtures/avisos/`:

```json
{
  "id": "ejemplo-12-auxiliar-administrativo",
  "origen": "ejemplo",
  "segmento": "primer-empleo",
  "texto": "Auxiliar administrativo/a (Jr) - Microcentro\n\nBuscamos:\n- Excel intermedio: tablas dinámicas y fórmulas básicas (excluyente)\n…",
  "requisitos": [
    { "fragmento": "Excel intermedio: tablas dinámicas y fórmulas básicas (excluyente)", "tipo": "herramienta", "obligatoriedad": "excluyente" }
  ]
}
```

- `origen`: `ejemplo` (escrito para mostrar el formato y empezar el banco) o `real` (copiado de un aviso de verdad).
- `segmento`: `oficios`, `primer-empleo`, `tecnico`, `administrativo` u `otro`.
- `texto`: el aviso, con sus saltos de línea. Si llega de la app como una sola línea (el feed saca las etiquetas del HTML y deja un
  renglón), también sirve: el informe lo prueba de las dos maneras.
- `fragmento`: las palabras del aviso, **tal cual están en `texto`** (el test lo comprueba). Una etiqueta por cosa que el aviso pide;
  si una línea pide dos cosas de tipos distintos («Manejo de Figma y nociones de motion graphics»), son dos etiquetas.

## Cómo suma el equipo un aviso real

1. **Copiarlo a mano**, como lo ve la persona. No hace falta todo: alcanza con la parte que dice qué piden. Sin cambiar nada del
   texto de los requisitos.
2. **No poner datos de nadie.** Los contactos se reemplazan (`@example.com`; los teléfonos, los links y los números largos se
   sacan), y no entra nada que haya escrito una persona de la app: el banco no usa datos de usuarios. El nombre de la empresa se
   puede sacar. El test lo comprueba: los correos son `@example.com`, no hay una cadena de ocho o más dígitos y no hay links.
3. **Marcar cada requisito** (más abajo, cómo).
4. **Correrlo**: `pnpm vitest run tests/jobs-bank.test.ts`, y con `BANCO_REPORTE=1` se imprime el informe entero: la tabla, lo que
   el lector no leyó y lo que leyó de más.
5. **Si el lector se equivoca**, se arregla el diccionario (una herramienta, un encabezado, una forma de decir «deseable») en
   `lib/jobs/requirement-words.ts`, con el aviso al lado. Un aviso que el lector lee mal es un aviso bueno para el banco.
6. **Si un piso baja**, se dice en el commit qué aviso lo hizo bajar y por qué vale la pena. Un piso sube cuando el lector mejora
   (`STRUCTURED` y `FLAT` en `tests/jobs-bank.test.ts`); no se baja para que pase un test.

## Cómo se marca

**Tipo** (`tipo`):

- `herramienta`: software, sistema, máquina o instrumento con nombre. «Excel», «SAP», «autoelevador», «multímetro», «sistema de
  comanda», «sistemas de gestión de stock».
- `tarea`: algo que se hace, o una experiencia en algo. «Atención al público», «experiencia en reparto», «lectura de planos».
- `condicion`: algo de la persona que no es una habilidad. Licencia de conducir, vehículo propio, disponibilidad, dónde vive,
  permisos, herramientas propias. Lo que el perfil guarda como «lo práctico» se pregunta; el resto (zona, viajes, herramientas
  propias) se lee y no se pregunta.
- `credencial`: lo que se tiene y se puede mostrar, y a veces vence. Matrícula, carnet de manipulación de alimentos, libreta
  sanitaria, certificación, un curso con nombre.
- `rasgo`: cómo es. «Proactivo», «responsable», «buen trato», «trabajo en equipo». Nunca se pregunta.
- `otro`: lo que no se pregunta nunca ni es una habilidad: edad, presencia, estudios, idiomas, portfolio, referencias, vacunas.

**Obligatoriedad** (`obligatoriedad`):

- `excluyente`: lo dice el aviso, en la línea («excluyente», «indispensable», «imprescindible», «obligatorio», «debe», «es
  necesario», «contar con») o en el encabezado de arriba («Requisitos excluyentes», «Must have»).
- `deseable`: lo dice en la línea («deseable», «valorable», «se valora», «plus», «no excluyente», «preferentemente» al principio)
  o en el encabezado («Requisitos deseables», «Nice to have»).
- `no_indicado`: todo lo demás, **también lo que está bajo «Requisitos»**: un título que dice «Requisitos» no dice que cada línea
  sea indispensable.

Casos que se resolvieron y conviene seguir resolviendo igual:

- **Licencia de conducir es una condición, no una credencial** («Licencia profesional D1», «Carnet de conducir»), como el vehículo
  propio: va a lo práctico del perfil.
- **Un horario del puesto no es un requisito** («Horario de lunes a viernes de 8 a 17 hs»); una disponibilidad sí («Disponibilidad
  de lunes a viernes de 9 a 18 hs»). Lo que se ofrece (sueldo, beneficios, tareas del puesto) no se marca.
- **«No es necesaria experiencia previa» no es un requisito de experiencia.** No se marca.
- **«Experiencia: 1 año», sin decir en qué**, no se marca como tarea: no hay nada que preguntar. «Matriculado/a» como adjetivo de
  un título tampoco.
- **Dos herramientas en una frase («Word y Excel») son una etiqueta**, salvo que el aviso las ponga con palabras distintas de
  cuánto pide.

## Qué mide el informe

Para cada aviso, el lector lee el texto y se compara con las etiquetas:

- Una lectura es **bien leída** si hay una etiqueta del mismo tipo que cubre el mismo tramo del aviso (una contiene a la otra, o
  comparten tres cuartos de las palabras de la más corta). «Debe manejar secador y plancha» y «manejar secador y plancha» son lo
  mismo.
- **Precisión** de un tipo: de lo que el lector leyó como ese tipo, cuánto es una etiqueta.
- **Cobertura** de un tipo: de lo que se marcó como ese tipo, cuánto leyó.
- **Obligatoriedad**: de las etiquetas que el lector leyó, en cuántas leyó también cuánto pide el aviso.

Los pisos están en `tests/jobs-bank.test.ts` (`STRUCTURED` para el aviso como se escribió, `FLAT` para el aviso en una línea, sin
viñetas y con ellas), un poco por debajo de lo medido. Un test comprueba que un lector que no lee nada, o que lee cada línea como
herramienta, no los pasa.

## Lo que el lector no lee

- **El inglés.** Reconoce las tecnologías que un aviso en inglés nombra (el glosario de `lib/ai/evidence.ts`), «Must have», «Nice to
  have» y «Requirements»; no las construcciones («experience in», «ability to»).
- **La prosa sin marcas.** Una frase como «Con experiencia comprobable y referencias» no dice en qué: no se pregunta. Los rasgos
  sueltos de una oración que nada presenta («Trato amable y puntualidad») no se leen; no se preguntaban de todos modos.
- **Lo que el diccionario no conoce.** Una herramienta de taller o un sistema propio de una empresa se lee como tarea si hay un
  «manejo de» delante, y si no, no se lee. Cada una que falte se suma al diccionario.
- **Una lista que perdió sus líneas.** Un aviso de HTML sin etiquetas (una línea, sin viñetas) se separa donde un renglón empieza
  con algo que abre un requisito («Experiencia en…», «Manejo de…», «Disponibilidad…», un título, un idioma) o después de un
  paréntesis; lo demás queda pegado al renglón de antes. Por eso tiene menos cobertura de tareas (91 % contra 96 %).
- **Los avisos muy largos.** Lee los primeros 20.000 caracteres y no más de 60 requisitos; cita hasta 240 caracteres de cada uno.

## Lo que hace la app con esto

`/postular`, después del CV y sin IA: el aviso se lee, y de lo que pide y el perfil no dice **se pregunta una sola cosa por
postulación**, si a la sesión le queda lugar: antes una credencial, después una condición (licencia, vehículo, disponibilidad,
permiso), una herramienta, una tarea. Solo de lo que el aviso no llama «deseable»; nunca un rasgo; nunca lo que ya está en el perfil
ni lo que la persona dijo que no tiene. Con las palabras del aviso a la vista y tres respuestas del mismo peso: «Sí», «No» y «Ahora
no». Cada «Sí» pide lo que es de la persona (la línea de dónde lo usó, la credencial que tiene y hasta cuándo, la clase de la licencia)
y lo guarda donde corresponde; el «No» se guarda en el perfil con su fecha y no se vuelve a preguntar. Los doce contadores de lo que
se preguntó y lo que se contestó (`ask_tool_done`, `ask_condition_no`…) están en «Tu actividad en este navegador».
