import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNote, settleNote } from "@/lib/profile/capture";
import { emptyStoredProfile, type StoredProfile } from "@/lib/schemas/profile-v2";
import { STAMP, newId, profileWith } from "./helpers/profiles";

/**
 * What the profile and the app draw of «Anotá algo» and of the calendar reminder (e5, O15 and O16): nothing at all with the switches off, and with them on the button
 * for any screen, the box, the notes with their date and their state, and the form of the reminder. The interactions are the browser walkthroughs'.
 */

// `NoteCapture` asks where it is, what the profile is and for the toasts: none of which a render without a browser has.
const state = vi.hoisted(() => ({ pathname: "/perfil", profile: null as unknown }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/storage/hooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/storage/hooks")>()), useStoredProfile: () => state.profile }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {}, ToastProvider: ({ children }: { children: unknown }) => children }));

const { NoteCapture } = await import("@/components/notes/NoteCapture");
const { NoteForm } = await import("@/components/notes/NoteForm");
const { NotesList } = await import("@/components/profile/hub/NotesList");
const { ReminderForm } = await import("@/components/profile/ReminderForm");

afterEach(() => {
  vi.unstubAllEnvs();
  state.pathname = "/perfil";
});

const on = (...ids: string[]) => vi.stubEnv("NEXT_PUBLIC_CVP_EXPERIMENTS", ids.join(","));
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const started = (): StoredProfile => {
  const profile = emptyStoredProfile();
  profile.onboarding.done = true;
  return profile;
};

describe("the button for any screen", () => {
  it("is not there with the switch off, whatever the screen", () => {
    state.profile = started();
    expect(html(createElement(NoteCapture))).toBe("");
  });

  it("is there with it on, once the profile is started, with the words it has", () => {
    on("note_capture");
    state.profile = started();
    const drawn = html(createElement(NoteCapture));
    expect(drawn).toContain("data-note-capture");
    expect(text(drawn)).toContain("+ Anotá algo");
  });

  it("is not there while the profile is being started, nor on the page that already is the box", () => {
    on("note_capture");
    state.profile = emptyStoredProfile();
    expect(html(createElement(NoteCapture))).toBe("");
    state.profile = started();
    for (const pathname of ["/perfil/empezar", "/perfil/empezar/paso", "/anotar", "/anotar/recibir"]) {
      state.pathname = pathname;
      expect(html(createElement(NoteCapture)), pathname).toBe("");
    }
    state.pathname = "/postular";
    expect(html(createElement(NoteCapture))).toContain("data-note-capture");
  });

  it("asks whether it is on in the browser, in its effect: the render that hydrates a page still says what the server said", () => {
    // A switch that only this browser has (the development one) would otherwise send the person to their profile before the page had looked at it.
    const page = readFileSync("components/notes/SharedNote.tsx", "utf8");
    expect(page).toMatch(/useEffect\(\(\) => \{[\s\S]*?experimentOn\("note_capture"\)[\s\S]*?router\.replace\("\/perfil"\)/);
    expect(page).not.toMatch(/if \(!on\) \{\s*router\.replace/);
  });

  it("is mounted in the app's shell, once, and the shell draws nothing else for it", () => {
    const shell = readFileSync("app/(app)/AppShell.tsx", "utf8");
    expect((shell.match(/<NoteCapture \/>/g) ?? []).length).toBe(1);
  });

  it("is the last thing in the page, and leaves room under it on a phone so that it covers nothing at the end of a page", () => {
    const shell = readFileSync("app/(app)/AppShell.tsx", "utf8");
    expect(shell.indexOf("<NoteCapture />")).toBeGreaterThan(shell.indexOf("{footer}"));
    on("note_capture");
    state.profile = started();
    const drawn = html(createElement(NoteCapture));
    expect(drawn).toContain('<div aria-hidden="true" class="h-8 chrome:hidden"></div>');
  });

  it("starts in sight, whatever the screen: it only goes out of the way once the page has been read downwards (U43)", () => {
    on("note_capture");
    state.profile = started();
    const drawn = html(createElement(NoteCapture));
    expect(drawn).not.toContain("data-note-capture-away");
    expect(drawn).not.toMatch(/max-chrome:(?:pointer-events-none|translate-y-20|opacity-0)/);
  });

  it("goes out of the way on a phone only, and comes back to whoever reaches it with a keyboard (U43)", () => {
    const source = readFileSync("components/notes/NoteCapture.tsx", "utf8");
    // Phone only: on a computer the corner is clear of the page and the button stays.
    const away = /away \? "([^"]*)" : ""/.exec(source)?.[1] ?? "";
    expect(away).not.toBe("");
    for (const token of away.split(/\s+/)) expect(token, token).toMatch(/^max-chrome:/);
    // Out of the way is out of the way for a finger too, and not for the keyboard: focusing it brings it back.
    expect(away).toContain("max-chrome:pointer-events-none");
    expect(away).toContain("max-chrome:focus-visible:pointer-events-auto");
    expect(away).toContain("max-chrome:focus-visible:opacity-100");
    // Down hides it and up shows it, with a margin for a finger that rests; nothing hides it in the first screen.
    expect(source).toMatch(/setHidden\(phone\.matches && moved > 0 && at > SCROLL_FROM\)/);
    // The same width as the `chrome` of the classes that hide it, so that the two cannot disagree.
    expect(source).toContain('window.matchMedia("(width < 46rem)")');
    expect(source).toMatch(/if \(Math\.abs\(moved\) < SCROLL_STEP\) return;/);
    // The page, and the sheet that holds the profile on a phone (an element's scroll does not bubble: it is caught on the way down, and only the content of a sheet counts).
    expect(source).toMatch(/window\.addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/);
    expect(source).toMatch(/window\.removeEventListener\("scroll", onScroll, \{ capture: true \}\)/);
    expect(source).toContain('hasAttribute("data-bottom-sheet")');
  });

  it("is one step under the notice that offers to put back what was taken out: the notice stays until it is answered, and sits in the same corner", () => {
    const layer = (file: string, anchor: string): number => Number(new RegExp(`${anchor}[^"]*?z-(?:\\[)?(\\d+)`).exec(readFileSync(file, "utf8"))?.[1] ?? NaN);
    const button = layer("components/notes/NoteCapture.tsx", "data-note-capture\\s+className=\\{`fixed");
    const notice = layer("components/profile/hub/removal.tsx", "role=\"status\"\\s+className=\"fixed");
    expect(button).toBe(40);
    expect(notice).toBeGreaterThan(button);
    // And under the tab bar, the toasts and the modals, which are what is above everything.
    expect(notice).toBeLessThan(50);
  });
});

describe("the box", () => {
  it("is one box, with what it does said in words — the date, where it stays — and a way out as easy as the way in", () => {
    const drawn = html(createElement(NoteForm, { via: "capture", onSaved: () => {}, onClose: () => {} }));
    expect(drawn).toContain("data-note-form");
    expect((drawn.match(/<textarea/g) ?? []).length).toBe(1);
    const said = text(drawn);
    expect(said).toContain("Anotá algo");
    // The date is said in the box itself — in what it shows while it is empty — and where it stays, under it.
    expect(drawn).toContain("Se guarda con la fecha de hoy");
    expect(said).toContain("Queda en tus notas, en este navegador");
    expect(said).toContain("Guardar");
    expect(said).toContain("Cerrar");
    // Nothing to fill in first, and nothing that says how much to write.
    expect(said).not.toMatch(/obligatori|requerid|m[íi]nimo|ejemplo/i);
  });

  it("starts with what was shared, when something was, and says so in the button that does not keep it", () => {
    const drawn = html(createElement(NoteForm, { via: "share", initial: "Felicitaciones por el cierre", onSaved: () => {}, onClose: () => {}, closeLabel: "Cerrar sin guardar" }));
    expect(drawn).toContain("Felicitaciones por el cierre");
    expect(text(drawn)).toContain("Cerrar sin guardar");
  });
});

describe("the notes of the profile", () => {
  const withNotes = () => {
    const profile = profileWith({ company: "Logística Sur", role: "Operario", from: { year: 2023 }, to: "current" });
    profile.notes.push({ id: "viejo", text: "Lo que conté al empezar", at: "2026-01-02T10:00:00.000Z" });
    captureNote(profile, "En Logística Sur reordené el picking", "capture", { now: "2026-09-03T12:00:00.000Z", newId });
    const shared = captureNote(profile, "Felicitaciones por el cierre", "share", { now: "2026-09-10T12:00:00.000Z", newId });
    const dealt = captureNote(profile, "Ya la puse en su lugar", "capture", { now: "2026-09-12T12:00:00.000Z", newId });
    if (!shared.ok || !dealt.ok) throw new Error("not written");
    settleNote(profile, dealt.note.id, { now: STAMP, newId });
    return profile;
  };
  const draw = (profile: StoredProfile) => html(createElement(NotesList, { profile, onRemoved: () => {} }));

  it("draw nothing of this with the switch off: not the date, not the state, not the count", () => {
    const drawn = draw(withNotes());
    for (const trace of ["data-note-meta", "data-notes-unsorted", "Dejarla como nota", "sin ordenar", "Anotada el", "Compartida el"]) expect(drawn, trace).not.toContain(trace);
    expect(drawn).toContain("En Logística Sur reordené el picking");
  });

  it("say the date each was written on and whether it waits, count what waits, and offer to leave it as it is", () => {
    on("note_capture");
    const drawn = draw(withNotes());
    const said = text(drawn);
    expect(said).toContain("Tenés 2 notas sin ordenar.");
    expect(said).toContain("Anotada el 3 de septiembre de 2026 · sin ordenar");
    expect(said).toContain("Compartida el 10 de septiembre de 2026 · sin ordenar");
    // Dealt with: the date, and no longer one to sort.
    expect(said).toContain("Anotada el 12 de septiembre de 2026");
    expect(said).not.toContain("Anotada el 12 de septiembre de 2026 · sin ordenar");
    expect((drawn.match(/Dejarla como nota/g) ?? []).length).toBe(2);
    expect((drawn.match(/data-note-unsorted/g) ?? []).length).toBe(2);
  });

  it("say nothing about a note that was told at the start or read from a document, and no count when nothing waits", () => {
    on("note_capture");
    const profile = profileWith();
    profile.notes.push({ id: "viejo", text: "Lo que conté al empezar", at: "2026-01-02T10:00:00.000Z" });
    const drawn = draw(profile);
    expect(drawn).toContain("Lo que conté al empezar");
    expect(drawn).not.toContain("data-note-meta");
    expect(drawn).not.toContain("data-notes-unsorted");
  });

  it("never say it as something to do or something missing", () => {
    on("note_capture");
    expect(text(draw(withNotes()))).not.toMatch(/falta|pendiente|atrasad|urgente|%/i);
  });
});

describe("the reminder in the calendar", () => {
  it("is a form with the three choices of how often, the quarterly one selected, and says that the calendar is the one that reminds", () => {
    const drawn = html(createElement(ReminderForm, { onClose: () => {} }));
    expect(drawn).toContain("data-reminder-form");
    expect([...drawn.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)</g)].map((match) => `${match[1]}:${match[2]}`)).toEqual(["1:Todos los meses", "3:Cada 3 meses", "6:Cada 6 meses"]);
    expect(drawn).toMatch(/<option[^>]*value="3"[^>]*selected|<option[^>]*selected[^>]*value="3"/);
    const said = text(drawn);
    expect(said).toContain("es él quien te avisa");
    expect(said).toContain("cvexact no manda correos ni avisos");
    expect(said).toContain("Bajar el recordatorio");
  });

  it("is offered from the profile's buttons only with its switch on", () => {
    const actions = readFileSync("components/profile/ProfileActions.tsx", "utf8");
    expect(actions).toContain('useExperiment("calendar_reminder")');
    expect(actions).toMatch(/reminderOn \? \(\s*<Button/);
    expect(actions).toMatch(/\{reminderOn \? \(\s*<Modal/);
  });
});
