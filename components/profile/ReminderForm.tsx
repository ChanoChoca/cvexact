"use client";

import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { DEFAULT_REMINDER_EVERY, REMINDER_EVERY, isReminderEvery, reminderFileName, reminderIcs, type ReminderEvery } from "@/lib/calendar/ics";
import { downloadText } from "@/lib/storage/download";
import { LABEL } from "./hub/cells";

/**
 * «Recordatorio en mi calendario» (e5, O16): the one reminder this product has, and it is the person's calendar's and not ours. They choose how
 * often, a file is made in this browser and handed to them, and whatever they open it with does the reminding; cvexact sends nothing, does not
 * know whether it was opened, and has no way to remind anyone by itself.
 *
 * Switched off, the menu that opens this does not offer it (`lib/experiments.ts`).
 */

const WORDS: Record<ReminderEvery, string> = { 1: "Todos los meses", 3: "Cada 3 meses", 6: "Cada 6 meses" };

export function ReminderForm({ onClose }: { onClose: () => void }) {
  const [every, setEvery] = useState<ReminderEvery>(DEFAULT_REMINDER_EVERY);
  const [done, setDone] = useState(false);

  const download = () => {
    downloadText(reminderFileName(every), reminderIcs({ origin: window.location.origin, every, now: new Date() }), "text/calendar;charset=utf-8");
    setDone(true);
  };

  return (
    <div className="space-y-4" data-reminder-form>
      <div className="flex items-start justify-between gap-4">
        <h2 id="reminder-title" className="text-[17px] text-ink">
          Recordatorio en tu calendario
        </h2>
        <Button variant="ghost" compact onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <p className="text-sm text-ink-2">
        Bajás un archivo (.ics) con un evento que se repite, con el enlace a tu perfil. Lo abrís con tu calendario y es él quien te avisa: cvexact no manda correos ni avisos, y no se entera de si lo abriste.
      </p>
      <div className="max-w-xs">
        <label htmlFor="reminder-every" className={`mb-1 block ${LABEL}`}>
          Cada cuánto
        </label>
        <Select
          id="reminder-every"
          value={every}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (isReminderEvery(value)) setEvery(value);
            setDone(false);
          }}
        >
          {REMINDER_EVERY.map((value) => (
            <option key={value} value={value}>
              {WORDS[value]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={download}>
          Bajar el recordatorio
        </Button>
      </div>
      {done ? (
        <p role="status" className="text-sm text-ink-2" data-reminder-done>
          Listo: abrí el archivo con tu calendario. Si algún día no lo querés más, borrá el evento ahí; bajarlo de nuevo no lo duplica.
        </p>
      ) : null}
    </div>
  );
}
