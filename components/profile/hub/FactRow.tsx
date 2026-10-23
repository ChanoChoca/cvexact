"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import { ProvenanceBadge } from "@/components/onboarding/ProvenanceBadge";
import { FigureControl } from "@/components/onboarding/QuestionControls";
import { useAiAvailability } from "@/lib/ai/availability";
import { metricFromAnswer, type FigureAnswer } from "@/lib/onboarding/answer";
import { editFactText, factPath, removeFact, setFactKind, setFactMetric, setFactTransferable } from "@/lib/profile/facts";
import { formatMetric } from "@/lib/profile/project";
import type { Fact, FactKind } from "@/lib/schemas/profile-v2";
import { edit, editWithUndo } from "./cells";
import { ImproveWithAi } from "./ImproveWithAi";
import { useRemoval, type OnRemoved } from "./removal";

const KINDS: ReadonlyArray<{ value: FactKind; label: string }> = [
  { value: "responsibility", label: "Tarea" },
  { value: "achievement", label: "Logro" },
  { value: "scope", label: "Alcance" },
  { value: "tool", label: "Herramienta" },
];

/** What a person can pick: tools live under «Herramientas y sistemas» and a scope comes from its own question. A line already one of those keeps its label, and can be turned into a Tarea or Logro. */
const PICKABLE: ReadonlyArray<FactKind> = ["responsibility", "achievement"];

/**
 * One thing done in a job, in the words it was said in: editable where it stands, with
 * where it came from, what kind of thing it is, and its figure — which sits beside the
 * words and is never written into them.
 */
function FactInner({ experienceId, fact, onRemoved, focused, fresh }: { experienceId: string; fact: Fact; onRemoved: OnRemoved; focused?: boolean; fresh?: boolean }) {
  const [text, setText] = useState(fact.text);
  const [figuring, setFiguring] = useState(false);
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = useAiAvailability();
  const remove = useRemoval(onRemoved);
  const shown = formatMetric(fact.metric);
  // «No lo sé», said to the question: the line is listed in «Si la encontrás», which leads here to add the number if it turns up.
  const unknownFigure = Boolean(fact.metric && "unknown" in fact.metric);
  const ref = useRef<HTMLLIElement>(null);
  // Tapped from the view of the profile, not just rendered here: bring it into view and
  // say so by scrolling to the block instead of just naming it. Focus goes with it —to the line, not to
  // its box, which would raise the keyboard—: it says where the page went to whoever cannot see it
  // move, and a sheet over the foot of the page opens to what it holds. The scroll waits a frame for
  // that sheet to have its height: centred in the little of it that peeks, the line would be half out of view.
  useEffect(() => {
    if (!focused) return;
    ref.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [focused]);

  const commit = () => {
    const clean = text.trim();
    if (clean && clean !== fact.text) edit((draft) => void editFactText(draft, experienceId, fact.id, clean));
    else setText(fact.text);
  };

  const saveFigure = (answer: FigureAnswer) => {
    const metric = metricFromAnswer(answer);
    if (!metric) {
      setError("Poné solo el número, con coma o punto para los decimales.");
      return;
    }
    edit((draft) => void setFactMetric(draft, experienceId, fact.id, metric));
    setFiguring(false);
    setError(null);
  };

  return (
    <li
      ref={ref}
      tabIndex={-1}
      className={
        "focus:outline-none " +
        (focused ? "-mx-2 space-y-2 border-b border-rule bg-white/[0.06] px-2 pt-2 pb-4 last:border-0 last:pb-2" : "space-y-2 border-b border-rule pb-4 last:border-0 last:pb-0")
      }
    >
      <Textarea aria-label="Lo que hacías" rows={2} maxLength={600} value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select
          aria-label="Qué tipo de cosa es"
          value={fact.kind}
          onChange={(event) => edit((draft) => void setFactKind(draft, experienceId, fact.id, event.target.value as FactKind))}
          className="w-36"
        >
          {KINDS.filter((kind) => PICKABLE.includes(kind.value) || kind.value === fact.kind).map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
        <ProvenanceBadge status={fact.status} source={fact.source} />
        {fresh ? <Badge tone="good">Nuevo</Badge> : null}
        {fact.transferable ? <Badge tone="good">Sirve para tu rumbo</Badge> : null}
        {shown ? <Badge tone="good">{fact.metric && "approx" in fact.metric && fact.metric.approx ? `≈ ${shown}` : shown}</Badge> : null}
        <span className="flex-1" />
        {/* Only where there is an AI to ask, and on what a CV prints as a line (`bulletCandidates`: not a tool): the action itself says what travels, and that is said once the person opens it and not under every line. */}
        {ai && ai.tone !== "bad" && fact.kind !== "tool" ? (
          <Button type="button" variant="ghost" aria-expanded={improving} onClick={() => setImproving((open) => !open)} className="px-2 py-1 text-xs">
            Mejorar con IA
          </Button>
        ) : null}
        {/* Only where there is a figure to change or one that was left for later: on any other line the number goes in the sentence, or the questions ask for it. */}
        {shown || unknownFigure || figuring ? (
          <Button type="button" variant="ghost" onClick={() => setFiguring((open) => !open)} className="px-2 py-1 text-xs">
            {shown ? "Cambiar cifra" : "Agregar cifra"}
          </Button>
        ) : null}
        {shown ? (
          <Button type="button" variant="ghost" onClick={() => edit((draft) => void setFactMetric(draft, experienceId, fact.id, null))} className="px-2 py-1 text-xs">
            Quitar cifra
          </Button>
        ) : null}
        {fact.transferable ? (
          <Button type="button" variant="ghost" onClick={() => edit((draft) => void setFactTransferable(draft, experienceId, fact.id, false))} className="px-2 py-1 text-xs">
            Ya no sirve para mi rumbo
          </Button>
        ) : null}
        <Button type="button" variant="danger" onClick={() => remove((draft) => removeFact(draft, experienceId, fact.id))} className="px-2 py-1 text-xs">
          Quitar
        </Button>
      </div>
      {improving ? (
        <ImproveWithAi
          kind="task"
          text={fact.text}
          label="Pedir una versión mejor"
          onUse={(improved) => editWithUndo(factPath(experienceId, fact.id), (draft) => void editFactText(draft, experienceId, fact.id, improved))}
        />
      ) : null}
      {figuring ? (
        <div className="border border-rule p-4">
          <FigureControl quote="" onSubmit={saveFigure} error={error} />
        </div>
      ) : null}
    </li>
  );
}

/** Re-mounted when the words change elsewhere — an undo, a restore — so the box never shows stale text. */
export function FactRow(props: { experienceId: string; fact: Fact; onRemoved: OnRemoved; focused?: boolean; fresh?: boolean }) {
  return <FactInner key={`${props.fact.id}:${props.fact.text}`} {...props} />;
}
