"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { focusHeading } from "@/components/ui/focusHeading";
import type { InferredSkill } from "@/lib/schemas/job";

type Answer = "yes" | "no";

/**
 * The skills the offer asks for that were deduced from the profile and not written in it, put to the person before the first CV: a CV is something
 * they sign, and a deduced «Git» is a guess about them until they say so. «Sí» makes it a skill of their profile; «No» is kept there as a veto, for every
 * posting. What is left without an answer is not written either — the CV only uses it to choose and order what the profile does say.
 */
export function SkillReview({
  skills,
  onDone,
}: {
  skills: InferredSkill[];
  onDone: (answers: { yes: InferredSkill[]; no: InferredSkill[] }) => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // It takes the place of the progress, which a screen reader was just told about: say the question is here.
  useEffect(() => focusHeading(heading.current), []);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});

  // Pressing the answer that is already given takes it back: nothing is chosen for the person.
  const choose = (skill: InferredSkill, answer: Answer) =>
    setAnswers((current) => ({ ...current, [skill.skill]: current[skill.skill] === answer ? undefined : answer }));

  return (
    <section aria-labelledby={headingId} data-skill-review className="space-y-4 border border-rule bg-paper-2 p-5 sm:p-6">
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">Antes de escribir el CV</p>
      <h2 ref={heading} id={headingId} className="text-[19px] leading-snug text-ink">
        El aviso pide esto, que dedujimos de tu perfil. ¿Es tuyo?
      </h2>
      <ul className="space-y-3">
        {skills.map((skill) => (
          <li key={skill.skill} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-sm wrap-break-word">
              <span className="text-ink">{skill.skill}</span>
              <span className="ml-2 text-xs text-ink-3">de «{skill.derivedFrom}»</span>
            </div>
            <div role="group" aria-label={skill.skill} className="flex gap-2">
              {(["yes", "no"] as const).map((answer) => (
                <Button
                  key={answer}
                  compact
                  variant={answers[skill.skill] === answer ? "primary" : "secondary"}
                  aria-pressed={answers[skill.skill] === answer}
                  onClick={() => choose(skill, answer)}
                >
                  {answer === "yes" ? "Sí" : "No"}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">Lo que no contestes no se escribe en el CV.</p>
      <Button
        onClick={() =>
          onDone({
            yes: skills.filter((skill) => answers[skill.skill] === "yes"),
            no: skills.filter((skill) => answers[skill.skill] === "no"),
          })
        }
      >
        Escribir el CV
      </Button>
    </section>
  );
}
