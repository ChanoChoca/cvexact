"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, ButtonAnchor, Checkbox, Input, PageHeading, Row, Rows, Select, Spinner } from "@/components/ui";
import { CrashGuard } from "@/components/ui/CrashGuard";
import { useToast } from "@/components/ui/toast";
import { MissingName } from "@/components/wizard/MissingName";
import { useSession } from "@/lib/auth-client";
import { hasSomethingToScore } from "@/lib/jobs/readiness";
import { scoreJobPosting, type JobMatch } from "@/lib/jobs/score";
import { blendScores, cosine, postingText, profileText } from "@/lib/jobs/semantic";
import type { JobPosting } from "@/lib/jobs/feed-query";
import { useJobsFeed, type JobsFeedFilters } from "@/lib/jobs/useJobsFeed";
import {
  dismissJob,
  listApplications,
  saveDraftJobText,
  setSemanticJobsEnabled,
  undismissJob,
  type Application,
} from "@/lib/storage/local";
import {
  useDismissedJobIds,
  useHydrated,
  useProfile,
  useSemanticJobsEnabled,
  useStoredProfile,
} from "@/lib/storage/hooks";
import { findLocalCvMatches } from "@/lib/tracker/match-local-cv";
import { cvVersionFingerprint, suggestCvVersionLabel } from "@/lib/tracker/cv-version";
import { JobAlertCard } from "./JobAlertCard";
import { ChooseCvDialog } from "./ChooseCvDialog";

/**
 * The job feed: public listings from `/api/jobs/feed`, scored in the browser
 * against the profile `useProfile()` already holds — no request here ever
 * carries the profile anywhere. See the comment on `jobPosting` in
 * `lib/db/schema.ts` for why that split is the point, not an optimisation.
 *
 * Modelled on `ApplicationsList` (`app/(app)/postulaciones/ApplicationsList.tsx`):
 * `PageHeading`, `Rows`/`Row`, a filter row with live counts where one is
 * cheap to compute, badges for what a row carries. The one thing that page
 * does not need and this one does is pagination — this is the first list in
 * the app with more rows than fit on one screen.
 */

const SOURCE_LABEL: Record<string, string> = {
  getonbrd: "Get on Board",
  himalayas: "Himalayas",
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  jobicy: "Jobicy",
  jooble: "Jooble",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  recruitee: "Recruitee",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
};

const WORK_MODE_LABEL: Record<string, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
  unknown: "Sin especificar",
};

function scoreTone(score: number): "good" | "info" | "warn" {
  if (score >= 70) return "good";
  if (score >= 40) return "info";
  return "warn";
}

/**
 * `description` is the source's own HTML (see the comment on that column in
 * `lib/db/schema.ts`) — `DOMParser` is the one honest way to turn it into the
 * plain text `/postular` expects to be pasted, entities and all, without a
 * regex that mangles the first `&amp;` it meets.
 */
function stripHtml(html: string): string {
  if (typeof window === "undefined") return html;
  return new window.DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}

function salaryLabel(job: JobPosting): string | null {
  if (job.salaryMin == null && job.salaryMax == null) return null;
  const currency = job.salaryCurrency ? `${job.salaryCurrency} ` : "";
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax) {
    return `${currency}${job.salaryMin.toLocaleString("es")}–${job.salaryMax.toLocaleString("es")}`;
  }
  return `${currency}${(job.salaryMin ?? job.salaryMax)!.toLocaleString("es")}`;
}

type SemanticStatus = "idle" | "loading" | "computing" | "done" | "error";

/**
 * `embedder.worker.ts` is not loaded via `new URL("./embedder.worker.ts",
 * import.meta.url)` — verified in practice (`pnpm build`, Turbopack, Next
 * 16.3.0) that this silently copies the raw `.ts` source into
 * `/_next/static/media/` as an unprocessed static asset instead of compiling
 * it, which the browser cannot execute, with no build error anywhere.
 * `scripts/build-embedder-worker.mjs` bundles it into a standalone
 * `public/embedder.worker.js` at `predev`/`prebuild` time instead — the same
 * move `scripts/copy-pdf-worker.mjs` makes for pdf.js's worker, and for the
 * same documented reason. This is a plain runtime string, no bundler magic.
 */
function createEmbedderWorker(): Worker {
  // The `?v=` is a hash of the bundle (`embedderWorkerVersion` in
  // `next.config.ts`): Cloudflare caches `.js` for 4 h in the browser, so a
  // fixed URL keeps serving the previous worker after a deploy.
  return new Worker(`/embedder.worker.js?v=${process.env.NEXT_PUBLIC_EMBEDDER_WORKER_V}`, {
    type: "module",
  });
}

type WorkerOutMessage =
  | { kind: "status"; state: "loading" | "ready" }
  | { kind: "result"; id: string; embeddings: number[][] }
  | { kind: "error"; id: string; error: string };

export function JobsList() {
  const profile = useProfile();
  const hydrated = useHydrated();
  const dismissed = useDismissedJobIds();
  const semanticEnabled = useSemanticJobsEnabled();
  const router = useRouter();
  const toast = useToast();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [page, setPage] = useState(1);
  const [workMode, setWorkMode] = useState("");
  const [q, setQ] = useState("");
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [cvChoiceFor, setCvChoiceFor] = useState<{ job: JobPosting; matches: Application[] } | null>(null);

  const filters: JobsFeedFilters = { workMode: workMode || undefined, q: q || undefined };
  const { data, loading, failed } = useJobsFeed(page, filters);

  // Something to score against — not the name, which no score reads and which a CV needs:
  // that is asked for below, in place (`lib/jobs/readiness.ts`).
  const hasProfile = hasSomethingToScore(useStoredProfile());
  const hasName = profile.fullName.trim().length > 0;

  // Blended (lexical + semantic) score per job id, for the page currently
  // loaded — empty until `embedder.worker.ts` answers, so the feed always
  // has *a* score to sort by (the lexical one) before the model finishes, or
  // even starts, downloading. See `lib/jobs/semantic.ts` for the blend.
  const [blended, setBlended] = useState<Record<string, number>>({});
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>("idle");
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Unmount only — toggling the switch off terminates explicitly below,
    // so the model can actually be released from memory rather than just
    // going idle.
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!semanticEnabled || !hasProfile || !data?.jobs.length) return;

    if (!workerRef.current) {
      workerRef.current = createEmbedderWorker();
    }
    const worker = workerRef.current;
    const jobs = data.jobs;
    const requestId = crypto.randomUUID();

    function handle(event: MessageEvent<WorkerOutMessage>) {
      const msg = event.data;
      if (msg.kind === "status") {
        // "ready" (the model finished loading) is transient — "computing"
        // follows within the same worker turn, so there is no separate UI
        // state worth showing for it.
        setSemanticStatus(msg.state === "ready" ? "computing" : msg.state);
        return;
      }
      if (msg.id !== requestId) return; // A stale reply from a page we already left.
      worker.removeEventListener("message", handle);
      if (msg.kind === "error") {
        setSemanticStatus("error");
        return;
      }
      const [profileEmbedding, ...jobEmbeddings] = msg.embeddings;
      const similarities = jobEmbeddings.map((e) => cosine(profileEmbedding, e));
      const lexical = jobs.map((job) => scoreJobPosting(profile, job).score);
      const scores = blendScores(lexical, similarities);
      const next: Record<string, number> = {};
      jobs.forEach((job, i) => {
        next[job.id] = scores[i];
      });
      setBlended((prev) => ({ ...prev, ...next }));
      setSemanticStatus("done");
    }

    worker.addEventListener("message", handle);
    worker.postMessage({
      id: requestId,
      texts: [
        profileText(profile),
        ...jobs.map((job) =>
          postingText({ title: job.title, tags: job.tags, description: stripHtml(job.description) }),
        ),
      ],
    });
    return () => worker.removeEventListener("message", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `profile` re-embedding on every keystroke on /perfil would thrash the worker; it reads the profile once per fetched page instead.
  }, [semanticEnabled, hasProfile, data]);

  const toggleSemantic = (enabled: boolean) => {
    setSemanticJobsEnabled(enabled);
    if (!enabled) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setBlended({});
      setSemanticStatus("idle");
    }
  };

  const rows = useMemo(() => {
    const jobs = (data?.jobs ?? []).filter((job) => !dismissed.includes(job.id));
    if (!hydrated || !hasProfile) {
      return jobs.map((job) => ({ job, match: null as JobMatch | null }));
    }
    const scored = jobs.map((job) => ({ job, match: scoreJobPosting(profile, job) }));
    scored.sort((a, b) => {
      const bScore = blended[b.job.id] ?? b.match?.score ?? 0;
      const aScore = blended[a.job.id] ?? a.match?.score ?? 0;
      return bScore - aScore;
    });
    return scored;
  }, [data, dismissed, hydrated, hasProfile, profile, blended]);

  const postular = async (job: JobPosting) => {
    if (job.canPrefill) {
      // `job.description` here is only the feed's excerpt (see
      // `FEED_DESCRIPTION_CHARS`, `lib/jobs/feed-query.ts`) — fetch the whole
      // aviso for the one thing that actually needs it. Best-effort, same as
      // the write below: a failed fetch or a full quota just means the
      // wizard opens with less (or nothing) pre-filled, never a reason to
      // block navigation.
      let full = job.description;
      try {
        const res = await fetch(`/api/jobs/${job.id}/description`);
        if (res.ok) full = ((await res.json()) as { description: string }).description;
      } catch {
        // ignore — falls back to the excerpt already in hand.
      }
      try {
        saveDraftJobText(stripHtml(full));
      } catch {
        // ignore — StorageFullError, surfaced properly where the user can act
        // on it (typing in the wizard itself retriggers the same write).
      }
      router.push("/postular");
    } else {
      window.open(job.url, "_blank", "noopener,noreferrer");
    }
  };

  /**
   * La ruta de captura principal del tracker: un click, sin modal salvo
   * cuando hay que elegir entre más de un CV local (`cvChoiceFor`). "Guardar"
   * y "Ya me postulé" comparten esta función — sólo cambia `status` y si se
   * intenta vincular un CV, que sólo tiene sentido para lo segundo.
   */
  const postTrackedApplication = (job: JobPosting, status: "guardado" | "postulado", id?: string) =>
    fetch("/api/tracker/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        jobTitle: job.title,
        company: job.company,
        source: job.source,
        jobPostingId: job.id,
        jobUrl: job.url,
        location: job.location,
        remote: job.workMode === "remote",
        salaryMin: job.salaryMin ?? undefined,
        salaryMax: job.salaryMax ?? undefined,
        currency: job.salaryCurrency ?? undefined,
        status,
        appliedAt: status === "postulado" ? new Date().toISOString() : undefined,
      }),
    });

  /**
   * La ruta de captura principal del tracker: un click, sin modal salvo
   * cuando hay que elegir entre más de un CV local (`cvChoiceFor`). "Guardar"
   * y "Ya me postulé" comparten esta función.
   *
   * `matchedLocalId`, cuando viene de un CV local encontrado por
   * `findLocalCvMatches`, se manda como el `id` de la postulación nueva —a
   * propósito el mismo id que ya tiene esa `Application` en este navegador,
   * no uno nuevo— así "Descargar CV" en el detalle del tracker
   * (`/cv/{id}/print`) resuelve al documento correcto en este mismo
   * dispositivo. Si ese id ya existe (la misma CV local emparejada dos
   * veces, un caso raro pero posible), se reintenta una vez sin id.
   */
  const createTrackedApplication = async (
    job: JobPosting,
    status: "guardado" | "postulado",
    options: { cvVersionId?: string; matchedLocalId?: string } = {},
  ) => {
    setSavingJobId(job.id);
    try {
      let response = await postTrackedApplication(job, status, options.matchedLocalId);
      if (!response.ok && options.matchedLocalId) {
        response = await postTrackedApplication(job, status);
      }
      if (!response.ok) {
        toast({ tone: "bad", message: "No se pudo guardar en el seguimiento." });
        return;
      }
      const body = (await response.json()) as {
        application: { id: string };
        duplicates: { id: string }[];
      };

      if (options.cvVersionId) {
        await fetch(`/api/tracker/applications/${body.application.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cvVersionId: options.cvVersionId }),
        });
      }

      if (body.duplicates?.length > 0) {
        toast({
          tone: "warn",
          message: "Ya tenías algo parecido guardado en tu seguimiento — lo agregamos igual.",
          action: { label: "Revisar", onClick: () => router.push("/postulaciones?view=tabla") },
        });
      } else {
        toast({
          tone: "good",
          message: status === "guardado" ? "Guardado en tu seguimiento." : "Marcado como postulado.",
          action: { label: "Ver seguimiento", onClick: () => router.push("/postulaciones") },
        });
      }
    } catch {
      toast({ tone: "bad", message: "No se pudo conectar con el servidor." });
    } finally {
      setSavingJobId(null);
    }
  };

  const guardarAviso = (job: JobPosting) => void createTrackedApplication(job, "guardado");

  const ensureCvVersionFor = async (application: Application): Promise<string | undefined> => {
    const fingerprint = cvVersionFingerprint(application.cv!);
    const versionResponse = await fetch("/api/tracker/cv-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, label: suggestCvVersionLabel(application.cv!) }),
    });
    if (!versionResponse.ok) return undefined;
    return ((await versionResponse.json()) as { version: { id: string } }).version.id;
  };

  const yaMePostule = async (job: JobPosting) => {
    // Read at the click, once loaded: the applications come from the browser
    // database after hydration, and a click right after opening the page must
    // not miss a matching CV because it had not answered yet.
    const matches = findLocalCvMatches(await listApplications(), { title: job.title, company: job.company });
    if (matches.length === 0) {
      await createTrackedApplication(job, "postulado");
      return;
    }
    if (matches.length === 1) {
      const cvVersionId = await ensureCvVersionFor(matches[0]);
      await createTrackedApplication(job, "postulado", { cvVersionId, matchedLocalId: matches[0].id });
      return;
    }
    setCvChoiceFor({ job, matches });
  };

  const chooseCvForApplication = async (application: Application) => {
    const job = cvChoiceFor?.job;
    setCvChoiceFor(null);
    if (!job) return;
    const cvVersionId = await ensureCvVersionFor(application);
    await createTrackedApplication(job, "postulado", { cvVersionId, matchedLocalId: application.id });
  };

  const skipCvChoice = async () => {
    const job = cvChoiceFor?.job;
    setCvChoiceFor(null);
    if (job) await createTrackedApplication(job, "postulado");
  };

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-10" data-panel="wide">
      <PageHeading eyebrow="Descubrí" title="Empleos">
        Avisos de portales y empresas públicas, puntuados contra tu perfil acá mismo
        en tu navegador — nada de esto se manda a ningún lado. Ninguno de estos avisos
        pasó por nuestra revisión: son exactamente lo que cada fuente publicó.
      </PageHeading>

      <JobAlertCard />

      {!hasProfile ? (
        <div className="border-t border-b border-rule py-4 text-sm text-ink-2">
          <Link href="/perfil" className="underline underline-offset-4 hover:text-ink">
            Completá tu perfil
          </Link>{" "}
          para ver qué tan bien encaja cada aviso.
        </div>
      ) : !hasName ? (
        <div className="space-y-3 border-t border-b border-rule py-4 text-sm text-ink-2">
          <p>El encaje se calcula con tu recorrido, sin tu nombre. Para postularte sí falta tu nombre:</p>
          <MissingName />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-2">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 font-solar text-xs tracking-widest text-ink-3 uppercase">
            Modalidad
            <Select
              value={workMode}
              onChange={(e) => {
                setWorkMode(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {Object.entries(WORK_MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <Input
            type="search"
            placeholder="Buscar por título…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="w-48"
          />
        </div>
        {dismissed.length > 0 ? (
          <button
            type="button"
            onClick={() => dismissed.forEach(undismissJob)}
            className="font-solar text-xs tracking-widest text-ink-3 uppercase hover:text-ink"
          >
            Mostrar {dismissed.length} oculto{dismissed.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      {hasProfile ? (
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={semanticEnabled}
            onChange={(e) => toggleSemantic(e.target.checked)}
            label="Ordenar por afinidad semántica"
          />
          {semanticEnabled ? (
            <span className="text-xs text-ink-3">
              {semanticStatus === "loading"
                ? "Descargando el modelo (primera vez, ~120 MB)…"
                : semanticStatus === "computing"
                  ? "Calculando afinidad…"
                  : semanticStatus === "error"
                    ? "No se pudo calcular — se muestra el orden habitual."
                    : semanticStatus === "done"
                      ? "Listo."
                      : "Corre en tu navegador; descarga un modelo la primera vez."}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-ink-3">
          <Spinner /> Cargando…
        </p>
      ) : failed ? (
        <p className="border-b border-rule py-8 text-[14.5px] text-ink-2">
          No pudimos traer los avisos. Probá de nuevo en un rato.
        </p>
      ) : rows.length === 0 ? (
        <p className="border-b border-rule py-8 text-[14.5px] text-ink-2">
          No hay avisos que coincidan con este filtro.
        </p>
      ) : (
        <>
          <CrashGuard
            title="No pudimos mostrar esta lista"
            hint="Podés recargar la página o probar sin la afinidad semántica activada."
          >
            <Rows>
              {rows.map(({ job, match }) => (
                <Row
                  key={job.id}
                  aside={
                    <div className="flex flex-wrap items-center gap-3">
                      <ButtonAnchor href={job.url} target="_blank" rel="noopener noreferrer" variant="secondary">
                        Ver aviso
                      </ButtonAnchor>
                      <Button onClick={() => postular(job)}>
                        {job.canPrefill ? "Postular" : "Ir al portal"}
                      </Button>
                      {userId ? (
                        <>
                          <Button
                            variant="secondary"
                            disabled={savingJobId === job.id}
                            onClick={() => guardarAviso(job)}
                          >
                            Guardar
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={savingJobId === job.id}
                            onClick={() => void yaMePostule(job)}
                          >
                            Ya me postulé
                          </Button>
                        </>
                      ) : null}
                      <Button
                        variant="ghost"
                        onClick={() => dismissJob(job.id)}
                        aria-label="Ocultar este aviso"
                      >
                        Ocultar
                      </Button>
                    </div>
                  }
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {match ? (
                      <Badge tone={scoreTone(match.score)}>{match.score}% compatible</Badge>
                    ) : null}
                    <Badge tone="neutral">{SOURCE_LABEL[job.source] ?? job.source}</Badge>
                    <Badge tone="neutral">{WORK_MODE_LABEL[job.workMode] ?? job.workMode}</Badge>
                    {job.dupes > 1 ? (
                      <span className="text-xs text-ink-3">
                        también en {job.dupes - 1} portal{job.dupes - 1 === 1 ? "" : "es"} más
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 line-clamp-2 wrap-break-word text-ink">{job.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 wrap-break-word text-xs text-ink-3">
                    {job.company ? <span>{job.company}</span> : null}
                    {job.location ? <span>· {job.location}</span> : null}
                    {salaryLabel(job) ? <span>· {salaryLabel(job)}</span> : null}
                  </p>
                </Row>
              ))}
            </Rows>
          </CrashGuard>

          <div className="flex items-center justify-between gap-4 py-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <span className="font-solar text-xs tracking-widest text-ink-3">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}

      {cvChoiceFor ? (
        <ChooseCvDialog
          matches={cvChoiceFor.matches}
          onChoose={(application) => void chooseCvForApplication(application)}
          onSkip={() => void skipCvChoice()}
        />
      ) : null}
    </div>
  );
}
