"use client";

import { useState } from "react";
import { Badge, Button, Checkbox, Input, Textarea } from "@/components/ui";
import { addGithubProject, hasProjectAt } from "@/lib/github/project";
import {
  GITHUB_HOURLY_LIMIT,
  failureText,
  propose,
  readReadme,
  readRepos,
  type GithubFailure,
  type GithubReading,
  type Proposal,
  type Readme,
} from "@/lib/github/read";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { useExperiment } from "@/lib/use-experiment";
import { LABEL, edit } from "./cells";

/**
 * «Traer mis proyectos de GitHub» (e5, O19). The browser asks GitHub for the public repositories of the user the person writes — no token, no account,
 * nothing through this server — and what comes back is a list of *proposals*: repositories that are the person's own and not copies of someone else's,
 * each with what makes it doubtful, in words. A proposal becomes a project only when the person answers the fixed question — «¿Qué hiciste vos en este
 * proyecto?» — in their own words.
 *
 * Nothing here counts anything: no stars, no commits, no followers. A language is a technology of the project according to GitHub and not a skill.
 * Not having a GitHub is not a gap: nothing in the profile asks for it, and this is a way in for whoever has one — a button, where the profile speaks of code
 * (`hasTechnicalSignals`), and a line under «Agregar proyecto» where it does not, so that it is not the first thing a warehouse manager reads in her projects.
 *
 * Switched off, it draws nothing (`lib/experiments.ts`).
 */

const SHOWN = 12;

const dayLine = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
};

function ProposalCard({ proposal, onAdded, onSkip }: { proposal: Proposal; onAdded: (name: string) => void; onSkip: () => void }) {
  const { repo, doubts } = proposal;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(repo.name);
  const [said, setSaid] = useState("");
  const [withLanguage, setWithLanguage] = useState(repo.language !== "");
  const [readme, setReadme] = useState<Readme | "none" | GithubFailure | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pushed = dayLine(repo.pushedAt);

  const add = () => {
    let added = null as ReturnType<typeof addGithubProject> | null;
    edit((draft) => {
      added = addGithubProject(draft, { repo, name, said, withLanguage });
    });
    if (!added || !added.ok) {
      setProblem(added && added.reason === "exists" ? "Ya tenés este proyecto." : "Falta contar qué hiciste vos.");
      return;
    }
    onAdded(name.trim());
  };

  const showReadme = async () => {
    const result = await readReadme(repo.fullName);
    setReadme(result.ok ? (result.readme.summary ? result.readme : "none") : result.failure.reason === "not_found" ? "none" : result.failure);
  };

  return (
    <li className="space-y-3 border border-rule bg-paper p-3" data-github-proposal={repo.fullName}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={repo.url} target="_blank" rel="noopener noreferrer" className="text-[15px] break-all text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white pointer-coarse:py-3">
          {repo.name}
        </a>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {repo.language ? <Badge>{repo.language}</Badge> : null}
          {pushed ? <span>Última actualización: {pushed}</span> : null}
        </span>
      </div>
      <p className="text-sm wrap-break-word text-ink-2">{repo.description || "Sin descripción en GitHub."}</p>
      {doubts.map((doubt) => (
        <p key={doubt} className="text-xs text-amber-300" data-github-doubt>
          {doubt}
        </p>
      ))}

      {open ? (
        <div className="space-y-3 border-t border-rule pt-3">
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`gh-name-${repo.name}`}>
              Nombre del proyecto
            </label>
            <Input id={`gh-name-${repo.name}`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor={`gh-said-${repo.name}`}>
              ¿Qué hiciste vos en este proyecto?
            </label>
            <Textarea id={`gh-said-${repo.name}`} rows={3} value={said} maxLength={800} placeholder="Con tus palabras: lo que hiciste, no lo que hace el programa" onChange={(event) => setSaid(event.target.value)} />
          </div>
          {readme === null ? (
            <Button type="button" variant="ghost" compact onClick={() => void showReadme()}>
              Ver qué dice su README
            </Button>
          ) : readme === "none" ? (
            <p className="text-xs text-ink-3">No tiene README, o no dice nada que se pueda mostrar.</p>
          ) : "reason" in readme ? (
            <p role="alert" className="text-xs text-amber-300">
              {failureText(readme)}
            </p>
          ) : (
            <div className="space-y-1 text-xs text-ink-3" data-github-readme>
              <p>Lo que dice su README, para que te acuerdes (no lo copiamos a tu perfil):</p>
              <p className="text-ink-2">{[readme.title, readme.summary].filter(Boolean).join(" — ")}</p>
            </div>
          )}
          {repo.language ? (
            <Checkbox checked={withLanguage} onChange={(event) => setWithLanguage(event.target.checked)} label={`Poner «${repo.language}» como tecnología del proyecto (según GitHub). No se agrega a tus habilidades.`} />
          ) : null}
          {problem ? (
            <p role="alert" className="text-xs text-amber-300">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" compact onClick={add} disabled={!name.trim() || !said.trim()}>
              Agregar a mis proyectos
            </Button>
            <Button type="button" variant="ghost" compact onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" compact onClick={() => setOpen(true)}>
            Es mío, agregarlo
          </Button>
          <Button type="button" variant="ghost" compact onClick={onSkip}>
            Ahora no
          </Button>
        </div>
      )}
    </li>
  );
}

export function GithubImport({ profile, entry = "button" }: { profile: StoredProfile; entry?: "button" | "line" }) {
  const on = useExperiment("github_projects");
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<GithubReading | null>(null);
  const [failure, setFailure] = useState<GithubFailure | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!on) return null;

  const search = async () => {
    setBusy(true);
    setFailure(null);
    setReading(null);
    setSkipped(new Set());
    setShowAll(false);
    const result = await readRepos(user);
    setBusy(false);
    if (result.ok) setReading(result.reading);
    else setFailure(result.failure);
  };

  const close = () => {
    setOpen(false);
    setReading(null);
    setFailure(null);
    setUser("");
  };

  if (!open) {
    return (
      <div className="space-y-2" data-github-import data-github-entry={entry}>
        {entry === "button" ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Traer mis proyectos de GitHub
          </Button>
        ) : (
          <p className="text-xs text-ink-3">
            Si tenés proyectos en GitHub, también podés{" "}
            <button type="button" onClick={() => setOpen(true)} className="underline decoration-white/30 underline-offset-4 hover:text-ink hover:decoration-white pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5">
              traerlos de ahí
            </button>
            .
          </p>
        )}
        {notice ? (
          <p role="status" className="text-xs text-ink-2">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  // The ones already in the profile are not offered again.
  const { proposals, forks } = reading ? propose(reading.repos) : { proposals: [], forks: 0 };
  const offered = proposals.filter((proposal) => !hasProjectAt(profile, proposal.repo.url) && !skipped.has(proposal.repo.fullName));
  const visible = showAll ? offered : offered.slice(0, SHOWN);

  return (
    <div className="space-y-4 border border-rule p-4" data-github-import>
      <div className="space-y-1">
        <p className={LABEL}>Tus proyectos de GitHub</p>
        <p className="text-xs text-ink-3" data-github-notice>
          Le preguntamos a GitHub desde tu navegador por los repositorios públicos del usuario que escribas. GitHub ve ese usuario y tu dirección de internet; nosotros no vemos nada de esto, y no usamos tu cuenta ni
          pedimos permisos. Sin cuenta, GitHub deja hacer {GITHUB_HOURLY_LIMIT} consultas por hora. No mostramos estrellas ni cantidad de commits, y los lenguajes no se convierten en habilidades.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (user.trim() && !busy) void search();
        }}
      >
        <div className="min-w-48 flex-1">
          <label className={`mb-1 block ${LABEL}`} htmlFor="github-user">
            Tu usuario de GitHub
          </label>
          <Input id="github-user" value={user} maxLength={120} placeholder="ana-perez" autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={(event) => setUser(event.target.value)} />
        </div>
        <Button type="submit" disabled={!user.trim() || busy} aria-busy={busy}>
          {busy ? "Buscando…" : "Buscar"}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cerrar
        </Button>
      </form>

      {failure ? (
        <p role="alert" className="text-sm text-amber-300" data-github-problem>
          {failureText(failure)}
        </p>
      ) : null}

      {reading ? (
        <div className="space-y-3">
          {offered.length === 0 ? (
            <p className="text-sm text-ink-2" data-github-empty>
              {reading.repos.length === 0 ? `GitHub no muestra repositorios públicos de ${reading.login}.` : "No hay repositorios nuevos para ofrecerte."}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((proposal) => (
                <ProposalCard
                  key={proposal.repo.fullName}
                  proposal={proposal}
                  onSkip={() => setSkipped((current) => new Set(current).add(proposal.repo.fullName))}
                  onAdded={(name) => setNotice(`Agregamos «${name}» a tus proyectos.`)}
                />
              ))}
            </ul>
          )}
          {offered.length > SHOWN && !showAll ? (
            <Button type="button" variant="ghost" compact onClick={() => setShowAll(true)}>
              Ver los otros {offered.length - SHOWN}
            </Button>
          ) : null}
          <p className="text-xs text-ink-3">
            {forks > 0 ? `Dejamos afuera ${forks} ${forks === 1 ? "repositorio que es una copia" : "repositorios que son copias"} de otro. ` : ""}
            {reading.remaining !== null ? `A GitHub le quedan ${reading.remaining} consultas de las ${GITHUB_HOURLY_LIMIT} de esta hora.` : ""}
          </p>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-ink-2">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
