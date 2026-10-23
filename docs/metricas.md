# Qué mide el producto, y qué no sale del navegador

El producto mide dos cosas distintas: el consumo anónimo de IA en el servidor
(I0) y un puñado de cuentas locales que la persona puede ver y borrar (I1 a I7).
La regla que sostiene la política de privacidad es una sola: **ningún indicador de
I1 a I7 sale del navegador**. I0 ya estaba declarado y es el único que viaja.

## Qué mide hoy cada indicador: I0 frente a I1–I7

| Código | Qué mide | Dónde vive | ¿Sale del navegador? |
| --- | --- | --- | --- |
| **I0** | El consumo anónimo de IA: generaciones, acción y modelo, por día | El servidor, tabla `generation_usage` | **Sí**, agregado y sin identificador (cláusulas 3 y 9) |
| I2 | Las tareas de cada puesto y cuántas llevan cifra | El navegador (`lib/profile/inventory.ts`) | No |
| I3 | Cuándo se revisó cada sección y cuántas cosas hay para revisar | El navegador (`lib/profile/currency.ts`) | No |
| I4 | Las cosas del perfil que tienen algo al lado, contadas por cómo se pueden ver | El navegador (`lib/profile/evidence.ts`) | No |
| I5 | Las respuestas a lo que pide un aviso, por tipo | Contadores locales `ask_<tipo>_<respuesta>` (`lib/metrics/counters.ts`) | No |
| I6 | Las correcciones del perfil: `requirement_claimed`, `requirement_declined`, `inferred_skill_vetoed` y, con el interruptor prendido, `correction_saved`, `correction_only_here`, `correction_mistake` | `lib/metrics/counters.ts` | No |
| I7 | Un perfil recuperado en otro navegador y la persistencia concedida: `profile_recovered`, `persistence_granted` | `lib/metrics/counters.ts` | No |

Cada uno es una **cuenta o una fecha, nunca un porcentaje del perfil**. Las cuentas
se guardan por día, noventa días, en el navegador de la persona; se borran con
«Borrar los datos de este navegador» y no viajan con la cuenta ni con ninguna
exportación. La tabla del servidor que sostiene I0 es `generation_usage`, en
`lib/db/schema.ts`.

## Los contadores

La lista es cerrada (`METRICS`, en `lib/metrics/counters.ts`): doce contadores
`ask_<tipo>_<respuesta>` —herramienta, tarea, condición y credencial, por «sí»,
«no» y «ahora no»— más los de correcciones, recuperación y persistencia. Agregar
uno es una decisión de producto, no un detalle de implementación.

## Lo que no se hace

No hay contadores agregados con opt-in, ni un evento por persona, ni un envío
automático de estas cuentas. Si algún día se agrega, es un uso y un destino nuevos:
pide una versión de la política y un consentimiento aparte.
