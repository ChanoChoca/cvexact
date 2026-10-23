"use client";

import { useCallback, useEffect, useState } from "react";
import { requestHeaders } from "./client";
import type { Action } from "@/lib/quota";

/**
 * What the user has left, before they run out.
 *
 * The server has always known this and always sent it on a refusal, and for a
 * long time nothing read it — so the only way to discover a limit was to hit
 * one. This is the reader.
 *
 * It goes through `requestHeaders()` rather than building its own: the endpoint
 * decides whether to answer "no ceiling" by looking at the BYOK chain, and a
 * second hand-rolled copy of that header is exactly how this route once ended
 * up reporting a trial balance to people who had their own key.
 */

export type BillingStatus = {
  tier: "byok" | "pro" | "credits" | "free";
  used: number;
  /** Null under BYOK, where there is no ceiling to report. */
  allowance: number | null;
  credits: number;
  /** Which gateways can take money right now. Empty means none are configured. */
  gateways: "mercadopago"[];
  /**
   * Whether the service has an API key of its own.
   *
   * False makes every metered tier unusable no matter what `allowance` says —
   * the counter is real, the capability is not. Only BYOK still works.
   */
  serviceConfigured: boolean;
  /** The pack in applications, already divided by the server. */
  packApplications: number | null;
  signedIn: boolean;
  subscription: {
    gateway: "mercadopago" | null;
    active: boolean;
    canSubscribe: { mercadopago: boolean };
  };
  /**
   * Lo esencial de cada producto, para poder mostrarlo antes del checkout.
   *
   * Viene del servidor y no de constantes del bundle por lo mismo que
   * `packApplications`: los precios son variables de entorno y los topes viven
   * en `lib/quota.ts`, que es `server-only`. Un bloque de "qué estás
   * contratando" que hiciera su propia cuenta podría anunciar condiciones
   * distintas de las que el servidor cobra y aplica.
   */
  terms: {
    pack: {
      priceArs: number | null;
      credits: number;
      applications: number;
      expiryMonths: number;
    } | null;
    subscription: {
      priceArs: number | null;
      monthlyApplications: number;
      dailyApplications: number;
    } | null;
  };
};

/**
 * Returns null on any failure. Knowing the balance is a convenience, never a
 * precondition: every consumer renders nothing without it, which is how the app
 * behaved before any of this existed.
 */
async function fetchStatus(action: Action): Promise<BillingStatus | null> {
  try {
    const response = await fetch(`/api/billing/status?action=${action}`, {
      headers: requestHeaders(),
    });
    if (!response.ok) return null;
    return (await response.json()) as BillingStatus;
  } catch {
    return null;
  }
}

/**
 * The answer being waited for, shared: a screen with a button for an AI action on each of twenty lines asks twenty times in the same
 * instant, and one answer serves them all. Only while it is on its way — a reader that comes after gets a new one — and not for `refresh`,
 * which asks because something just changed the balance and must not be told what it was a moment ago.
 */
const asking = new Map<Action, Promise<BillingStatus | null>>();

function fetchStatusOnce(action: Action): Promise<BillingStatus | null> {
  const pending = asking.get(action);
  if (pending) return pending;
  const request = fetchStatus(action).finally(() => asking.delete(action));
  asking.set(action, request);
  return request;
}

export function useBillingStatus(action: Action = "cv") {
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    // Guarded against a late answer: switching action, or unmounting mid-flight,
    // would otherwise let a stale balance overwrite a newer one.
    let cancelled = false;

    void fetchStatusOnce(action).then((next) => {
      if (!cancelled && next) setStatus(next);
    });

    return () => {
      cancelled = true;
    };
  }, [action]);

  /** Re-reads after something that changes the balance, like a cancellation. */
  const refresh = useCallback(async () => {
    const next = await fetchStatus(action);
    if (next) setStatus(next);
  }, [action]);

  return { status, refresh };
}
