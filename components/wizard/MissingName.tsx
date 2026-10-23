"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { editFieldAt, isBlankText } from "@/lib/profile/edit";
import { updateStoredProfile } from "@/lib/storage/local";

/**
 * The one thing a CV cannot be made without, asked for where it is missed. The first-run
 * flow lets the name stay empty — nothing there is required — and `/postular` cannot write a
 * CV without one, so the person arrives with a profile full of their career and a single
 * blank. Telling them to "load the profile" would be telling them they had not done what they
 * have done; this asks for the blank.
 */
export function MissingName() {
  const [name, setName] = useState("");
  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    updateStoredProfile((draft) => void editFieldAt(draft, ["contact", "fullName"], clean, isBlankText));
  };
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field label="Tu nombre y apellido" hint="Va en el encabezado del CV." className="min-w-56 flex-1">
        <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} />
      </Field>
      <Button type="submit" variant="secondary" disabled={!name.trim()}>
        Guardar
      </Button>
    </form>
  );
}
