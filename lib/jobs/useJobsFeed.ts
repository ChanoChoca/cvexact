"use client";

import { useEffect, useState } from "react";
import type { FeedResponse } from "./feed-query";

/**
 * Client-side reader for `/api/jobs/feed` — the same `fetchStatus`-then-
 * `useEffect` shape as `useBillingStatus` in `lib/api/billing.ts`, minus the
 * BYOK header: the feed is public and unpersonalised, so nothing here needs
 * `requestHeaders()`.
 */

export type JobsFeedFilters = {
  source?: string;
  workMode?: string;
  seniority?: string;
  q?: string;
};

async function fetchFeed(page: number, filters: JobsFeedFilters): Promise<FeedResponse | null> {
  const params = new URLSearchParams({ page: String(page) });
  if (filters.source) params.set("source", filters.source);
  if (filters.workMode) params.set("workMode", filters.workMode);
  if (filters.seniority) params.set("seniority", filters.seniority);
  if (filters.q) params.set("q", filters.q);

  try {
    // Sin sesión ni BYOK header (ver el comentario de arriba), pero sí este:
    // deja que `/api/jobs/feed` le dé el límite de tasa normal al navegador
    // de verdad y uno mucho más ajustado a cualquiera que le pegue sin pasar
    // por acá — no autentica nada (es trivial de copiar con curl), sólo
    // separa el tráfico de la UI del de un scraper que no se molestó en
    // mirar qué manda el propio front. Ver el comentario en la ruta.
    const response = await fetch(`/api/jobs/feed?${params}`, {
      headers: { "x-cvexact-client": "web" },
    });
    if (!response.ok) return null;
    return (await response.json()) as FeedResponse;
  } catch {
    return null;
  }
}

type FeedState = { data: FeedResponse | null; loading: boolean; failed: boolean };

/**
 * Takes the filter fields individually rather than as one `JobsFeedFilters`
 * object, so `react-hooks/exhaustive-deps` can see the real dependency list.
 * A caller building `{ workMode, q }` inline — which `JobsList` does, every
 * render — hands the effect a new object identity each time; passed as
 * primitives instead, the effect only re-fires when a value actually
 * changed, and there is nothing to memoise or disable a lint rule over.
 *
 * `loading` only ever goes true → false, once — it is not reset to `true` on
 * a later page or filter change. The alternative (`setLoading(true)`
 * synchronously at the top of the effect, on every dependency change) is
 * exactly the "cascading renders" pattern `react-hooks/set-state-in-effect`
 * exists to catch — the same rule that already flags `Wizard.tsx`'s draft
 * restore. It also reads better here than there: switching page keeps the
 * previous page's rows on screen until the next page answers, instead of
 * flashing a spinner over them.
 */
export function useJobsFeed(page: number, filters: JobsFeedFilters): FeedState {
  const { source, workMode, seniority, q } = filters;
  const [state, setState] = useState<FeedState>({ data: null, loading: true, failed: false });

  useEffect(() => {
    // Guarded the same way `useBillingStatus` is: a page change or an
    // unmount mid-flight must not let a stale response land after a newer
    // one already has.
    let cancelled = false;

    void fetchFeed(page, { source, workMode, seniority, q }).then((next) => {
      if (cancelled) return;
      // A failed refetch keeps whatever page was already on screen rather
      // than wiping it — the request that failed was for a *different* page
      // than the one still showing, and losing good data over a transient
      // failure to load more of it is a worse failure than the network's.
      setState((prev) => ({ data: next ?? prev.data, loading: false, failed: next === null }));
    });

    return () => {
      cancelled = true;
    };
  }, [page, source, workMode, seniority, q]);

  return state;
}
