# Especificación pública de los estudios del perfil

Lo que el código promete y lo que una prueba del producto tiene que respetar. Este
documento publica sólo lo que ya está implementado y verificable; las preguntas de
investigación que todavía no tienen respuesta no forman parte de la documentación
pública.

## El requisito plantado

**Este estudio no se corrió.** La lectura que el estudio necesita está prendida en el código
(`lib/jobs/requirements.ts` y `lib/jobs/requirement-ask.ts`), y estos son los tres
casos que tiene que seguir entendiendo:

| Qué se planta | Línea del aviso | Lo que el lector entiende |
| --- | --- | --- |
| Una herramienta, pedida como excluyente | `- Manejo de ZQX (excluyente)` | herramienta, excluyente |
| Una herramienta, sin decir cuánto pide | `- Experiencia con QBX` | herramienta, no lo dice |
| Una credencial, sin decir cuánto pide | `- Carnet de manipulación de ZQX` | credencial, no lo dice |

Los nombres `ZQX` y `QBX` no existen a propósito: antes de cada ronda se cambian por una que no exista, y se comprueba en un buscador que no devuelva nada, para que nadie los reconozca.

Resultados en cuentas, no en porcentajes. Cada lectura se contrasta con
`docs/banco-de-avisos.md`; la pérdida de datos del navegador, con
`docs/durabilidad.md`.

## El diario

Una persona anota durante dos semanas qué hace para buscar trabajo, qué contesta y
qué deja pendiente. Se mira si el perfil que sale de esas notas se parece a lo que
la persona diría de sí misma, y si las cifras se recuerdan igual que los hechos.

## La comparación a ciegas

Dos CVs para el mismo aviso —uno armado con el producto y otro a mano— se muestran
a selectores sin decir cuál es cuál. Se mira si la revisión del perfil mejora el CV
sin inflarlo y de dónde salió cada afirmación sin respaldo.

El banco de avisos y la durabilidad del perfil en el navegador tienen su propio
material en `docs/banco-de-avisos.md` y `docs/durabilidad.md`.

## El consentimiento de una prueba

Para esos estudios, y por escrito. Dice, en palabras de todos los días:

- Qué se hace, cuánto dura, y que es una prueba del producto y no de la persona.
- Qué se registra (respuestas, tiempos, lo que dice, un CV anonimizado), dónde se
  guarda y quién lo ve.
- Cuánto tiempo se guarda y cuándo se borra; que nada se vende ni se cede.
- Que puede dejar de participar cuando quiera, sin dar razones, y que se borra lo
  suyo.
- Que no se le pide ninguna clave, contraseña ni dato de pago.
- Una dirección de correo del equipo para ejercer sus derechos
  (`app/legales/privacidad/page.tsx`, cláusula 8).

No participan menores de 18 años.

## Los conteos que la gente decide dar

**Lo entrega ella.** El archivo de «Tu actividad en este navegador» se baja y se
entrega a quien hace la prueba, por el canal que esa persona elija. El producto no
lo manda y no tiene adónde; es opcional y la tarjeta lo dice.

**Un mínimo de personas por celda: 10** (valor de partida, a acordar con la
asesoría antes de la primera ronda). No se informa ninguna cuenta de la que hayan
participado menos de 10 archivos: debajo de eso, un número señala a una persona. Se
suman los archivos recibidos, nunca se muestra uno solo, y se dice «menos de 10» en
vez de una cifra.

**El producto no lo manda.** El contador es `template_counts` y sólo suma cuántas
veces se contestó cada tipo de pregunta de lo que pide un aviso —herramienta,
tarea, condición, credencial— con «sí», «no» o «ahora no»: doce números, ningún
texto de lo que la persona escribió.

Si algún día el archivo se envía desde la app, es un destino y un uso nuevos: pide
una versión de la política y un consentimiento aparte.

## Qué mide hoy cada indicador

Ver `docs/metricas.md`: I0 es el único indicador que sale del navegador, y los de
I1 a I7 no salen.
