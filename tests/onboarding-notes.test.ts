import { describe, expect, it } from "vitest";
import { hasNote, isUsed, keepStoryAsNote, namesJob, noteSentences, passNoteToJob, passSentencesToJob, roleIsDistinct, sentencesAbout, sentencesOfNotes, takeFromTray, unassignedAbout, usedSentences } from "@/lib/onboarding/notes";
import { answerFromTray } from "@/lib/onboarding/answer";
import { alreadyKnown, detectGaps } from "@/lib/onboarding/gaps";
import { assignUnassigned } from "@/lib/onboarding/review";
import { undoLast } from "@/lib/profile/edit";
import type { StoredProfile } from "@/lib/schemas/profile-v2";
import { NOW, STAMP, profileWith } from "./helpers/profiles";

let n = 0;
const ctx = () => ({ now: STAMP, newId: () => `note-test-${++n}` });

const SAID =
  "Trabajo en Kiosco del Centro desde 2022. Atiendo la caja y repongo la mercadería. Antes fui repositor en Supermercado Sur y armaba los pedidos. Ok.";

function said(): StoredProfile {
  const profile = profileWith(
    { company: "Kiosco del Centro", role: "Cajero", from: { year: 2022 }, to: "current" },
    { company: "Supermercado Sur", role: "Repositor", from: { year: 2019 }, to: { year: 2021 } },
  );
  profile.notes.push({ id: "n1", text: SAID, sourceId: "dump-1", at: STAMP });
  return profile;
}

describe("what someone said freely, a sentence at a time", () => {
  it("is cut into sentences, without the crumbs that are not something anyone did", () => {
    expect(noteSentences(SAID)).toEqual([
      "Trabajo en Kiosco del Centro desde 2022.",
      "Atiendo la caja y repongo la mercadería.",
      "Antes fui repositor en Supermercado Sur y armaba los pedidos.",
    ]);
  });

  it("does not cut at an abbreviation", () => {
    expect(noteSentences("Reportaba al Ing. Pérez y coordinaba el turno de la tarde.")).toHaveLength(1);
  });

  it("is said once across several notes, in the order it was said", () => {
    const sentences = sentencesOfNotes([{ text: "Atiendo la caja del local. Repongo la mercadería." }, { text: "ATIENDO LA CAJA DEL LOCAL. Armo los pedidos del día." }]);
    expect(sentences).toEqual(["Atiendo la caja del local.", "Repongo la mercadería.", "Armo los pedidos del día."]);
  });
});

describe("a sentence that names a job", () => {
  const kiosco = { company: "Kiosco del Centro", role: "Cajero" };

  it("says its company, whatever the case or the accents, as whole words", () => {
    expect(namesJob("Trabajo en el KIOSCO DEL CENTRO desde 2022.", kiosco, false)).toBe(true);
    expect(namesJob("Trabajé en Café Delicias.", { company: "Café Delicias", role: "" }, false)).toBe(true);
    expect(namesJob("Trabajé en cafe delicias.", { company: "Café Delicias", role: "" }, false)).toBe(true);
    expect(namesJob("Trabajé en Acmeco.", { company: "Acme", role: "" }, false)).toBe(false);
  });

  it("says nothing by a name too short to say anything", () => {
    expect(namesJob("Trabajé en AB.", { company: "AB", role: "" }, false)).toBe(false);
  });

  it("says its role only when the role is the job's alone", () => {
    expect(namesJob("Fui cajero muchos años.", kiosco, false)).toBe(false);
    expect(namesJob("Fui cajero muchos años.", kiosco, true)).toBe(true);
  });

  it("knows a role is the job's alone when no other job has it", () => {
    const profile = said();
    expect(roleIsDistinct(profile, profile.experience[0]!.id)).toBe(true);
    profile.experience[1]!.role = { ...profile.experience[1]!.role, value: "cajero" };
    expect(roleIsDistinct(profile, profile.experience[0]!.id)).toBe(false);
  });
});

describe("what to start a job's question from", () => {
  it("is the sentences that name the job, and none that name another", () => {
    const profile = said();
    expect(sentencesAbout(profile, profile.experience[0]!.id)).toEqual(["Trabajo en Kiosco del Centro desde 2022."]);
    // The sentence that names Supermercado Sur is that job's, by its company.
    expect(sentencesAbout(profile, profile.experience[1]!.id)).toEqual(["Antes fui repositor en Supermercado Sur y armaba los pedidos."]);
  });

  it("is the job's own when the role names it, and the role is nobody else's", () => {
    const profile = said();
    profile.experience[0]!.company = { ...profile.experience[0]!.company, value: "" };
    profile.notes[0]!.text = "Fui cajero de un local del centro y atendía la caja todos los días.";
    expect(sentencesAbout(profile, profile.experience[0]!.id)).toEqual(["Fui cajero de un local del centro y atendía la caja todos los días."]);
  });

  it("is nothing when no sentence names the job, rather than the nearest thing", () => {
    const profile = said();
    profile.notes[0]!.text = "Me gusta trabajar con gente y aprender cosas nuevas todos los días.";
    expect(sentencesAbout(profile, profile.experience[0]!.id)).toEqual([]);
    expect(sentencesAbout(profile, "no-existe")).toEqual([]);
  });

  it("leaves out what the job already has as a task", () => {
    const profile = said();
    profile.experience[0]!.facts.push({ id: "f1", kind: "responsibility", text: "trabajo en kiosco del centro desde 2022.", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    expect(sentencesAbout(profile, profile.experience[0]!.id)).toEqual([]);
  });

  it("is at most a handful", () => {
    const profile = said();
    profile.notes[0]!.text = Array.from({ length: 9 }, (_, i) => `En Kiosco del Centro hice la tarea número ${i + 1} del día.`).join(" ");
    expect(sentencesAbout(profile, profile.experience[0]!.id)).toHaveLength(6);
    expect(sentencesAbout(profile, profile.experience[0]!.id, 2)).toHaveLength(2);
  });

  it("knows which sentences are already tasks of some job", () => {
    const profile = said();
    profile.experience[1]!.facts.push({ id: "f2", kind: "responsibility", text: "Atiendo la caja y repongo la mercadería.", source: { kind: "manual", at: STAMP }, status: "confirmed" });
    const used = usedSentences(profile);
    expect(isUsed("ATIENDO la caja y repongo la mercaderia", used)).toBe(true);
    expect(isUsed("Trabajo en Kiosco del Centro desde 2022.", used)).toBe(false);
  });
});

describe("passing sentences of a note to a job", () => {
  it("makes each one a task in the words it was said in, confirmed, credited to the person and to the note", () => {
    const profile = said();
    const job = profile.experience[0]!;
    const added = passNoteToJob(profile, "n1", job.id, ["Atiendo la caja y repongo la mercadería.", "  Armaba   los pedidos. "], ctx());
    expect(added.map((fact) => fact.text)).toEqual(["Atiendo la caja y repongo la mercadería.", "Armaba los pedidos."]);
    expect(job.facts.slice(-2)).toEqual(added);
    expect(added[0]).toMatchObject({ kind: "responsibility", status: "confirmed", source: { kind: "manual", docId: "dump-1", quote: "Atiendo la caja y repongo la mercadería.", at: STAMP } });
  });

  it("leaves the note as it was: it is where the words were said", () => {
    const profile = said();
    passNoteToJob(profile, "n1", profile.experience[0]!.id, ["Atiendo la caja y repongo la mercadería."], ctx());
    expect(profile.notes).toEqual([{ id: "n1", text: SAID, sourceId: "dump-1", at: STAMP }]);
  });

  it("does not add a task the job already has, however it is written", () => {
    const profile = said();
    const job = profile.experience[0]!;
    passNoteToJob(profile, "n1", job.id, ["Atiendo la caja y repongo la mercadería."], ctx());
    const again = passNoteToJob(profile, "n1", job.id, ["ATIENDO la caja y repongo la mercaderia.", "Armaba los pedidos."], ctx());
    expect(again.map((fact) => fact.text)).toEqual(["Armaba los pedidos."]);
    expect(job.facts).toHaveLength(2);
  });

  it("leaves a step in the history for each task, to undo one at a time", () => {
    const profile = said();
    const job = profile.experience[0]!;
    passNoteToJob(profile, "n1", job.id, ["Atiendo la caja y repongo la mercadería.", "Armaba los pedidos."], ctx());
    expect(profile.history.filter((entry) => entry.op === "add" && entry.path.includes("facts"))).toHaveLength(2);
    const undone = undoLast(profile, ctx());
    expect(undone.ok && undone.profile.experience[0]!.facts.map((fact) => fact.text)).toEqual(["Atiendo la caja y repongo la mercadería."]);
  });

  it("does nothing for a note or a job that is not there, or for nothing said", () => {
    const profile = said();
    const job = profile.experience[0]!;
    expect(passNoteToJob(profile, "nada", job.id, ["Algo que hacía todos los días."], ctx())).toEqual([]);
    expect(passNoteToJob(profile, "n1", "nada", ["Algo que hacía todos los días."], ctx())).toEqual([]);
    expect(passNoteToJob(profile, "n1", job.id, ["   ", ""], ctx())).toEqual([]);
    expect(job.facts).toHaveLength(0);
  });
});

describe("passing sentences from anywhere in what was said", () => {
  it("credits each to the note it was said in", () => {
    const profile = said();
    profile.notes.push({ id: "n2", text: "En Kiosco del Centro también hago el arqueo de la caja al cerrar.", sourceId: "dump-2", at: STAMP });
    const job = profile.experience[0]!;
    const added = passSentencesToJob(profile, job.id, ["Atiendo la caja y repongo la mercadería.", "En Kiosco del Centro también hago el arqueo de la caja al cerrar."], ctx());
    expect(added.map((fact) => fact.source.docId)).toEqual(["dump-1", "dump-2"]);
  });

  it("makes a task of a sentence no note has, with no document to credit", () => {
    const profile = said();
    const [fact] = passSentencesToJob(profile, profile.experience[0]!.id, ["Una frase que no está en ninguna nota."], ctx());
    expect(fact!.source).toEqual({ kind: "manual", quote: "Una frase que no está en ninguna nota.", at: STAMP });
  });

  it("does not add what the job already has, and does nothing for a job that is not there", () => {
    const profile = said();
    const job = profile.experience[0]!;
    passSentencesToJob(profile, job.id, ["Atiendo la caja y repongo la mercadería."], ctx());
    expect(passSentencesToJob(profile, job.id, ["atiendo la caja y repongo la mercaderia."], ctx())).toEqual([]);
    expect(passSentencesToJob(profile, "nada", ["Atiendo la caja y repongo la mercadería."], ctx())).toEqual([]);
  });
});

describe("a story kept as a note, read by a model or not", () => {
  const newId = () => `story-${++n}`;

  it("is kept as it was told, tied to the document it was read as", () => {
    const profile = profileWith();
    expect(keepStoryAsNote(profile, "  Trabajé cinco años en Acme como analista.  ", "src-1", STAMP, newId)).toBe(true);
    expect(profile.notes).toEqual([{ id: expect.any(String), text: "Trabajé cinco años en Acme como analista.", sourceId: "src-1", at: STAMP }]);
  });

  it("is the same note when it is told again, whatever the case, the accents or the spacing", () => {
    const profile = profileWith();
    keepStoryAsNote(profile, "Trabajé cinco años en Acme.", "src-1", STAMP, newId);
    expect(hasNote(profile, "  trabaje   CINCO años en acme. ")).toBe(true);
    expect(keepStoryAsNote(profile, "TRABAJE cinco años en Acme.", "src-2", STAMP, newId)).toBe(false);
    expect(profile.notes).toHaveLength(1);
  });

  it("keeps nothing for nothing", () => {
    const profile = profileWith();
    expect(keepStoryAsNote(profile, "   ", "src-1", STAMP, newId)).toBe(false);
    expect(profile.notes).toEqual([]);
  });

  it("is kept whole, in as many notes as it takes, when it is longer than a note may be", () => {
    const profile = profileWith();
    const sentence = "Cuando llegó el cliente organicé personalmente toda la logística del evento completo.";
    const story = Array.from({ length: 60 }, (_, i) => `${sentence.replace("cliente", `cliente ${i + 1}`)}`).join(" ");
    expect(story.length).toBeGreaterThan(4000);
    expect(keepStoryAsNote(profile, story, "src-1", STAMP, newId)).toBe(true);
    expect(profile.notes.length).toBeGreaterThan(2);
    // None is cut when the profile is read back: each fits the limit the schema reads with.
    expect(profile.notes.every((note) => note.text.length <= 2000 && note.sourceId === "src-1")).toBe(true);
    // And together they are the story, whole.
    expect(profile.notes.map((note) => note.text).join(" ")).toBe(story);
    // Told again, it adds nothing.
    expect(keepStoryAsNote(profile, story, "src-2", STAMP, newId)).toBe(false);
  });

  it("keeps a short story as it was written, line breaks and all", () => {
    const profile = profileWith();
    keepStoryAsNote(profile, "Primero trabajé en Acme.\n\nDespués estudié.", "src-1", STAMP, newId);
    expect(profile.notes.map((note) => note.text)).toEqual(["Primero trabajé en Acme.\n\nDespués estudié."]);
  });
});

describe("what a document could not place, and the question about the job it names", () => {
  const COST = "Logré reducir los costos de reposición en Kiosco del Centro un 15%.";

  const withTray = (): StoredProfile => {
    const profile = profileWith(
      { company: "Kiosco del Centro", role: "Cajero", from: { year: 2022 }, to: "current" },
      { company: "Supermercado Sur", role: "Repositor", from: { year: 2019 }, to: { year: 2021 } },
    );
    profile.unassigned.push(
      { id: "u1", text: COST, kind: "awards", sourceId: "cv-1", heading: "Logros" },
      { id: "u2", text: "Premio al mejor equipo del año.", kind: "awards", sourceId: "cv-1", heading: "Logros" },
      { id: "u3", text: "Armé el sistema de pedidos de Supermercado Sur.", kind: "other", sourceId: "cv-1" },
      { id: "u4", text: "Referencias: Laura Pérez, gerente de Kiosco del Centro.", kind: "references", sourceId: "cv-1" },
      { id: "u5", text: "Voluntariado en el club del barrio, además de mi trabajo en Kiosco del Centro.", kind: "interests", sourceId: "cv-1" },
    );
    return profile;
  };

  describe("offered", () => {
    it("the lines that name the job by its company, and not the ones that name nothing or another job", () => {
      const profile = withTray();
      expect(unassignedAbout(profile, profile.experience[0]!.id).map((line) => line.id)).toEqual(["u1"]);
      expect(unassignedAbout(profile, profile.experience[1]!.id).map((line) => line.id)).toEqual(["u3"]);
    });

    it("with the text as it was and where it came from, and nothing else of it", () => {
      const profile = withTray();
      expect(unassignedAbout(profile, profile.experience[0]!.id)).toEqual([{ id: "u1", text: COST, sourceId: "cv-1" }]);
    });

    it("only the kinds of text that can be about what was done: not references, links, skills or interests, whatever they name", () => {
      const profile = withTray();
      const ids = [...unassignedAbout(profile, profile.experience[0]!.id), ...unassignedAbout(profile, profile.experience[1]!.id)].map((line) => line.id);
      expect(ids).not.toContain("u4");
      expect(ids).not.toContain("u5");
    });

    it("by the role when it is the one job that has it, and not when two jobs share it", () => {
      const profile = withTray();
      profile.unassigned.push({ id: "u6", text: "Como repositor armé el plan de góndolas.", kind: "other" });
      expect(unassignedAbout(profile, profile.experience[1]!.id).map((line) => line.id)).toContain("u6");
      const shared = profileWith({ company: "A", role: "Repositor", from: { year: 2022 } }, { company: "B", role: "Repositor", from: { year: 2019 }, to: { year: 2021 } });
      shared.unassigned.push({ id: "u7", text: "Como repositor armé el plan de góndolas.", kind: "other" });
      expect(unassignedAbout(shared, shared.experience[0]!.id)).toEqual([]);
    });

    it("not a line the job already has as a task", () => {
      const profile = withTray();
      const job = profile.experience[0]!;
      job.facts.push({ id: "f1", kind: "achievement", text: "logré reducir los costos de reposición en kiosco del centro un 15%.", source: { kind: "manual", at: STAMP }, status: "confirmed" });
      expect(unassignedAbout(profile, job.id)).toEqual([]);
    });

    it("a few at a time, and none for a job that is not there", () => {
      const profile = withTray();
      for (let i = 0; i < 6; i += 1) profile.unassigned.push({ id: `x${i}`, text: `Logro número ${i} en Kiosco del Centro.`, kind: "awards" });
      expect(unassignedAbout(profile, profile.experience[0]!.id)).toHaveLength(3);
      expect(unassignedAbout(profile, profile.experience[0]!.id, 5)).toHaveLength(5);
      expect(unassignedAbout(profile, "nada")).toEqual([]);
    });

    it("and writes nothing: a line is not made one of the job's by being shown", () => {
      const profile = withTray();
      const before = structuredClone(profile);
      unassignedAbout(profile, profile.experience[0]!.id);
      expect(profile).toEqual(before);
    });
  });

  describe("taken", () => {
    it("as a task, or as an achievement, in the words it had, confirmed, credited to the person and to the document", () => {
      const profile = withTray();
      const job = profile.experience[0]!;
      const fact = takeFromTray(profile, "u1", job.id, "achievement", ctx())!;
      expect(fact).toMatchObject({ kind: "achievement", text: COST, status: "confirmed", source: { kind: "manual", docId: "cv-1", quote: COST, at: STAMP } });
      expect(job.facts).toEqual([fact]);
      const task = takeFromTray(profile, "u2", job.id, undefined, ctx())!;
      expect(task.kind).toBe("responsibility");
    });

    it("and leaves the tray, with a step in the history to undo it", () => {
      const profile = withTray();
      takeFromTray(profile, "u1", profile.experience[0]!.id, "achievement", ctx());
      expect(profile.unassigned.map((item) => item.id)).not.toContain("u1");
      expect(profile.history.at(-1)).toMatchObject({ op: "add" });
    });

    it("and nothing for a line or a job that is not there", () => {
      const profile = withTray();
      const before = structuredClone(profile);
      expect(takeFromTray(profile, "nada", profile.experience[0]!.id, "achievement", ctx())).toBeNull();
      expect(takeFromTray(profile, "u1", "nada", "achievement", ctx())).toBeNull();
      expect(profile).toEqual(before);
    });

    it("the tray's own 'Asignar' does what it did: a task", () => {
      const profile = withTray();
      expect(assignUnassigned(profile, "u1", profile.experience[0]!.id, ctx())).toBe(true);
      expect(profile.experience[0]!.facts[0]).toMatchObject({ kind: "responsibility", text: COST });
    });

    it("as the answer to the question: an achievement answers what improved, and it counts as asked", () => {
      const profile = withTray();
      const job = profile.experience[0]!;
      // The job has something done in it and no result: it is asked what improved.
      job.facts.push({ id: "f0", kind: "responsibility", text: "Atiendo la caja", source: { kind: "manual", at: STAMP }, status: "confirmed" });
      const asked = detectGaps(profile, NOW).find((gap) => gap.rule === "no_achievements" && gap.experienceId === job.id)!;
      expect(alreadyKnown(asked, profile)).toBe(false);
      const fact = answerFromTray(profile, asked, "u1", "achievement", ctx())!;
      expect(fact.kind).toBe("achievement");
      expect(alreadyKnown(asked, profile)).toBe(true);
      expect(profile.onboarding.askedThisSession).toBe(1);
      expect(profile.onboarding.askedByExperience[job.id]).toBe(1);
    });

    it("as the answer to what the job was: a task answers it", () => {
      const profile = withTray();
      const job = profile.experience[0]!;
      const asked = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content" && gap.experienceId === job.id)!;
      const fact = answerFromTray(profile, asked, "u1", "task", ctx())!;
      expect(fact.kind).toBe("responsibility");
      expect(detectGaps(profile, NOW).some((gap) => gap.rule === "no_content" && gap.experienceId === job.id)).toBe(false);
    });

    it("and counts for nothing when there was nothing to take", () => {
      const profile = withTray();
      const asked = detectGaps(profile, NOW).find((gap) => gap.rule === "no_content" && gap.experienceId === profile.experience[0]!.id)!;
      expect(answerFromTray(profile, asked, "nada", "task", ctx())).toBeNull();
      expect(profile.onboarding.askedThisSession).toBe(0);
    });
  });
});
