"use client";

import { useId, useRef, useState } from "react";
import { AiAction } from "@/components/onboarding/AiAction";
import { Button, Checkbox } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import { useAiAvailability } from "@/lib/ai/availability";
import { improveManyWithAi } from "@/lib/onboarding/ai";
import { improvablesOf, type Improvable, type ImproveSectionName } from "@/lib/profile/improvable";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { loadStoredProfile } from "@/lib/storage/local";
import { editWithUndo } from "./cells";

/** What the model proposed for one text, next to what is written. */
export type Proposal = { id: string; label: string; before: string; after: string };

/**
 * Every proposal of the answer, each with a tick: the whole answer is read before anything changes, and what is not ticked is left as it is.
 * The checks that threw out a figure that was not there are already behind it (`checkImprovement`); what is left to this screen is the rest — a name
 * or a tool that was not there, a figure that was dropped — which only the person can see, written next to what they wrote.
 */
export function ImproveReview({ proposals, titleId, onUse, onClose }: { proposals: readonly Proposal[]; titleId: string; onUse: (chosen: Proposal[]) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(proposals.map((proposal) => proposal.id)));
  const picked = proposals.filter((proposal) => chosen.has(proposal.id));
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 id={titleId} className="text-[17px] text-ink">
          Tu IA propone {proposals.length === 1 ? "un cambio" : `${proposals.length} cambios`}
        </h2>
        <p className="text-sm text-ink-2">Leé cada uno contra lo que escribiste y elegí cuáles usar. Lo que no elijas queda como está.</p>
      </div>
      <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1" data-improve-review>
        {proposals.map((proposal) => (
          <li key={proposal.id} className="space-y-2 border border-rule p-3">
            <Checkbox label={`Usar: ${proposal.label}`} checked={chosen.has(proposal.id)} onChange={() => toggle(proposal.id)} />
            <div className="space-y-1">
              <p className="text-xs text-ink-3">Antes</p>
              <p className="text-sm wrap-break-word whitespace-pre-line text-ink-2">{proposal.before}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-ink-3">Después</p>
              <p className="text-sm wrap-break-word whitespace-pre-line text-ink">{proposal.after}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={picked.length === 0} onClick={() => onUse(picked)}>
          {picked.length === 0 ? "Usar" : `Usar ${picked.length}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Dejar como estaba
        </Button>
      </div>
    </div>
  );
}

const versions = (count: number) => `${count} ${count === 1 ? "versión" : "versiones"}`;

/**
 * «Mejorar con IA» at the top of a section of the profile: one call for all that the section holds that can be said better (`improvablesOf`), a window with what
 * came back next to what is written, and, for what the person ticks, one «Deshacer» that puts it all back.
 *
 * Nothing is drawn where there is no AI or nothing to improve, and a key is never asked for here: the boxes below are the way to say it better, as they always were.
 * That is decided before anything that needs the notices, so a section drawn where there are none (a page that is only read) is drawn as it always was.
 */
export function ImproveSection({ profile, section }: { profile: StoredProfile; section: ImproveSectionName }) {
  const ai = useAiAvailability();
  const items = improvablesOf(profile, section);
  if (items.length === 0 || !ai || ai.tone === "bad") return null;
  return <Improving items={items} section={section} />;
}

/**
 * The answer can take a while and the person can keep editing, so what is written is read again before it is replaced: a text that is no longer the one that was
 * sent is theirs, and is left alone.
 */
function Improving({ items, section }: { items: Improvable[]; section: ImproveSectionName }) {
  const toast = useToast();
  const titleId = useId();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  /** What `run` found, for `onDone`: `AiAction` hands over only that it worked. */
  const found = useRef<Proposal[]>([]);

  const use = (chosen: Proposal[]) => {
    setProposals(null);
    const undos: Array<() => boolean> = [];
    let used = 0;
    let left = 0;
    for (const proposal of chosen) {
      // Read again each time: the writes before this one may be what makes two skills one.
      const now = improvablesOf(loadStoredProfile(), section).find((item) => item.id === proposal.id);
      if (!now || now.text !== proposal.before || !now.allows(proposal.after)) {
        left += 1;
        continue;
      }
      for (const write of now.writes(proposal.after)) undos.push(editWithUndo(write.path, write.change));
      used += 1;
    }
    if (used === 0) {
      toast({ tone: "warn", message: "Esos textos cambiaron mientras tanto, así que los dejamos como están." });
      return;
    }
    toast({
      tone: "good",
      message: `Usamos ${versions(used)} de tu IA.${left > 0 ? ` ${left === 1 ? "Un texto había cambiado" : `${left} textos habían cambiado`} mientras tanto y quedó como estaba.` : ""}`,
      duration: 8000,
      action: {
        label: "Deshacer",
        onClick: () => {
          // The last written is the first taken back: a text written twice (the lines of one study) goes back through the state between.
          const failed = [...undos].reverse().filter((undo) => !undo()).length;
          if (failed > 0) toast({ tone: "warn", message: "Cambiaste algo después, así que lo que cambiaste lo dejamos como está." });
        },
      },
    });
  };

  return (
    <div data-improve-section={section}>
      <AiAction
        label="Mejorar con IA"
        busyLabel="Mejorando…"
        whenUnavailable="hide"
        run={async (signal) => {
          const byId = new Map(items.map((item) => [item.id, item]));
          const outcome = await improveManyWithAi(
            items.map(({ id, kind, text }) => ({ id, kind, text })),
            signal,
          );
          if (!outcome.ok) return outcome;
          found.current = outcome.result.flatMap(({ id, text }) => {
            const item = byId.get(id);
            return item && item.allows(text) ? [{ id, label: item.label, before: item.text, after: text }] : [];
          });
          return { ok: true };
        }}
        onDone={() => {
          if (found.current.length === 0) toast({ message: "Tu IA no le cambió nada: ya se lee bien." });
          else setProposals(found.current);
        }}
      />
      <Modal open={proposals !== null} onClose={() => setProposals(null)} labelledBy={titleId} className="max-w-2xl p-5">
        {proposals ? <ImproveReview proposals={proposals} titleId={titleId} onUse={use} onClose={() => setProposals(null)} /> : null}
      </Modal>
    </div>
  );
}
