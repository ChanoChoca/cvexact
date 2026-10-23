import { describe, expect, it } from "vitest";
import {
  CAPTURE_MAX,
  CAPTURE_PROBLEM,
  captureNote,
  cleanCapture,
  isCaptured,
  placeNote,
  placeableNotes,
  sentencesToPlace,
  settleNote,
  unsortedLine,
  unsortedNotes,
} from "@/lib/profile/capture";
import { undoEntry } from "@/lib/profile/edit";
import { describeJoin, joinProfiles } from "@/lib/profile/join";
import { toPlainProfile } from "@/lib/profile/project";
import { forSync } from "@/lib/profile/sync";
import { noteSchema, storedProfileSchema, type StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * «Anotá algo» (e5, O15): a note with its date, written down from anywhere, that waits to be put in the job it names — and is never put anywhere by
 * itself. What is tried here is the profile's side of it: writing it, counting what waits, finding the one job a note names, and settling it.
 */

const ctx = { now: STAMP, newId };
const LATER = { now: "2026-10-20T10:00:00.000Z", newId };
const copy = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(structuredClone(profile));

/** A profile with the two jobs a note can name. */
const base = () =>
  profileWith(
    { company: "Logística Sur", role: "Operario de depósito", from: { year: 2023 }, to: "current", facts: [{ text: "Armo los pedidos del día" }] },
    { company: "Panadería Don Julio", role: "Ayudante", from: { year: 2020 }, to: { year: 2022 }, facts: [{ text: "Atendía el mostrador" }] },
  );

describe("writing a note down", () => {
  it("keeps it as it was written, with today's date and how it came, as a step in the history", () => {
    const profile = base();
    const result = captureNote(profile, "  Hoy cerré   la planilla de stock en Logística Sur\n\n\n\nsin errores  ", "capture", ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toEqual({ id: expect.any(String), text: "Hoy cerré la planilla de stock en Logística Sur\n\nsin errores", at: STAMP, via: "capture" });
    expect(profile.notes).toEqual([result.note]);
    const last = profile.history[profile.history.length - 1]!;
    expect(last).toMatchObject({ op: "add", path: ["notes", result.note.id] });
  });

  it("says when what came from another app was shared and not written", () => {
    const profile = base();
    const result = captureNote(profile, "Felicitaciones por el cierre del trimestre", "share", ctx);
    expect(result.ok && result.note.via).toBe("share");
  });

  it("is nothing when there is nothing, and not twice what was already written, however it is cased or spaced", () => {
    const profile = base();
    expect(captureNote(profile, "   \n  ", "capture", ctx)).toEqual({ ok: false, reason: "empty" });
    expect(captureNote(profile, "Cerré el mes", "capture", ctx).ok).toBe(true);
    expect(captureNote(profile, "  cerré   EL mes ", "capture", ctx)).toEqual({ ok: false, reason: "duplicate" });
    expect(profile.notes).toHaveLength(1);
    for (const text of Object.values(CAPTURE_PROBLEM)) expect(text.length).toBeGreaterThan(10);
  });

  it("is a few sentences and not a story: cut at what a note may be, and with the line breaks it had", () => {
    expect(cleanCapture("a".repeat(CAPTURE_MAX + 50))).toHaveLength(CAPTURE_MAX);
    expect(cleanCapture("uno\r\ndos\r\n\r\n\r\n\r\ntres")).toBe("uno\ndos\n\ntres");
    expect(cleanCapture("\t  con\tespacios   raros \t")).toBe("con espacios raros");
  });
});

describe("what waits", () => {
  it("is what was written or shared and has not been dealt with — not what a document or a story left as a note", () => {
    const profile = base();
    profile.notes.push({ id: "old", text: "Lo que conté al empezar sobre mis trabajos", at: ago(100) });
    captureNote(profile, "Una nota nueva", "capture", ctx);
    captureNote(profile, "Otra, compartida", "share", ctx);
    expect(unsortedNotes(profile).map((note) => note.text)).toEqual(["Una nota nueva", "Otra, compartida"]);
    expect(isCaptured(profile.notes[0]!)).toBe(false);
    expect(isCaptured(profile.notes[1]!)).toBe(true);
  });

  it("is counted in a sentence of what there is, never of what is missing", () => {
    expect(unsortedLine(0)).toBeNull();
    expect(unsortedLine(1)).toBe("Tenés 1 nota sin ordenar.");
    expect(unsortedLine(4)).toBe("Tenés 4 notas sin ordenar.");
    for (const count of [1, 2, 9]) expect(unsortedLine(count)).not.toMatch(/%|falta|pendiente|atrasad/i);
  });

  it("stops being counted when the person deals with it, with the day, and can be taken back", () => {
    const profile = base();
    const written = captureNote(profile, "Una nota para ordenar", "capture", ctx);
    if (!written.ok) throw new Error("not written");
    expect(settleNote(profile, written.note.id, LATER)).toBe(true);
    expect(profile.notes[0]!.settledAt).toBe(LATER.now);
    expect(unsortedNotes(profile)).toEqual([]);
    expect(settleNote(profile, written.note.id, LATER)).toBe(false);
    expect(settleNote(profile, "nada", LATER)).toBe(false);
    const entry = profile.history[profile.history.length - 1]!;
    expect(entry).toMatchObject({ op: "set", path: ["notes", written.note.id, "settledAt"] });
    const undone = undoEntry(profile, entry.id, LATER);
    expect(undone.ok && undone.profile.notes[0]!.settledAt).toBeUndefined();
  });
});

describe("the one job a note names", () => {
  it("is found by its company, or by its role when no other job has it", () => {
    const profile = base();
    captureNote(profile, "Hoy en Logística Sur reordené el sector de picking", "capture", ctx);
    captureNote(profile, "Como ayudante aprendí a calcular las masas", "capture", ctx);
    const found = placeableNotes(profile);
    expect(found.map((entry) => [entry.note.text.slice(0, 18), entry.label])).toEqual([
      ["Hoy en Logística S", "Operario de depósito · Logística Sur"],
      ["Como ayudante apre", "Ayudante · Panadería Don Julio"],
    ]);
  });

  it("is not guessed when the note names none or two, and not offered once it is settled", () => {
    const profile = base();
    captureNote(profile, "Estuve pensando en volver a estudiar", "capture", ctx);
    captureNote(profile, "Pasé de Logística Sur a la Panadería Don Julio y al revés", "capture", ctx);
    expect(placeableNotes(profile)).toEqual([]);
    const named = captureNote(profile, "En Logística Sur ordené el depósito", "capture", ctx);
    if (!named.ok) throw new Error("not written");
    expect(placeableNotes(profile)).toHaveLength(1);
    settleNote(profile, named.note.id, ctx);
    expect(placeableNotes(profile)).toEqual([]);
  });

  it("is not offered for a note that nobody wrote down on purpose", () => {
    const profile = base();
    profile.notes.push({ id: "n", text: "En Logística Sur ordené el depósito", at: STAMP });
    expect(placeableNotes(profile)).toEqual([]);
  });
});

describe("putting a note in its job", () => {
  it("makes tasks of its sentences, in its own words, and settles it", () => {
    const profile = base();
    const written = captureNote(profile, "En Logística Sur reordené el sector de picking. Capacité a dos personas nuevas.", "capture", ctx);
    if (!written.ok) throw new Error("not written");
    const job = profile.experience.find((entry) => entry.company.value === "Logística Sur")!;
    const sentences = sentencesToPlace(written.note);
    expect(sentences).toEqual(["En Logística Sur reordené el sector de picking.", "Capacité a dos personas nuevas."]);
    expect(placeNote(profile, written.note.id, job.id, sentences, LATER)).toBe(true);
    expect(job.facts.slice(-2).map((fact) => fact.text)).toEqual(sentences);
    expect(job.facts.slice(-2).every((fact) => fact.kind === "responsibility" && fact.status === "confirmed" && fact.source.kind === "manual")).toBe(true);
    expect(profile.notes[0]!.settledAt).toBe(LATER.now);
    expect(unsortedNotes(profile)).toEqual([]);
    // The note itself stays as it was written.
    expect(profile.notes[0]!.text).toBe("En Logística Sur reordené el sector de picking. Capacité a dos personas nuevas.");
  });

  it("takes the whole note when it is too short to have a sentence, and nothing when there is nothing", () => {
    expect(sentencesToPlace({ text: "Cerré el mes" })).toEqual(["Cerré el mes"]);
    expect(sentencesToPlace({ text: "ok" })).toEqual([]);
    expect(sentencesToPlace({ text: "" })).toEqual([]);
  });

  it("settles nothing when nothing was added: the sentence was already a task of that job", () => {
    const profile = base();
    const written = captureNote(profile, "Armo los pedidos del día", "capture", ctx);
    if (!written.ok) throw new Error("not written");
    const job = profile.experience.find((entry) => entry.company.value === "Logística Sur")!;
    expect(placeNote(profile, written.note.id, job.id, ["Armo los pedidos del día"], LATER)).toBe(false);
    expect(profile.notes[0]!.settledAt).toBeUndefined();
    expect(placeNote(profile, written.note.id, "otro", ["Algo nuevo para otro puesto"], LATER)).toBe(false);
  });
});

describe("how it is stored", () => {
  it("is not there for a note from before it existed, and a kind it does not know is let go", () => {
    expect(noteSchema.parse({ id: "n", text: "Algo", at: STAMP })).toEqual({ id: "n", text: "Algo", at: STAMP });
    expect(noteSchema.parse({ id: "n", text: "Algo", at: STAMP, via: "magia", settledAt: 7 })).toEqual({ id: "n", text: "Algo", at: STAMP });
    expect(noteSchema.parse({ id: "n", text: "Algo", at: STAMP, via: "share", settledAt: LATER.now })).toMatchObject({ via: "share", settledAt: LATER.now });
  });

  it("is settled on this browser when the account's copy settled it, and the day is kept", () => {
    const local = base();
    const written = captureNote(local, "Una nota para ordenar", "capture", ctx);
    if (!written.ok) throw new Error("not written");
    const account = copy(local);
    settleNote(account, written.note.id, LATER);
    const { profile } = joinProfiles(local, account);
    expect(profile.notes[0]!.settledAt).toBe(LATER.now);
    // And not the other way: a copy that did not settle it does not unsettle this one.
    const settledHere = copy(local);
    settleNote(settledHere, written.note.id, ctx);
    expect(joinProfiles(settledHere, copy(local)).profile.notes[0]!.settledAt).toBe(STAMP);
  });

  it("brings a note that only the account has, with how it came and whether it was settled", () => {
    const local = base();
    const account = copy(local);
    const written = captureNote(account, "Una nota del celular", "share", ctx);
    if (!written.ok) throw new Error("not written");
    settleNote(account, written.note.id, LATER);
    const { profile, added } = joinProfiles(local, account);
    expect(profile.notes).toEqual([expect.objectContaining({ text: "Una nota del celular", via: "share", settledAt: LATER.now })]);
    expect(describeJoin(added)).toBe("1 nota");
  });
});

describe("where a note goes, which the policy has to say", () => {
  it("goes with the profile to the account: its text, its day, how it came and the day it was dealt with", () => {
    const profile = base();
    const written = captureNote(profile, "Hoy aprendí a usar el autoelevador", "share", ctx);
    if (!written.ok) throw new Error("not written");
    settleNote(profile, written.note.id, LATER);
    expect(forSync(profile).notes).toEqual([expect.objectContaining({ text: "Hoy aprendí a usar el autoelevador", at: STAMP, via: "share", settledAt: LATER.now })]);
  });

  it("goes to no model: the plain profile every generator and reader is given has no notes in it", () => {
    const profile = base();
    captureNote(profile, "Hoy aprendí a usar el autoelevador", "capture", ctx);
    expect(JSON.stringify(toPlainProfile(profile))).not.toContain("autoelevador");
    expect(Object.keys(toPlainProfile(profile))).not.toContain("notes");
  });
});

function ago(days: number): string {
  return new Date(Date.parse(STAMP) - days * 86_400_000).toISOString();
}
