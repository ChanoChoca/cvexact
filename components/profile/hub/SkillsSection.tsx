"use client";

import { useState } from "react";
import { Button, CollapsibleCard, Input, Select } from "@/components/ui";
import { EXPIRY_YEARS_AHEAD, MonthYearPicker } from "@/components/onboarding/MonthYearPicker";
import { LEVEL_OPTIONS } from "@/lib/onboarding/questions";
import { removeCertification, removeLanguage, removeSkill } from "@/lib/onboarding/review";
import { setCertificationExpiry } from "@/lib/profile/credentials";
import { certificationVigencia, credentialReviews, expiryLine } from "@/lib/profile/currency";
import type { DateValue } from "@/lib/profile/dates";
import { addCertification, addLanguage, addSkill, setLanguageLevel } from "@/lib/profile/entities";
import { levelPhrase } from "@/lib/profile/language-levels";
import { SKILL_LEVELS, type CefrLevel, type SkillLevel, type StoredCertification, type StoredLanguage, type StoredProfile } from "@/lib/schemas/profile-v2";
import { upsertFieldAt } from "@/lib/profile/edit";
import { SKILL_LEVEL_LABEL } from "@/components/onboarding/QuestionControls";
import { BadgeImport } from "./BadgeImport";
import { DateCell, LABEL, TextCell, edit, useKept } from "./cells";
import { CredentialRenewal } from "./CredentialRenewal";
import { BackingNote, EvidenceBlock } from "./EvidenceBlock";
import { ImproveSection } from "./ImproveSection";
import { useRemoval, type OnRemoved } from "./removal";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";

/** Skills, languages and certifications: the short lists, each one line at a time. */

// --- Skills -----------------------------------------------------------------------------------

/** The level a tap gives: strong first, then regular use, then basic, and around again. Always the person's tap, never an inference. */
const nextLevel = (level: SkillLevel | undefined): SkillLevel => SKILL_LEVELS[level === undefined ? 0 : (SKILL_LEVELS.indexOf(level) + 1) % SKILL_LEVELS.length]!;

function Skills({ profile, onRemoved }: { profile: StoredProfile; onRemoved: OnRemoved }) {
  const [draft, setDraft] = useState("");
  // Once the person marks one, every skill offers the mark: with none marked, a button on each would be noise.
  const levelled = profile.skills.some((skill) => skill.level);
  const remove = useRemoval(onRemoved);
  const add = () => {
    if (!draft.trim()) return;
    edit((next) => void addSkill(next, draft));
    setDraft("");
  };
  return (
    <div className="space-y-3">
      <p className={LABEL}>Habilidades</p>
      {profile.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {profile.skills.map((skill) => (
            <li key={skill.id} className="inline-flex items-center gap-1 border border-rule bg-paper-2 py-1 pr-1 pl-2 text-sm text-ink-2">
              {skill.name.value}
              {levelled ? (
                <button
                  type="button"
                  aria-label={`Nivel de ${skill.name.value}: ${skill.level ? SKILL_LEVEL_LABEL[skill.level.value] : "sin marcar"}. Tocá para cambiarlo`}
                  onClick={() => {
                    const next = nextLevel(skill.level?.value);
                    edit((draft) => void upsertFieldAt(draft, ["skills", skill.id, "level"], next, () => false));
                  }}
                  className="px-1 text-xs text-ink-3 underline decoration-white/20 underline-offset-4 hover:text-ink"
                >
                  {skill.level ? SKILL_LEVEL_LABEL[skill.level.value] : "+ nivel"}
                </button>
              ) : null}
              <button type="button" aria-label={`Quitar ${skill.name.value}`} onClick={() => remove((draft) => removeSkill(draft, skill.id))} className="px-1 text-ink-3 hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Todavía no cargaste ninguna.</p>
      )}
      <Input
        aria-label="Agregar una habilidad"
        value={draft}
        placeholder="Escribí y presioná Enter"
        maxLength={80}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

// --- Languages -----------------------------------------------------------------------------------

const NO_LEVEL = "";

function levelText(language: StoredLanguage): string {
  const { cefr, raw } = language.level.value;
  return cefr ?? (raw ? `raw:${raw}` : NO_LEVEL);
}

function LanguageRow({ language, onRemoved }: { language: StoredLanguage; onRemoved: OnRemoved }) {
  const remove = useRemoval(onRemoved);
  const raw = language.level.value.raw;
  return (
    <li className="grid items-end gap-4 border-b border-rule pb-4 last:border-0 sm:grid-cols-[1fr_12rem_auto]">
      <TextCell label="Idioma" field={language.name} path={["languages", language.id, "name"]} maxLength={60} />
      <div>
        <label htmlFor={`level-${language.id}`} className={`mb-1 block ${LABEL}`}>
          Nivel
        </label>
        <Select
          id={`level-${language.id}`}
          value={levelText(language)}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith("raw:")) return;
            edit((draft) => void setLanguageLevel(draft, language.id, value === NO_LEVEL ? null : (value as CefrLevel)));
          }}
        >
          <option value={NO_LEVEL}>Sin nivel</option>
          {raw && !language.level.value.cefr ? <option value={`raw:${raw}`}>{raw}</option> : null}
          {LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {levelPhrase(option.value)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="button" variant="danger" onClick={() => remove((draft) => removeLanguage(draft, language.id))}>
        Quitar
      </Button>
    </li>
  );
}

/**
 * With `autoSave` there is no «Agregar» to press: the form is always there, and what it holds is given to the profile as it is left and kept in the form, so that a click that
 * missed a box costs nothing. «Agregar otro idioma» lets go of it and starts another; until then the language is not in the list above.
 */
function Languages({ profile, onRemoved, autoSave }: { profile: StoredProfile; onRemoved: OnRemoved; autoSave: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<CefrLevel | "">("");
  const [drafting, setDrafting] = useState<string | null>(null);
  const listed = profile.languages.filter((language) => language.id !== drafting);
  const put = (draft: StoredProfile) => addLanguage(draft, name, level || undefined)?.id ?? null;
  const kept = useKept({ list: "languages", id: drafting, setId: setDrafting, signature: JSON.stringify([name, level]), ready: name.trim() !== "", put });
  const startOver = () => {
    setName("");
    setLevel("");
  };
  return (
    <div className="space-y-4">
      <p className={LABEL}>Idiomas</p>
      {listed.length > 0 ? (
        <ul className="space-y-4">
          {listed.map((language) => (
            <LanguageRow key={language.id} language={language} onRemoved={onRemoved} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Todavía no cargaste ninguno.</p>
      )}
      {open || autoSave ? (
        <form
          className="space-y-4 border border-rule p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (autoSave || !name.trim()) return;
            edit((draft) => void put(draft));
            startOver();
            setOpen(false);
          }}
          {...(autoSave ? { onBlur: kept.onBlur } : {})}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input aria-label="Idioma" value={name} maxLength={60} placeholder="Idioma" onChange={(event) => setName(event.target.value)} />
            <Select aria-label="Nivel del idioma" value={level} onChange={(event) => setLevel(event.target.value as CefrLevel | "")}>
              <option value="">Sin nivel</option>
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {levelPhrase(option.value)}
                </option>
              ))}
            </Select>
          </div>
          {autoSave ? null : (
            <div className="flex gap-3">
              <Button type="submit" variant="secondary" disabled={!name.trim()}>
                Agregar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Agregar idioma
        </Button>
      )}
      {autoSave ? (
        // Outside the form, so that going to it from a box gives what is in the form to the profile first. Always there, so that giving it does not move it.
        <Button
          type="button"
          variant="secondary"
          disabled={!name.trim() && !drafting}
          onClick={() => {
            kept.save();
            kept.release();
            startOver();
          }}
        >
          + Agregar otro idioma
        </Button>
      ) : null}
    </div>
  );
}

// --- Certifications ------------------------------------------------------------------------------------

const THIS_YEAR = new Date().getFullYear();

/**
 * One certification or course, edited where it stands. For what lapses — a carnet, a registration — it can say until when it holds,
 * and the card says what that date means today («Vence en noviembre de 2026», «Venció en marzo de 2026»): a fact about the date, in the
 * words of a date, and not a verdict on the person.
 */
function CertificationRow({ profile, cert, onRemoved, now }: { profile: StoredProfile; cert: StoredCertification; onRemoved: OnRemoved; now: Date }) {
  const remove = useRemoval(onRemoved);
  const at = ["certifications", cert.id];
  const expires = cert.expires?.value ?? {};
  const line = expiryLine(cert.expires?.value, now);
  const toReview = certificationVigencia(profile, cert.id, now) === "to_review";
  // Near or past its date and not set aside: the question that «Para revisar» asks of it, asked here too.
  const renewal = credentialReviews(profile, now).find((review) => review.subject.kind === "certification" && review.subject.id === cert.id);
  return (
    <li className="space-y-4 border-b border-rule pb-4 last:border-0" data-certification={cert.id}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextCell label="Certificación" field={cert.name} path={[...at, "name"]} maxLength={160} />
        <TextCell label="Emisor" field={cert.issuer} path={[...at, "issuer"]} maxLength={120} />
        <DateCell label="Fecha" field={cert.date} path={[...at, "date"]} />
        <div>
          <MonthYearPicker
            label="Vence (opcional)"
            value={expires}
            newest={THIS_YEAR + EXPIRY_YEARS_AHEAD}
            oldest={THIS_YEAR - 10}
            onChange={(date) => edit((draft) => void setCertificationExpiry(draft, cert.id, date))}
          />
          {/* Said under the date it is about, in the date's own words: «Venció en marzo de 2026», and not how long ago that was. */}
          {line ? (
            <p className={`mt-1 text-xs ${line.tone === "ok" ? "text-ink-3" : "text-amber-300"}`} data-expiry={line.tone}>
              {line.text}
              {toReview ? " · para revisar" : ""}
            </p>
          ) : null}
          {renewal ? <CredentialRenewal profile={profile} review={renewal} now={now} /> : null}
        </div>
      </div>
      {/* What shows this certification — a page, a register, the photo of the card — when that is switched on: nothing is drawn otherwise. The photo proposes, and nothing
          is kept until the person says so; what it gave can be taken back, and only that. */}
      <EvidenceBlock
        profile={profile}
        target={{ kind: "certification", id: cert.id }}
        photo={{
          kind: "expiry",
          onUse: ({ expires }) => {
            if (!expires) return;
            const before = cert.expires?.value ?? {};
            edit((draft) => void setCertificationExpiry(draft, cert.id, expires));
            return () => edit((draft) => void setCertificationExpiry(draft, cert.id, before));
          },
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1" />
        <Button type="button" variant="danger" onClick={() => remove((draft) => removeCertification(draft, cert.id))}>
          Quitar
        </Button>
      </div>
    </li>
  );
}

/**
 * With `autoSave` there is no «Agregar» to press: the form is always there, and what it holds is given to the profile as it is left and kept in the form, so that a click that
 * missed a box costs nothing. «Agregar otra certificación» lets go of it and starts another; until then the certification is not in the list above.
 */
function Certifications({ profile, onRemoved, now, autoSave }: { profile: StoredProfile; onRemoved: OnRemoved; now: Date; autoSave: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [date, setDate] = useState<DateValue>({});
  const [expires, setExpires] = useState<DateValue>({});
  /** Counts the times the form was started over: a new one forgets the month a picker was left on. */
  const [round, setRound] = useState(0);
  const [drafting, setDrafting] = useState<string | null>(null);
  const listed = profile.certifications.filter((cert) => cert.id !== drafting);
  const put = (draft: StoredProfile) => addCertification(draft, { name, issuer, date, expires })?.id ?? null;
  const kept = useKept({ list: "certifications", id: drafting, setId: setDrafting, signature: JSON.stringify([name, issuer, date, expires]), ready: name.trim() !== "", put });
  const startOver = () => {
    setName("");
    setIssuer("");
    setDate({});
    setExpires({});
    setRound((count) => count + 1);
  };
  return (
    <div className="space-y-4">
      <p className={LABEL}>Certificaciones</p>
      {/* What the respaldo and the photo of a credential are for: said once here, and not under every card. Nothing is drawn with both switched off. */}
      {listed.length > 0 ? <BackingNote kind="certification" /> : null}
      {listed.length > 0 ? (
        <ul className="space-y-4">
          {listed.map((cert) => (
            <CertificationRow key={cert.id} profile={profile} cert={cert} onRemoved={onRemoved} now={now} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Todavía no cargaste ninguna.</p>
      )}
      {open || autoSave ? (
        <form
          className="space-y-4 border border-rule p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (autoSave || !name.trim()) return;
            edit((draft) => void put(draft));
            startOver();
            setOpen(false);
          }}
          {...(autoSave ? { onBlur: kept.onBlur } : {})}
        >
          <div key={round} className="grid gap-4 sm:grid-cols-2">
            <Input aria-label="Certificación" value={name} maxLength={160} placeholder="Certificación" onChange={(event) => setName(event.target.value)} />
            <Input aria-label="Emisor" value={issuer} maxLength={120} placeholder="Emisor" onChange={(event) => setIssuer(event.target.value)} />
            <MonthYearPicker label="Fecha" value={date} onChange={setDate} />
            <MonthYearPicker label="Vence (opcional)" value={expires} onChange={setExpires} newest={THIS_YEAR + EXPIRY_YEARS_AHEAD} oldest={THIS_YEAR - 10} />
          </div>
          {autoSave ? null : (
            <div className="flex gap-3">
              <Button type="submit" disabled={!name.trim()}>
                Agregar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </form>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Agregar certificación
        </Button>
      )}
      {autoSave ? (
        // Outside the form, so that going to it from a box gives what is in the form to the profile first. Always there, so that giving it does not move it.
        <Button
          type="button"
          variant="secondary"
          disabled={!name.trim() && !drafting}
          onClick={() => {
            kept.save();
            kept.release();
            startOver();
          }}
        >
          + Agregar otra certificación
        </Button>
      ) : null}
      {/* A badge of Open Badges 3.0, read in this browser, when that is switched on: nothing is drawn otherwise. */}
      <BadgeImport profile={profile} />
    </div>
  );
}

export function SkillsSection({ profile, onRemoved, now, defaultOpen = false, autoSave = false }: { profile: StoredProfile; onRemoved: OnRemoved; now: Date; defaultOpen?: boolean; /** The forms to add a language and a certification have no «Agregar»: each is kept when the person leaves it. */ autoSave?: boolean }) {
  return (
    <CollapsibleCard id={SECTION_ID.skills} title="Habilidades, idiomas y certificaciones" defaultOpen={defaultOpen} className={`space-y-8 ${ANCHOR}`}>
      <ImproveSection profile={profile} section="skills" />
      <Skills profile={profile} onRemoved={onRemoved} />
      <Languages profile={profile} onRemoved={onRemoved} autoSave={autoSave} />
      <Certifications profile={profile} onRemoved={onRemoved} now={now} autoSave={autoSave} />
    </CollapsibleCard>
  );
}
