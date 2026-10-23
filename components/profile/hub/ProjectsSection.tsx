"use client";

import { useState } from "react";
import { Button, CollapsibleCard, Input } from "@/components/ui";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import { removeProject } from "@/lib/onboarding/review";
import { editFieldAt, isBlankText } from "@/lib/profile/edit";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { moveEntity } from "@/lib/profile/entities";
import type { StoredProject, StoredProfile } from "@/lib/schemas/profile-v2";
import { TagsCell, TextCell, edit, editWithUndo } from "./cells";
import { EntityCard } from "./EntityCard";
import { BackingNote, EvidenceBlock } from "./EvidenceBlock";
import { GithubImport } from "./GithubImport";
import { ImproveSection } from "./ImproveSection";
import { ImproveWithAi } from "./ImproveWithAi";
import { hasTechnicalSignals } from "@/lib/github/signals";
import { useRemoval, type OnRemoved } from "./removal";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";

function ProjectCard({ profile, project, index, total, open, onRemoved }: { profile: StoredProfile; project: StoredProject; index: number; total: number; open: boolean; onRemoved: OnRemoved }) {
  const remove = useRemoval(onRemoved);
  const at = ["projects", project.id];
  return (
    <EntityCard open={open} title={project.name.value} subtitle={project.url.value} badges={<ProvenanceBadge status={project.name.status} source={project.name.source} />}>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextCell label="Nombre" field={project.name} path={[...at, "name"]} maxLength={120} />
        <TextCell label="Enlace" field={project.url} path={[...at, "url"]} maxLength={300} />
      </div>
      <TextCell label="Descripción" field={project.description} path={[...at, "description"]} multiline rows={3} maxLength={800} />
      <ImproveWithAi
        kind="project"
        text={project.description.value}
        onUse={(improved) => editWithUndo([...at, "description"], (draft) => void editFieldAt(draft, [...at, "description"], improved, isBlankText))}
      />
      <TagsCell label="Tecnologías o herramientas" field={project.tags} path={[...at, "tags"]} placeholder="Escribí y presioná Enter" />
      {/* What shows this project, when that is switched on: nothing is drawn otherwise. */}
      <EvidenceBlock profile={profile} target={{ kind: "project", id: project.id }} />
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        <Button type="button" variant="ghost" aria-label="Subir este proyecto" disabled={index === 0} onClick={() => edit((draft) => void moveEntity(draft, "projects", project.id, -1))} className="px-2 py-1 pointer-coarse:min-w-11">
          ↑
        </Button>
        <Button type="button" variant="ghost" aria-label="Bajar este proyecto" disabled={index === total - 1} onClick={() => edit((draft) => void moveEntity(draft, "projects", project.id, 1))} className="px-2 py-1 pointer-coarse:min-w-11">
          ↓
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="danger" onClick={() => remove((draft) => removeProject(draft, project.id))}>
          Quitar
        </Button>
      </div>
    </EntityCard>
  );
}

export function ProjectsSection({ profile, onRemoved, defaultOpen = false }: { profile: StoredProfile; onRemoved: OnRemoved; defaultOpen?: boolean }) {
  const [name, setName] = useState("");
  /** A project just added is open, so the rest of its data is in front of whoever named it. */
  const [added, setAdded] = useState<string | null>(null);
  // Where the profile speaks of code, the way to GitHub is a button; where it does not, it is a line under the form that adds a project, and nobody is shown a button for something their profile never mentioned.
  const technical = hasTechnicalSignals(profile);
  return (
    <CollapsibleCard id={SECTION_ID.projects} title="Proyectos · opcional" defaultOpen={defaultOpen} className={`space-y-4 ${ANCHOR}`}>
      <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">Si tenés poca experiencia laboral, esto ocupa su lugar.</p>
      <ImproveSection profile={profile} section="projects" />
      {profile.projects.length > 0 ? <BackingNote kind="project" /> : null}
      <div className="space-y-3">
        {profile.projects.map((project, index) => (
          <ProjectCard key={project.id} profile={profile} project={project} index={index} total={profile.projects.length} open={project.id === added} onRemoved={onRemoved} />
        ))}
      </div>
      {/* The public repositories of a GitHub user, read from the browser, when that is switched on: nothing is drawn otherwise. */}
      {technical ? <GithubImport profile={profile} /> : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const id = crypto.randomUUID();
          edit((draft) => void addEntry(draft, { ...blankForm("project"), what: name }, { newId: () => id, now: new Date().toISOString() }));
          setAdded(id);
          setName("");
        }}
      >
        <div className="min-w-48 flex-1">
          <Input aria-label="Nombre del proyecto nuevo" value={name} maxLength={120} placeholder="Nombre del proyecto" onChange={(event) => setName(event.target.value)} />
        </div>
        <Button type="submit" variant="secondary" disabled={!name.trim()}>
          + Agregar proyecto
        </Button>
      </form>
      {technical ? null : <GithubImport profile={profile} entry="line" />}
    </CollapsibleCard>
  );
}
