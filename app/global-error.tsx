"use client";

import "./globals.css";

/**
 * The last resort: a throw in the root layout itself, before `app/(app)/error.tsx`
 * or anything else can catch it. Next replaces the whole document with this
 * file when it fires, so it declares its own `<html>`/`<body>` — nothing from
 * `layout.tsx` renders alongside it. Deliberately plain: no `next/font`
 * (those load through the layout this file is standing in for), just the
 * color tokens from `globals.css`, imported directly since nothing above this
 * file will pull it in.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.75rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--color-paper)",
          color: "var(--color-ink)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <p
            style={{
              marginBottom: "0.9rem",
              fontFamily: "ui-monospace, monospace",
              fontSize: "11px",
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: "var(--color-ink-3)",
            }}
          >
            cvexact
          </p>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 400, margin: 0 }}>
            La aplicación no pudo cargar
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              maxWidth: "42ch",
              fontSize: "14.5px",
              lineHeight: 1.6,
              color: "var(--color-ink-2)",
            }}
          >
            Tus datos siguen en este navegador — nada se perdió. Probá
            recargar la página.
          </p>
        </div>
        <button
          onClick={() => retry()}
          style={{
            background: "var(--color-ink)",
            color: "var(--color-paper)",
            border: "none",
            padding: "0.9rem 1.75rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
