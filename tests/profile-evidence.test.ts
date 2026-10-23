import { describe, expect, it } from "vitest";
import { addEntry, blankForm } from "@/lib/onboarding/entries";
import { undoEntry } from "@/lib/profile/edit";
import { addCertification } from "@/lib/profile/entities";
import {
  ADD_PROBLEM,
  EVIDENCE_LABEL,
  URL_PROBLEM,
  activeEvidence,
  addCvLink,
  addEvidence,
  checkEvidenceUrl,
  holderOf,
  inCvLinks,
  joinEvidence,
  removeEvidence,
  restoreEvidence,
  shortUrl,
  strongest,
  verificationCounts,
  verificationLine,
  type EvidenceTarget,
} from "@/lib/profile/evidence";
import { describeJoin, joinProfiles } from "@/lib/profile/join";
import { toPlainProfile } from "@/lib/profile/project";
import { forSync } from "@/lib/profile/sync";
import { MAX_EVIDENCE, evidenceSchema, storedProfileSchema, type Evidence, type StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith, withStudy } from "./helpers/profiles";

/**
 * What shows the things a person says (e5, O13, O14, O20, I4): a page, a register, a signed badge, beside the job, the study, the certification or
 * the project, with the person's own sentence. Kept as an address and a sentence — never what the page holds — and never asked for.
 */

const ctx = { now: STAMP, newId };
const copy = (profile: StoredProfile): StoredProfile => storedProfileSchema.parse(structuredClone(profile));

/** A profile with one of each thing that can have evidence: a job, a study, a certification and a project. */
function everything() {
  const profile = profileWith({ company: "Nubia Retail", role: "Analista", from: { year: 2022 }, to: "current", facts: [{ text: "Armo los informes" }] });
  const study = withStudy(profile, { degree: "Licenciatura en Administración", institution: "UBA", from: { year: 2014 }, to: { year: 2019 } });
  const cert = addCertification(profile, { name: "Matrícula de gasista", issuer: "Camuzzi" }, ctx)!;
  const projectId = addEntry(profile, { ...blankForm("project"), what: "Mi tienda", where: "Una tienda online" }, { newId, now: STAMP })!;
  const targets = {
    job: { kind: "experience", id: profile.experience[0]!.id } satisfies EvidenceTarget,
    study: { kind: "education", id: study.id } satisfies EvidenceTarget,
    cert: { kind: "certification", id: cert.id } satisfies EvidenceTarget,
    project: { kind: "project", id: projectId } satisfies EvidenceTarget,
  };
  return { profile, targets };
}

const link = (url: string, phrase = "Se ve mi trabajo") => ({ type: "link" as const, url, phrase });

describe("the address of a page", () => {
  it("is one that anyone can open: with its scheme, as it was typed", () => {
    expect(checkEvidenceUrl("https://github.com/perfil-ejemplo/tienda")).toEqual({ ok: true, url: "https://github.com/perfil-ejemplo/tienda" });
    expect(checkEvidenceUrl("github.com/perfil-ejemplo")).toEqual({ ok: true, url: "https://github.com/perfil-ejemplo" });
    expect(checkEvidenceUrl("  www.behance.net/ana  ")).toEqual({ ok: true, url: "https://www.behance.net/ana" });
    expect(checkEvidenceUrl("http://ejemplo.com.ar:8080/obras?x=1#a")).toEqual({ ok: true, url: "http://ejemplo.com.ar:8080/obras?x=1#a" });
  });

  it("is not a page that something would run or open on this computer, nor one only this computer can see", () => {
    expect(checkEvidenceUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(checkEvidenceUrl("   ")).toEqual({ ok: false, reason: "empty" });
    expect(checkEvidenceUrl("mi portfolio")).toEqual({ ok: false, reason: "invalid" });
    for (const scheme of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hola", "file:///etc/passwd", "mailto:ana@ejemplo.com", "ftp://ejemplo.com/x", "blob:https://ejemplo.com/1"]) {
      expect(checkEvidenceUrl(scheme), scheme).toEqual({ ok: false, reason: "scheme" });
    }
    for (const host of ["localhost:3000/x", "http://127.0.0.1/x", "http://192.168.0.5/x", "http://[::1]/x", "intranet/obras", "https://mi-pc.local/x", "https://app.localhost/x"]) {
      expect(checkEvidenceUrl(host), host).toEqual({ ok: false, reason: "host" });
    }
  });

  it("does not carry a user and a password written into it, and is not longer than the profile keeps", () => {
    expect(checkEvidenceUrl("https://ana:clave@ejemplo.com/x")).toEqual({ ok: false, reason: "credentials" });
    expect(checkEvidenceUrl(`https://ejemplo.com/${"a".repeat(300)}`)).toEqual({ ok: false, reason: "long" });
  });

  it("says what is wrong with each, in words, and shows an address short", () => {
    for (const reason of Object.keys(URL_PROBLEM)) expect(URL_PROBLEM[reason as keyof typeof URL_PROBLEM].length).toBeGreaterThan(10);
    expect(shortUrl("https://www.github.com/perfil-ejemplo/tienda/")).toBe("github.com/perfil-ejemplo/tienda");
    expect(shortUrl("http://ejemplo.com")).toBe("ejemplo.com");
  });
});

describe("putting evidence beside a thing", () => {
  it("keeps the address and the person's words, on any of the four kinds of thing, as a step in the history", () => {
    const { profile, targets } = everything();
    for (const target of Object.values(targets)) {
      const result = addEvidence(profile, target, link("https://ejemplo.com/obras", "Fotos de obras"), ctx);
      expect(result.ok, target.kind).toBe(true);
      const holder = holderOf(profile, target)!;
      expect(activeEvidence(holder)).toHaveLength(1);
      expect(activeEvidence(holder)[0]).toMatchObject({ type: "link", url: "https://ejemplo.com/obras", phrase: "Fotos de obras", at: STAMP });
    }
    const last = profile.history[profile.history.length - 1]!;
    expect(last.op).toBe("add");
    expect(last.path).toEqual(["projects", targets.project.id, "evidence", expect.any(String)]);
  });

  it("needs, for a link, the address and what the person says is seen there — unless something read it for them", () => {
    const { profile, targets } = everything();
    expect(addEvidence(profile, targets.cert, { type: "link", phrase: "Mi matrícula" }, ctx)).toEqual({ ok: false, reason: "empty" });
    expect(addEvidence(profile, targets.cert, { type: "link", url: "https://ejemplo.com/m", phrase: "   " }, ctx)).toEqual({ ok: false, reason: "phrase" });
    expect(addEvidence(profile, targets.cert, { type: "link", url: "https://ejemplo.com/m", via: "github" }, ctx).ok).toBe(true);
    expect(activeEvidence(holderOf(profile, targets.cert)!)).toHaveLength(1);
  });

  it("says what the address got wrong, and keeps nothing when it did", () => {
    const { profile, targets } = everything();
    expect(addEvidence(profile, targets.job, link("javascript:alert(1)"), ctx)).toEqual({ ok: false, reason: "scheme" });
    expect(addEvidence(profile, targets.job, link("localhost:3000"), ctx)).toEqual({ ok: false, reason: "host" });
    expect(holderOf(profile, targets.job)!.evidence).toBeUndefined();
    expect(profile.history.filter((entry) => entry.path.includes("evidence"))).toEqual([]);
  });

  it("keeps the words squeezed to one line and to what the profile keeps", () => {
    const { profile, targets } = everything();
    const result = addEvidence(profile, targets.job, link("https://ejemplo.com/a", `Mi   trabajo\n${"x".repeat(400)}`), ctx);
    expect(result.ok && result.evidence.phrase.startsWith("Mi trabajo xxx")).toBe(true);
    expect(result.ok && result.evidence.phrase.length).toBe(300);
  });

  it("does not put the same page twice on a thing, however it is written, and does on another", () => {
    const { profile, targets } = everything();
    expect(addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda"), ctx).ok).toBe(true);
    for (const again of ["github.com/perfil-ejemplo/tienda", "https://www.github.com/perfil-ejemplo/tienda/", "HTTPS://GITHUB.COM/PERFIL-EJEMPLO/tienda"]) {
      expect(addEvidence(profile, targets.project, link(again), ctx), again).toEqual({ ok: false, reason: "duplicate" });
    }
    expect(addEvidence(profile, targets.job, link("https://github.com/perfil-ejemplo/tienda"), ctx).ok).toBe(true);
  });

  it(`puts at most ${MAX_EVIDENCE} on a thing, and a taken-off one gives its place back`, () => {
    const { profile, targets } = everything();
    for (let index = 0; index < MAX_EVIDENCE; index += 1) expect(addEvidence(profile, targets.cert, link(`https://ejemplo.com/${index}`), ctx).ok).toBe(true);
    expect(addEvidence(profile, targets.cert, link("https://ejemplo.com/otro"), ctx)).toEqual({ ok: false, reason: "full" });
    const first = activeEvidence(holderOf(profile, targets.cert)!)[0]!;
    expect(removeEvidence(profile, targets.cert, first.id, ctx)).toBe(true);
    expect(addEvidence(profile, targets.cert, link("https://ejemplo.com/otro"), ctx).ok).toBe(true);
  });

  it("is for a thing that is there", () => {
    const { profile } = everything();
    expect(addEvidence(profile, { kind: "project", id: "nada" }, link("https://ejemplo.com/a"), ctx)).toEqual({ ok: false, reason: "nothing_there" });
  });

  it("says each problem in words", () => {
    for (const text of Object.values(ADD_PROBLEM)) expect(text.length).toBeGreaterThan(10);
  });
});

describe("evidence from a register or a signature", () => {
  it("is what the person saw in a register, in their words, with the address only when they have one", () => {
    const { profile, targets } = everything();
    expect(addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "" }, ctx)).toEqual({ ok: false, reason: "phrase" });
    expect(addEvidence(profile, targets.study, { type: "registry", phrase: "Figura mi título" }, ctx)).toEqual({ ok: false, reason: "registry" });
    const saved = addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "Figura mi título, de 2019" }, ctx);
    expect(saved).toMatchObject({ ok: true, evidence: { type: "registry", registry: "graduados", url: "", phrase: "Figura mi título, de 2019" } });
    // The same words in the same register are one thing seen twice.
    expect(addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "figura mi titulo, de 2019" }, ctx)).toEqual({ ok: false, reason: "duplicate" });
    expect(addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "Lo vi de nuevo", url: "https://registrograduados.siu.edu.ar/x" }, ctx).ok).toBe(true);
  });

  it("is a signature checked, with how", () => {
    const { profile, targets } = everything();
    expect(addEvidence(profile, targets.cert, { type: "signed" }, ctx)).toEqual({ ok: false, reason: "check" });
    const check = { alg: "ES256", keyFrom: "jwk", at: STAMP };
    const saved = addEvidence(profile, targets.cert, { type: "signed", via: "badge", check }, ctx);
    expect(saved).toMatchObject({ ok: true, evidence: { type: "signed", via: "badge", check } });
  });
});

describe("taking evidence off", () => {
  it("keeps it, inert and marked with the day, so that a copy that still has it does not bring it back", () => {
    const { profile, targets } = everything();
    const added = addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda"), ctx);
    if (!added.ok) throw new Error("not added");
    expect(removeEvidence(profile, targets.project, added.evidence.id, { now: "2026-10-08T10:00:00.000Z", newId })).toBe(true);
    const holder = holderOf(profile, targets.project)!;
    expect(activeEvidence(holder)).toEqual([]);
    expect(holder.evidence).toEqual([{ ...added.evidence, removedAt: "2026-10-08T10:00:00.000Z" }]);
    expect(removeEvidence(profile, targets.project, added.evidence.id, ctx)).toBe(false);
    expect(profile.history.at(-1)).toMatchObject({ op: "set", path: ["projects", targets.project.id, "evidence", added.evidence.id] });
  });

  it("can be taken back from the history, as it was", () => {
    const { profile, targets } = everything();
    const added = addEvidence(profile, targets.job, link("https://ejemplo.com/a"), ctx);
    if (!added.ok) throw new Error("not added");
    removeEvidence(profile, targets.job, added.evidence.id, ctx);
    const undone = undoEntry(profile, profile.history[profile.history.length - 1]!.id, ctx);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(activeEvidence(holderOf(undone.profile, targets.job)!)).toEqual([added.evidence]);
  });

  it("and so can adding it", () => {
    const { profile, targets } = everything();
    addEvidence(profile, targets.job, link("https://ejemplo.com/a"), ctx);
    const undone = undoEntry(profile, profile.history[profile.history.length - 1]!.id, ctx);
    expect(undone.ok && holderOf(undone.profile, targets.job)!.evidence).toEqual([]);
  });
});

describe("putting back what was just taken off (U41)", () => {
  const REMOVED_AT = "2026-10-08T10:00:00.000Z";
  /** A project with two pages beside it, the first one taken off: what «Deshacer» sees right after «Quitar». */
  function aFirstOneTakenOff() {
    const { profile, targets } = everything();
    const first = addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda", "El código"), ctx);
    const second = addEvidence(profile, targets.project, link("https://ejemplo.com/tienda", "La tienda andando"), ctx);
    if (!first.ok || !second.ok) throw new Error("not added");
    const steps = profile.history.length;
    removeEvidence(profile, targets.project, first.evidence.id, { now: REMOVED_AT, newId });
    return { profile, targets, first: first.evidence, second: second.evidence, steps };
  }

  it("clears the mark and keeps the rest of it as it was", () => {
    const { profile, targets, first, second } = aFirstOneTakenOff();
    expect(restoreEvidence(profile, targets.project, first.id, { now: REMOVED_AT, newId })).toBe("restored");
    expect(activeEvidence(holderOf(profile, targets.project)!)).toEqual([first, second]);
    expect(holderOf(profile, targets.project)!.evidence!.find((entry) => entry.id === first.id)).not.toHaveProperty("removedAt");
  });

  it("leaves no trace in the history when it is right after taking it off, since it is as if it never happened", () => {
    const { profile, targets, first, steps } = aFirstOneTakenOff();
    expect(profile.history).toHaveLength(steps + 1);
    expect(restoreEvidence(profile, targets.project, first.id, { now: REMOVED_AT, newId })).toBe("restored");
    expect(profile.history).toHaveLength(steps);
  });

  it("is one more step in the history when it is later, with the page as it was", () => {
    const { profile, targets, first, steps } = aFirstOneTakenOff();
    expect(restoreEvidence(profile, targets.project, first.id, { now: "2026-10-09T10:00:00.000Z", newId })).toBe("restored");
    expect(profile.history).toHaveLength(steps + 2);
    expect(profile.history[profile.history.length - 1]).toMatchObject({ op: "set", path: ["projects", targets.project.id, "evidence", first.id], after: first });
  });

  it("touches only that piece: what was edited since stays as it is — which is why it is not the profile as it was", () => {
    const { profile, targets, first } = aFirstOneTakenOff();
    profile.projects.find((project) => project.id === targets.project.id)!.name.value = "Mi tienda online";
    profile.skills.push(...everything().profile.skills);
    expect(restoreEvidence(profile, targets.project, first.id, ctx)).toBe("restored");
    expect(profile.projects.find((project) => project.id === targets.project.id)!.name.value).toBe("Mi tienda online");
  });

  it("is not done when one just like it is there again: a second copy of the same page would be two", () => {
    const { profile, targets, first } = aFirstOneTakenOff();
    expect(addEvidence(profile, targets.project, link("github.com/perfil-ejemplo/tienda", "Otra vez"), ctx).ok).toBe(true);
    const before = structuredClone(profile);
    expect(restoreEvidence(profile, targets.project, first.id, ctx)).toBe("already");
    expect(profile).toEqual(before);
  });

  it(`is not done when the thing already shows ${MAX_EVIDENCE}: which one goes is the person's to say`, () => {
    const { profile, targets, first } = aFirstOneTakenOff();
    for (let index = 0; activeEvidence(holderOf(profile, targets.project)!).length < MAX_EVIDENCE; index += 1) {
      expect(addEvidence(profile, targets.project, link(`https://ejemplo.com/otra-${index}`), ctx).ok).toBe(true);
    }
    const before = structuredClone(profile);
    expect(restoreEvidence(profile, targets.project, first.id, ctx)).toBe("full");
    expect(profile).toEqual(before);
  });

  it("is nothing when there is nothing to put back: it was never there, it is on show, or the thing is gone", () => {
    const { profile, targets, second } = aFirstOneTakenOff();
    const before = structuredClone(profile);
    expect(restoreEvidence(profile, targets.project, second.id, ctx)).toBe("gone");
    expect(restoreEvidence(profile, targets.project, "no-existe", ctx)).toBe("gone");
    expect(restoreEvidence(profile, { kind: "project", id: "nada" }, second.id, ctx)).toBe("gone");
    expect(profile).toEqual(before);
  });

  it("works on the four kinds of thing", () => {
    const { profile, targets } = everything();
    for (const target of Object.values(targets)) {
      const added = addEvidence(profile, target, link("https://ejemplo.com/obras", "Fotos de obras"), ctx);
      if (!added.ok) throw new Error("not added");
      expect(removeEvidence(profile, target, added.evidence.id, ctx), target.kind).toBe(true);
      expect(restoreEvidence(profile, target, added.evidence.id, ctx), target.kind).toBe("restored");
      expect(activeEvidence(holderOf(profile, target)!), target.kind).toEqual([added.evidence]);
    }
  });
});

describe("counting what is shown (I4)", () => {
  it("counts each thing once, by the strongest it has, and says only what there is", () => {
    const { profile, targets } = everything();
    expect(verificationCounts(profile)).toEqual({ link: 0, registry: 0, signed: 0 });
    expect(verificationLine(verificationCounts(profile))).toBeNull();

    addEvidence(profile, targets.job, link("https://ejemplo.com/a"), ctx);
    addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda"), ctx);
    addEvidence(profile, targets.study, { type: "registry", registry: "graduados", phrase: "Figura" }, ctx);
    expect(verificationCounts(profile)).toEqual({ link: 2, registry: 1, signed: 0 });
    expect(verificationLine(verificationCounts(profile))).toBe("Con respaldo: 2 con un enlace y 1 en un registro oficial.");

    // A thing with a link and a signature is one with a signature.
    addEvidence(profile, targets.cert, link("https://ejemplo.com/m"), ctx);
    addEvidence(profile, targets.cert, { type: "signed", check: { alg: "ES256", keyFrom: "jwk", at: STAMP } }, ctx);
    expect(strongest(holderOf(profile, targets.cert)!)).toBe("signed");
    expect(verificationCounts(profile)).toEqual({ link: 2, registry: 1, signed: 1 });
    expect(verificationLine(verificationCounts(profile))).toBe("Con respaldo: 2 con un enlace, 1 en un registro oficial y 1 con firma.");
  });

  it("does not count what was taken off, or what no CV uses", () => {
    const { profile, targets } = everything();
    const added = addEvidence(profile, targets.job, link("https://ejemplo.com/a"), ctx);
    if (!added.ok) throw new Error("not added");
    addEvidence(profile, targets.cert, link("https://ejemplo.com/m"), ctx);
    profile.certifications[0]!.excluded = true;
    expect(verificationCounts(profile)).toEqual({ link: 1, registry: 0, signed: 0 });
    removeEvidence(profile, targets.job, added.evidence.id, ctx);
    expect(verificationCounts(profile)).toEqual({ link: 0, registry: 0, signed: 0 });
  });

  it("is never a percentage, and never says what is missing", () => {
    const line = verificationLine({ link: 3, registry: 0, signed: 0 })!;
    expect(line).toBe("Con respaldo: 3 con un enlace.");
    expect(line).not.toMatch(/%|sin respaldo|falta|de \d+/i);
    expect(Object.values(EVIDENCE_LABEL).every((label) => label.length > 3)).toBe(true);
  });
});

describe("putting a page among the links of the CV", () => {
  it("adds it once, to the person's own list, and not past the three a CV takes", () => {
    const { profile } = everything();
    expect(inCvLinks(profile, "https://github.com/perfil-ejemplo/tienda")).toBe(false);
    expect(addCvLink(profile, "https://github.com/perfil-ejemplo/tienda", ctx)).toBe("added");
    expect(profile.contact.links.value).toEqual([{ label: expect.stringContaining("github.com/perfil-ejemplo"), url: "https://github.com/perfil-ejemplo/tienda" }]);
    expect(inCvLinks(profile, "github.com/perfil-ejemplo/tienda/")).toBe(true);
    expect(addCvLink(profile, "https://www.github.com/perfil-ejemplo/tienda", ctx)).toBe("already");
    for (let index = 0; index < 2; index += 1) expect(addCvLink(profile, `https://ejemplo.com/${index}`, ctx)).toBe("added");
    expect(profile.contact.links.value).toHaveLength(3);
    expect(addCvLink(profile, "https://ejemplo.com/otra", ctx)).toBe("full");
    expect(profile.contact.links.value).toHaveLength(3);
  });
});

describe("how it is stored", () => {
  it("is not there in a profile from before it existed, and no key appears for it", () => {
    const { profile } = everything();
    const parsed = storedProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    for (const thing of [...parsed.experience, ...parsed.education, ...parsed.certifications, ...parsed.projects]) expect("evidence" in thing && thing.evidence !== undefined).toBe(false);
  });

  it("keeps the entries that are one and lets go of the rest, so that one bad one does not cost the profile", () => {
    const { profile, targets } = everything();
    addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda"), ctx);
    const raw = JSON.parse(JSON.stringify(profile));
    raw.projects[0].evidence.push("basura", 7, null, { id: "" }, { nada: true });
    const parsed = storedProfileSchema.parse(raw);
    expect(parsed.projects[0]!.evidence).toHaveLength(1);
    raw.projects[0].evidence = "no es una lista";
    expect(storedProfileSchema.parse(raw).projects[0]!.evidence).toBeUndefined();
  });

  it("degrades a kind it does not know to a link, and keeps the rest of what it has", () => {
    const parsed = evidenceSchema.parse({ id: "e1", type: "holograma", url: "https://ejemplo.com/a", phrase: "Algo", at: STAMP, via: "marte", check: 3 });
    expect(parsed).toMatchObject({ id: "e1", type: "link", url: "https://ejemplo.com/a", phrase: "Algo" });
    expect(parsed.via).toBeUndefined();
    expect(parsed.check).toBeUndefined();
  });

  it("goes with the profile to an account, and to no model", () => {
    const { profile, targets } = everything();
    addEvidence(profile, targets.project, link("https://github.com/perfil-ejemplo/tienda", "El código de mi tienda"), ctx);
    addEvidence(profile, targets.cert, link("https://camuzzi.example.com/m", "Mi ficha de matriculada"), ctx);
    const synced = forSync(profile);
    expect(JSON.stringify(synced)).toContain("https://github.com/perfil-ejemplo/tienda");
    // The plain profile is what the generators read: the evidence is for the person, and not for a model.
    const plain = JSON.stringify(toPlainProfile(profile));
    expect(plain).not.toContain("github.com/perfil-ejemplo/tienda");
    expect(plain).not.toContain("El código de mi tienda");
    expect(plain).not.toContain("matriculada");
  });
});

describe("joining two copies of one profile", () => {
  it("brings the account's evidence of a thing both have, to each of the four kinds", () => {
    const { profile: local, targets } = everything();
    const account = copy(local);
    for (const target of Object.values(targets)) addEvidence(account, target, link(`https://ejemplo.com/${target.kind}`), ctx);
    const { profile, added } = joinProfiles(local, account);
    for (const target of Object.values(targets)) expect(activeEvidence(holderOf(profile, target)!).map((entry) => entry.url), target.kind).toEqual([`https://ejemplo.com/${target.kind}`]);
    expect(added.evidence).toBe(4);
    expect(describeJoin(added)).toBe("4 respaldos");
  });

  it("finds the thing by what it says and not by an id the other device made up", () => {
    const { profile: local, targets } = everything();
    const account = copy(local);
    // The account has the same project under another id.
    account.projects[0]!.id = "otro-id";
    addEvidence(account, { kind: "project", id: "otro-id" }, link("https://github.com/perfil-ejemplo/tienda"), ctx);
    const { profile, added } = joinProfiles(local, account);
    expect(profile.projects).toHaveLength(1);
    expect(activeEvidence(holderOf(profile, targets.project)!)).toHaveLength(1);
    expect(added.evidence).toBe(1);
  });

  it("does not make two of the same page said on both sides, and does not count it as brought", () => {
    const { profile: local, targets } = everything();
    addEvidence(local, targets.job, link("https://ejemplo.com/a", "Mis obras"), ctx);
    const account = copy(local);
    // Another id for the same page, written another way.
    account.experience[0]!.evidence![0]!.id = "e-de-la-cuenta";
    account.experience[0]!.evidence![0]!.url = "https://www.ejemplo.com/a/";
    const { profile, added } = joinProfiles(local, account);
    expect(activeEvidence(holderOf(profile, targets.job)!)).toHaveLength(1);
    expect(added.evidence).toBe(0);
  });

  it("does not bring back what this browser took off", () => {
    const { profile: local, targets } = everything();
    const added = addEvidence(local, targets.project, link("https://github.com/perfil-ejemplo/tienda"), ctx);
    if (!added.ok) throw new Error("not added");
    const account = copy(local);
    removeEvidence(local, targets.project, added.evidence.id, ctx);
    const { profile, added: counts } = joinProfiles(local, account);
    expect(activeEvidence(holderOf(profile, targets.project)!)).toEqual([]);
    expect(counts.evidence).toBe(0);
  });

  it("takes off here what the account took off, and keeps what only this browser has", () => {
    const { profile: local, targets } = everything();
    const gone = addEvidence(local, targets.job, link("https://ejemplo.com/a"), ctx);
    if (!gone.ok) throw new Error("not added");
    const account = copy(local);
    removeEvidence(account, targets.job, gone.evidence.id, ctx);
    addEvidence(local, targets.job, link("https://ejemplo.com/solo-aca"), ctx);
    const { profile } = joinProfiles(local, account);
    expect(activeEvidence(holderOf(profile, targets.job)!).map((entry) => entry.url)).toEqual(["https://ejemplo.com/solo-aca"]);
  });

  it("brings the evidence of a thing that only the account has, with the thing", () => {
    const { profile: local } = everything();
    const account = copy(local);
    const extra = addCertification(account, { name: "Curso de Excel", issuer: "Fundación" }, ctx)!;
    addEvidence(account, { kind: "certification", id: extra.id }, link("https://fundacion.example.com/c/1", "Mi certificado"), ctx);
    const { profile } = joinProfiles(local, account);
    expect(activeEvidence(profile.certifications.find((cert) => cert.name.value === "Curso de Excel")!)).toHaveLength(1);
  });

  it("changes nothing when neither has any", () => {
    const { profile: local } = everything();
    const { profile, added } = joinProfiles(local, copy(local));
    expect(added.evidence).toBe(0);
    for (const thing of [...profile.experience, ...profile.certifications]) expect(thing.evidence).toBeUndefined();
  });
});

describe("the list on its own", () => {
  const entry = (id: string, url: string, extra: Partial<Evidence> = {}): Evidence => ({ id, type: "link", url, phrase: "x", at: STAMP, ...extra });

  it("is nothing when there is nothing on either side", () => {
    expect(joinEvidence(undefined, undefined)).toEqual({ list: undefined, added: 0 });
    expect(joinEvidence([], [])).toEqual({ list: [], added: 0 });
  });

  it("brings what only the other has and counts only what is in sight", () => {
    const { list, added } = joinEvidence([entry("a", "https://ejemplo.com/a")], [entry("b", "https://ejemplo.com/b"), entry("c", "https://ejemplo.com/c", { removedAt: STAMP })]);
    expect(list?.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(added).toBe(1);
  });
});
