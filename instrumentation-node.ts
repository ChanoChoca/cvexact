/**
 * Node-only half of instrumentation.ts, split out so this code never lands
 * in the Edge Runtime bundle (Turbopack statically flags `process.on` there
 * even when it's behind a runtime guard). See instrumentation.ts for why
 * this exists at all.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaught exception:", error);
});

// AGPL §13: la instancia que interactúa por red tiene que ofrecer el código de
// la versión desplegada. La app muestra el enlace sólo si esta variable estaba
// definida al compilar; si falta, el cumplimiento queda incompleto y nadie se
// entera hasta mirar el pie. Un warning al arrancar lo hace visible en los logs.
//
// `NEXT_PUBLIC_SOURCE_URL` es una variable `NEXT_PUBLIC_*`: Next la reemplaza
// en build, así que este chequeo evalúa el valor horneado en el artefacto, no
// el entorno del pod. Definirla sólo en runtime no evita el warning ni hace
// aparecer el enlace; hay que pasarla antes de `next build`.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SOURCE_URL?.trim()) {
  console.warn(
    "[agpl] El build no incluyó NEXT_PUBLIC_SOURCE_URL: el enlace «Código fuente» no se mostrará. " +
      "Definila antes de compilar, con la URL del tag o commit que corre en esta instancia.",
  );
}

// Sin ningún `export`, TypeScript clasifica este archivo como script global y
// no módulo, y el `await import("./instrumentation-node")` de instrumentation.ts
// falla con TS2306 ("File is not a module"). Este export vacío lo marca como
// módulo ES sin cambiar nada de su comportamiento (es de solo efectos).
export {};
