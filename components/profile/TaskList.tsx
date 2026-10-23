"use client";

import Link from "next/link";
import { Badge, ButtonLink } from "@/components/ui";
import { SECTION_ID } from "@/components/profile/anchors";
import { pendingHref, type PendingItem } from "@/lib/onboarding/session";
import type { ProfileTask } from "@/lib/profile/tasks";

/**
 * What a row says about itself when the list does not already: the list is of what was left for later, and a pill that says so on each row of it says
 * nothing. Only the two that are not that — a number to add if it turns up, and a job old enough to be left as it is — are marked.
 */
const KIND_LABEL: Partial<Record<PendingItem["kind"], string>> = {
  figure: "Si la encontrás",
  optional: "Opcional",
};

/** How many of the questions put off are listed before "y N más": the list is for picking one up, not for reading them all. */
const SHOWN = 5;

function Pending({ items }: { items: readonly PendingItem[] }) {
  const row = (item: PendingItem) => (
    <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
      {/* Padded and pulled back by the same amount: a row's height to touch, and the row the same as it was. */}
      <Link href={pendingHref(item)} className="-my-3 min-w-0 py-3 wrap-break-word text-ink-2 underline decoration-white/20 underline-offset-4 transition-colors hover:text-ink motion-reduce:transition-none">
        {item.label}
      </Link>
      {KIND_LABEL[item.kind] ? <Badge>{KIND_LABEL[item.kind]}</Badge> : null}
    </li>
  );
  const rest = items.slice(SHOWN);
  return (
    <div className="mt-3">
      <ul className="divide-y divide-rule border-y border-rule">{items.slice(0, SHOWN).map(row)}</ul>
      {rest.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none py-3 text-sm text-ink-3 hover:text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">y {rest.length} más</span>
            <span className="hidden group-open:inline">Mostrar menos</span>
          </summary>
          <ul className="divide-y divide-rule border-b border-rule">{rest.map(row)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * What is left to do about the profile, in one list at the top of it: each line says what, in a sentence, and leads to
 * where it is done. The questions put off are the one line that is a list in itself, and are listed under it. Nothing
 * here is required — it is what there is, not a score.
 */
export function TaskList({ tasks }: { tasks: readonly ProfileTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <section id={SECTION_ID.tasks} aria-labelledby="tasks-title" className="scroll-mt-[calc(var(--nav-h)+4rem)] space-y-4 border border-rule bg-paper-2 p-5">
      <h2 id="tasks-title" className="flex items-center gap-2 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
        Para hacer
        <Badge>{tasks.length}</Badge>
      </h2>
      <ul className="divide-y divide-rule">
        {tasks.map((task) => (
          <li key={task.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              {/* A basis and not just «take what is left»: with the button beside it a phone left the words a column of their own, one to a line — below the basis the button goes under. */}
              <div className="min-w-0 flex-[1_1_18rem]">
                <p className="text-[15px] text-ink">{task.title}</p>
                <p className="mt-0.5 text-sm text-ink-3">{task.detail}</p>
              </div>
              {task.action ? (
                <ButtonLink href={task.action.href} variant="secondary">
                  {task.action.label} →
                </ButtonLink>
              ) : null}
            </div>
            {task.items && task.items.length > 0 ? <Pending items={task.items} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
