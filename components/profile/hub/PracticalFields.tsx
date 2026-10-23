"use client";

import { useId, useState } from "react";
import { Button, Checkbox, Input } from "@/components/ui";
import { confirmPractical } from "@/lib/profile/credentials";
import { conditionsReview, monthOf, standingAt } from "@/lib/profile/currency";
import { editFieldAt } from "@/lib/profile/edit";
import { isPracticalEmpty } from "@/lib/profile/practical-facts";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { CredentialPhoto } from "./CredentialPhoto";
import { LABEL, edit } from "./cells";

type Practical = StoredProfile["legacy"]["practical"]["value"];

/**
 * How the person can work — when, whether they drive, whether they would move — edited where it stands. It lives in the profile
 * and, because it is the one thing in it that changes with the season, in the question that asks whether it still holds
 * (`ConditionsControl`): the same fields, in the same place, so what is changed there is what is shown here.
 *
 * Below the fields, the last time the person said it was so — a date, never how long ago — and, once it has gone as long as it takes
 * to ask, the one tap that says it still is. When it is switched on, a way to read the class from the licence's photo
 * (`CredentialPhoto`), which proposes and never saves by itself.
 */
export function PracticalFields({ profile, now }: { profile: StoredProfile; now: Date }) {
  const field = profile.legacy.practical;
  const baseId = useId();
  const [values, setValues] = useState<Practical>(field.value);
  // What is stored can change from somewhere else — the question that asks whether it still holds, the history, a photo of the card — and
  // what is shown has to follow. It followed by remounting the whole block (a `key` of its own value), which also remounted it at every
  // edit made here: the box just touched was replaced by a new one, and a keyboard went back to the top of the page after each tick. It is
  // now the value that is compared and the state that is set, in place.
  const storedKey = JSON.stringify(field.value);
  const [syncedKey, setSyncedKey] = useState(storedKey);
  if (storedKey !== syncedKey) {
    setSyncedKey(storedKey);
    setValues(field.value);
  }
  const write = (next: Practical) => {
    setValues(next);
    edit((draft) => void editFieldAt(draft, ["legacy", "practical"], next, isPracticalEmpty));
  };
  // The label beside the box and not around it: a box inside the label took the label's letters, bold and spaced, for what was typed.
  const text = (key: "availability" | "driverLicense" | "workEligibility", label: string, span?: boolean) => (
    <div className={span ? "sm:col-span-2" : undefined}>
      <label htmlFor={`${baseId}-${key}`} className={`mb-1 block ${LABEL}`}>
        {label}
      </label>
      <Input
        id={`${baseId}-${key}`}
        value={values[key]}
        maxLength={key === "driverLicense" ? 80 : 200}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })}
        onBlur={() => write(values)}
        autoComplete="off"
      />
    </div>
  );

  const confirmedAt = standingAt(field);
  const asked = conditionsReview(profile, now) !== null;

  return (
    <div className="space-y-4">
      <p className={LABEL}>Lo práctico</p>
      <p className="text-sm text-ink-3">En comercio, depósito, gastronomía y logística esto suele definir la búsqueda.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {text("availability", "Disponibilidad horaria", true)}
        {text("driverLicense", "Licencia de conducir")}
        <div className="sm:col-span-2">
          <CredentialPhoto
            kind="license"
            withExpiry={false}
            current={values.driverLicense}
            onUse={({ license }) => {
              const wasLicense = values.driverLicense;
              if (license) edit((draft) => void editFieldAt(draft, ["legacy", "practical"], { ...values, driverLicense: license.slice(0, 80) }, isPracticalEmpty));
              // Its way back gives back only what the photo gave, over what is there when it is asked for — what was edited since stays.
              return () =>
                edit((draft) => {
                  if (license) editFieldAt(draft, ["legacy", "practical"], { ...draft.legacy.practical.value, driverLicense: wasLicense }, isPracticalEmpty);
                });
            }}
          />
        </div>
        {text("workEligibility", "Permiso de trabajo", true)}
      </div>
      <div className="space-y-3">
        <Checkbox label="Tengo vehículo propio" checked={values.ownVehicle} onChange={(event) => write({ ...values, ownVehicle: event.target.checked })} />
        <Checkbox label="Puedo mudarme por trabajo" checked={values.willingToRelocate} onChange={(event) => write({ ...values, willingToRelocate: event.target.checked })} />
      </div>
      {/* A date and not an absence: «lo confirmaste en junio», and not «hace tres meses que no lo mirás». */}
      {confirmedAt && !isPracticalEmpty(values) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-3" data-practical-confirmed>
          <span>Lo confirmaste por última vez en {monthOf(confirmedAt)}.</span>
          {asked ? (
            <Button type="button" variant="ghost" compact onClick={() => edit((draft) => void confirmPractical(draft))}>
              Sigue igual
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
