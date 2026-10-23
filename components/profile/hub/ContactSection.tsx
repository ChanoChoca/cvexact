"use client";

import { useId, useState } from "react";
import { CollapsibleCard, Textarea } from "@/components/ui";
import { editFieldAt, type Path } from "@/lib/profile/edit";
import { emailProblem } from "@/lib/profile/email";
import { linkLines, parseLinkLines } from "@/lib/profile/links";
import type { Field, StoredProfile } from "@/lib/schemas/profile-v2";
import { LABEL, TextCell, edit } from "./cells";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import { ANCHOR, SECTION_ID } from "@/components/profile/anchors";

type Links = StoredProfile["contact"]["links"];

function LinksInner({ field, path }: { field: Links; path: Path }) {
  const id = useId();
  const [text, setText] = useState(linkLines(field.value));
  const commit = () => {
    // Left as it is when nothing was typed: a profile that already holds more than the most it keeps would lose the rest on just passing through the box.
    if (text === linkLines(field.value)) return;
    const links = parseLinkLines(text);
    edit((draft) => void editFieldAt(draft, path, links, (list) => list.length === 0));
    setText(linkLines(links));
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className={LABEL}>
          Enlaces
        </label>
        <ProvenanceBadge status={field.status} source={field.source} />
      </div>
      <Textarea id={id} rows={3} value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      <p className="mt-1 text-xs text-ink-3">LinkedIn, GitHub, tu web… uno por línea, hasta 3.</p>
    </div>
  );
}

/** Re-mounted when the links change elsewhere, so it never shows stale ones. */
const LinksCell = (props: { field: Links; path: Path }) => <LinksInner key={`${JSON.stringify(props.field.value)}:${props.field.status}`} {...props} />;

/**
 * What a CV prints under a name, edited where it stands — in the profile, and on the review's own card
 * of contact details. An email that does not look like one is said so beside the box, and kept: the
 * message is a line of text, not a refusal.
 */
export function ContactFields({ contact }: { contact: StoredProfile["contact"] }) {
  const emailNote = emailProblem(contact.email.value);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextCell label="Nombre y apellido" field={contact.fullName} path={["contact", "fullName"]} maxLength={120} autoComplete="name" badge />
        <TextCell
          label="Email"
          field={contact.email}
          path={["contact", "email"]}
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={160}
          hint={emailNote ? <span className="text-amber-300">{emailNote}</span> : undefined}
        />
        <TextCell label="Teléfono" field={contact.phone} path={["contact", "phone"]} type="tel" autoComplete="tel" inputMode="tel" maxLength={40} />
        <span className="hidden sm:block" />
        <TextCell label="Ciudad" field={contact.city} path={["contact", "city"]} autoComplete="address-level2" maxLength={80} />
        <TextCell label="País" field={contact.country} path={["contact", "country"]} autoComplete="country-name" maxLength={80} />
      </div>
      <LinksCell field={contact.links} path={["contact", "links"]} />
    </div>
  );
}

/**
 * Who they are and how to find them — what a CV prints under a name — and the one
 * thing that is not printed: what they are after, which orders the questions, the job feed and the fit shown on /postular.
 * What the section holds and what the first step of the guided profile holds: the same fields, the same words.
 */
export function ContactBody({ profile }: { profile: StoredProfile }) {
  return (
    <>
      <ContactFields contact={profile.contact} />
      <TextCell
        label="Puesto que buscás"
        field={profile.objective as Field<string>}
        path={["objective"]}
        maxLength={160}
        hint="Ordena las preguntas, los empleos que te mostramos y lo que te avisamos al postularte."
      />
    </>
  );
}

export function ContactSection({ profile, defaultOpen = false }: { profile: StoredProfile; defaultOpen?: boolean }) {
  return (
    <CollapsibleCard id={SECTION_ID.contact} title="Datos personales" defaultOpen={defaultOpen} className={`space-y-5 ${ANCHOR}`}>
      <ContactBody profile={profile} />
    </CollapsibleCard>
  );
}
