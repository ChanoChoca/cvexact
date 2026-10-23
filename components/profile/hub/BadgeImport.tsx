"use client";

import { useRef, useState } from "react";
import { Badge as Tag, Button, Input, Textarea } from "@/components/ui";
import { EXPIRY_YEARS_AHEAD, MonthYearPicker } from "@/components/onboarding/MonthYearPicker";
import { BADGE_FAILURE, MAX_BADGE_CHARS, describeSignature, readBadge, type Badge } from "@/lib/evidence/badge";
import type { DateValue } from "@/lib/profile/dates";
import { addCertification } from "@/lib/profile/entities";
import { SIGNATURE_MEANS, addEvidence } from "@/lib/profile/evidence";
import { fold } from "@/lib/parse/dictionaries";
import { useExperiment } from "@/lib/use-experiment";
import { LABEL, edit } from "./cells";
import type { StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * «Importar una insignia»: an Open Badges 3.0 credential, from its file or from its text (e5, O20). It is read in this browser — nothing is
 * requested, not the credential's page and not the key it is signed with — and shown for the person to look at before it becomes anything: a
 * certification with the fields of the badge in boxes they can change, and, when the signature could be checked with the key that comes in the
 * file, a mark that says so and says what that does and does not mean (`SIGNATURE_MEANS`).
 *
 * Switched off, it draws nothing (`lib/experiments.ts`).
 */

const THIS_YEAR = new Date().getFullYear();

const hasDate = (date: DateValue): boolean => date.year !== undefined;

function Review({ badge, profile, onDone, onCancel }: { badge: Badge; profile: StoredProfile; onDone: (message: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(badge.name);
  const [issuer, setIssuer] = useState(badge.issuer);
  const [date, setDate] = useState<DateValue>(badge.issuedOn);
  const [expires, setExpires] = useState<DateValue>(badge.validUntil);
  const [problem, setProblem] = useState<string | null>(null);
  const says = describeSignature(badge.signature);

  const add = () => {
    if (!name.trim()) return;
    if (profile.certifications.some((cert) => fold(cert.name.value) === fold(name))) {
      setProblem("Ya tenés una certificación con ese nombre: agregale el respaldo desde su tarjeta.");
      return;
    }
    edit((draft) => {
      const cert = addCertification(draft, { name, issuer, date, expires });
      if (!cert) return;
      const target = { kind: "certification" as const, id: cert.id };
      // What the file shows, beside the certification: a signature that checked, or — failing that — the credential's own page, kept and not opened.
      if (badge.signature.state === "valid") {
        addEvidence(draft, target, {
          type: "signed",
          via: "badge",
          url: badge.pageUrl,
          check: { alg: badge.signature.alg, keyFrom: badge.signature.keyFrom, at: new Date().toISOString() },
        });
      } else if (badge.pageUrl) {
        addEvidence(draft, target, { type: "link", via: "badge", url: badge.pageUrl });
      }
    });
    onDone("Agregamos la certificación.");
  };

  return (
    <div className="space-y-4 border border-rule p-4" data-badge-review>
      <p className="text-sm text-ink-2">Esto es lo que dice el archivo. Revisalo y corregí lo que haga falta antes de agregarlo.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={`mb-1 block ${LABEL}`} htmlFor="badge-name">
            Certificación
          </label>
          <Input id="badge-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className={`mb-1 block ${LABEL}`} htmlFor="badge-issuer">
            Emisor
          </label>
          <Input id="badge-issuer" value={issuer} maxLength={120} placeholder="Quién la dio" onChange={(event) => setIssuer(event.target.value)} />
        </div>
        <MonthYearPicker label="Fecha" value={date} onChange={setDate} />
        <MonthYearPicker label="Vence (opcional)" value={expires} onChange={setExpires} newest={THIS_YEAR + EXPIRY_YEARS_AHEAD} oldest={THIS_YEAR - 10} />
      </div>
      {!hasDate(date) ? <p className="text-xs text-ink-3">El archivo no trae la fecha: si la sabés, elegila.</p> : null}
      <div className="space-y-1" data-badge-signature={badge.signature.state}>
        <Tag tone={says.tone === "good" ? "good" : says.tone === "warn" ? "warn" : "neutral"}>{badge.signature.state === "valid" ? "Firma" : "Sin firma comprobada"}</Tag>
        <p className="text-sm text-ink-2">{says.text}</p>
        {badge.signature.state === "valid" ? <p className="text-xs text-ink-3">{SIGNATURE_MEANS}</p> : null}
        {badge.pageUrl ? <p className="text-xs wrap-break-word text-ink-3">La insignia tiene una página propia ({badge.pageUrl}). La guardamos como enlace, pero no la abrimos ni la consultamos.</p> : null}
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-amber-300">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={add} disabled={!name.trim()}>
          Agregar a mis certificaciones
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function BadgeImport({ profile }: { profile: StoredProfile }) {
  const on = useExperiment("open_badges");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [badge, setBadge] = useState<Badge | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  if (!on) return null;

  const reset = () => {
    setOpen(false);
    setText("");
    setBadge(null);
    setProblem(null);
  };

  const read = async (content: string) => {
    const result = await readBadge(content);
    if (!result.ok) {
      setBadge(null);
      setProblem(BADGE_FAILURE[result.reason]);
      return;
    }
    setProblem(null);
    setBadge(result.badge);
  };

  const fromFile = async (file: File) => {
    // A badge can carry its own image inside it, but not a file this big: it is not a badge, and reading it would only hold the page.
    if (file.size > MAX_BADGE_CHARS * 2) {
      setBadge(null);
      setProblem(BADGE_FAILURE.big);
      return;
    }
    const content = await file.text();
    setText(content.length > 20_000 ? "" : content);
    await read(content);
  };

  if (!open) {
    return (
      <div className="space-y-2" data-badge-import>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Importar una insignia
        </Button>
        {notice ? (
          <p role="status" className="text-xs text-ink-2">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 border border-rule p-4" data-badge-import>
      <div className="space-y-1">
        <p className={LABEL}>Importar una insignia</p>
        <p className="text-xs text-ink-3">
          Una insignia de Open Badges 3.0, como archivo .json o como texto firmado. Se lee en este navegador: no le pedimos nada a nadie, ni a quien la dio.
          Todavía no leemos una insignia que viene dentro de una imagen.
        </p>
      </div>
      {badge ? (
        <Review
          badge={badge}
          profile={profile}
          onCancel={reset}
          onDone={(message) => {
            reset();
            setNotice(message);
          }}
        />
      ) : (
        <>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor="badge-file">
              El archivo
            </label>
            <input
              ref={picker}
              id="badge-file"
              type="file"
              accept=".json,.jwt,.txt,application/json,text/plain"
              className="block w-full text-sm text-ink-2 file:mr-3 file:border file:border-white/15 file:bg-transparent file:px-3 file:py-2 file:text-ink-2 pointer-coarse:min-h-11 pointer-coarse:file:py-3"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void fromFile(file);
                event.target.value = "";
              }}
            />
          </div>
          <div>
            <label className={`mb-1 block ${LABEL}`} htmlFor="badge-text">
              O pegá su contenido
            </label>
            <Textarea id="badge-text" rows={4} value={text} placeholder="{ … } o eyJ…" onChange={(event) => setText(event.target.value)} />
          </div>
          {problem ? (
            <p role="alert" className="text-xs text-amber-300" data-badge-problem>
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void read(text)}>
              Leer la insignia
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
