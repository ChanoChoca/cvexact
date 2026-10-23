"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui";
import { formatRange, jobsByRecency, studiesByRecency } from "@/lib/profile/timeline";
import { describePractical } from "@/lib/profile/practical-facts";
import { factToBullet, languageLevelText } from "@/lib/profile/project";
import type { PreviewFactRef } from "@/lib/cv/from-profile";
import { isMeaningfulExperience, type Fact, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * One thing said, marked two different ways that never overlap in practice:
 * `fresh` (just answered, in this session) gets the "Nuevo" badge; `focused`
 * (just asked for, by tapping its line in the preview) gets the same tint and
 * a scroll to bring it on screen, with no badge — it is not new, just asked for.
 * With `onOpen` the line is a button, for a panel whose lines lead to where they are edited.
 */
function FactLine({ fact, fresh, focused, onOpen }: { fact: Fact; fresh: boolean; focused: boolean; onOpen?: (() => void) | undefined }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const text = factToBullet(fact);
  const line = (
    <>
      <span aria-hidden className="text-ink-3">
        •
      </span>
      <span className="min-w-0 flex-1 wrap-break-word">{text}</span>
    </>
  );

  return (
    <li ref={ref} className={fresh || focused ? "-mx-2 flex items-start gap-2 bg-white/[0.06] px-2 py-1" : "flex items-start gap-2"}>
      {onOpen ? (
        <button type="button" aria-label={`Abrir en tu perfil: ${text}`} onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left hover:text-ink pointer-coarse:min-h-11 pointer-coarse:items-center">
          {line}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2">{line}</span>
      )}
      {fresh ? <Badge tone="good">Nuevo</Badge> : null}
    </li>
  );
}

/**
 * The profile as it is so far, beside the questions: the answer that was just given
 * shows up here, marked, so it is plain that what was said went somewhere. It is a
 * reading aid and not an editor — the facts are edited where they were confirmed,
 * and in the profile.
 */
export function ProfilePanel({
  profile,
  highlight,
  focusId,
  onFactClick,
}: {
  profile: StoredProfile;
  highlight: readonly string[];
  /** A fact to draw the eye to and scroll into view — from tapping its line in the CV preview, not from having just answered it: no "Nuevo" badge here, that word would be wrong. */
  focusId?: string | undefined;
  /** Makes each thing a job says a button that names it: the profile uses it to open the job it belongs to, as tapping a line in the CV did. */
  onFactClick?: ((ref: PreviewFactRef) => void) | undefined;
}) {
  const jobs = jobsByRecency(profile.experience.filter(isMeaningfulExperience));
  const languages = profile.languages.filter((language) => language.name.value.trim());
  // What is not a job is still what the person has: a project is the whole of someone's experience, and its answer goes here.
  const projects = profile.projects.filter((project) => project.name.value.trim());
  // The studies the person said something about: for someone with no work yet, what they say of them is what there is.
  const studies = studiesByRecency(profile.education.filter((entry) => (entry.institution.value.trim() || entry.degree.value.trim()) && entry.highlights.value.some((point) => point.trim())));
  const certifications = profile.certifications.filter((cert) => cert.name.value.trim());
  const practical = describePractical(profile.legacy.practical.value);
  // Who it is and how to reach them: the head of the page the CV would be, said before anything it holds.
  const { contact } = profile;
  const name = contact.fullName.value.trim();
  const reach = [contact.email.value, contact.phone.value, [contact.city.value, contact.country.value].map((part) => part.trim()).filter(Boolean).join(", ")].map((part) => part.trim()).filter(Boolean);
  const links = contact.links.value;

  return (
    <aside aria-label="Tu perfil" className="space-y-6">
      <h2 className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Tu perfil</h2>

      {name || reach.length > 0 || links.length > 0 ? (
        <div className="space-y-1" data-panel-contact>
          {name ? <p className="text-[17px] text-ink wrap-break-word">{name}</p> : null}
          {reach.length > 0 ? <p className="text-sm text-ink-2 wrap-break-word">{reach.join(" · ")}</p> : null}
          {links.length > 0 ? <p className="text-xs text-ink-3 wrap-break-word">{links.map((link) => link.label || link.url).join(" · ")}</p> : null}
        </div>
      ) : null}

      {jobs.length === 0 && projects.length === 0 && studies.length === 0 ? <p className="text-sm text-ink-3">Todavía no hay nada.</p> : null}

      {jobs.map((job) => {
        const said = job.facts.filter((fact) => fact.kind !== "tool" && fact.text.trim());
        return (
          <div key={job.id} className="space-y-2 border-t border-rule pt-4">
            <div>
              <p className="text-[15px] text-ink">{job.company.value || job.role.value}</p>
              {job.company.value && job.role.value ? <p className="text-sm text-ink-2">{job.role.value}</p> : null}
              <p className="text-xs text-ink-3">{formatRange(job.start.value, job.end.value)}</p>
            </div>
            {said.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-ink-2">
                {said.map((fact) => (
                  <FactLine key={fact.id} fact={fact} fresh={highlight.includes(fact.id)} focused={fact.id === focusId} onOpen={onFactClick ? () => onFactClick({ experienceId: job.id, factId: fact.id }) : undefined} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-3">Sin detalle todavía.</p>
            )}
          </div>
        );
      })}

      {studies.length > 0 ? (
        <div className="space-y-3 border-t border-rule pt-4">
          <p className="text-xs text-ink-3">Estudios</p>
          {studies.map((study) => {
            const fresh = highlight.includes(study.id);
            return (
              <div key={study.id} className={fresh ? "-mx-2 space-y-1 bg-white/[0.06] px-2 py-1" : "space-y-1"}>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[15px] text-ink wrap-break-word">{study.degree.value || study.institution.value}</p>
                  {fresh ? <Badge tone="good">Nuevo</Badge> : null}
                </div>
                {study.degree.value && study.institution.value ? <p className="text-sm text-ink-2">{study.institution.value}</p> : null}
                <ul className="space-y-1 text-sm text-ink-2">
                  {study.highlights.value
                    .filter((point) => point.trim())
                    .map((point, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span aria-hidden className="text-ink-3">
                          •
                        </span>
                        <span className="min-w-0 flex-1 wrap-break-word">{point}</span>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {projects.length > 0 ? (
        <div className="space-y-3 border-t border-rule pt-4">
          <p className="text-xs text-ink-3">Proyectos</p>
          {projects.map((project) => {
            const fresh = highlight.includes(project.id);
            return (
              <div key={project.id} className={fresh ? "-mx-2 space-y-1 bg-white/[0.06] px-2 py-1" : "space-y-1"}>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[15px] text-ink wrap-break-word">{project.name.value}</p>
                  {fresh ? <Badge tone="good">Nuevo</Badge> : null}
                </div>
                {project.description.value.trim() ? (
                  <p className="text-sm text-ink-2 wrap-break-word">{project.description.value}</p>
                ) : (
                  <p className="text-xs text-ink-3">Sin detalle todavía.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {profile.skills.length > 0 ? (
        <div className="space-y-2 border-t border-rule pt-4">
          <p className="text-xs text-ink-3">Habilidades</p>
          <p className="text-sm text-ink-2">{profile.skills.map((skill) => skill.name.value).join(" · ")}</p>
        </div>
      ) : null}

      {languages.length > 0 ? (
        <div className="space-y-2 border-t border-rule pt-4">
          <p className="text-xs text-ink-3">Idiomas</p>
          <p className="text-sm text-ink-2">
            {languages.map((language) => [language.name.value, languageLevelText(language)].filter(Boolean).join(" ")).join(" · ")}
          </p>
        </div>
      ) : null}

      {certifications.length > 0 ? (
        <div className="space-y-2 border-t border-rule pt-4">
          <p className="text-xs text-ink-3">Certificaciones</p>
          <ul className="space-y-1 text-sm text-ink-2">
            {certifications.map((cert) => (
              <li key={cert.id} className="wrap-break-word">
                {[cert.name.value.trim(), cert.issuer.value.trim()].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {practical ? (
        <div className={highlight.includes("practical") ? "-mx-2 space-y-2 border-t border-rule bg-white/[0.06] px-2 pt-4 pb-1" : "space-y-2 border-t border-rule pt-4"}>
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs text-ink-3">Lo práctico</p>
            {highlight.includes("practical") ? <Badge tone="good">Nuevo</Badge> : null}
          </div>
          <p className="text-sm text-ink-2 wrap-break-word">{practical}</p>
        </div>
      ) : null}
    </aside>
  );
}
