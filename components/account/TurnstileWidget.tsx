"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/**
 * El widget de Cloudflare Turnstile, render explícito.
 *
 * Sólo se monta cuando hay site key (la decide `app/(app)/ajustes/page.tsx`,
 * leyéndola del entorno por request): sin ella este componente no existe y el
 * flujo de cuentas queda exactamente como siempre. El token se sube al padre
 * vía `onToken`, incluida la vuelta a vacío cuando expira o falla — un token
 * viejo guardado sería rechazado igual por el servidor, pero dejaría al usuario
 * sin widget visible para conseguir otro.
 */

type RenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (element: HTMLElement, options: RenderOptions) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded || !holder.current || !window.turnstile || widgetId.current !== null) return;

    widgetId.current = window.turnstile.render(holder.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });

    return () => {
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
        onToken("");
      }
    };
  }, [loaded, siteKey, onToken]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setLoaded(true)}
      />
      <div ref={holder} />
    </>
  );
}
