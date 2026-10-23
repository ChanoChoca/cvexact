import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_EVERY,
  REMINDER_EVERY,
  REMINDER_TITLE,
  escapeText,
  firstDay,
  fold,
  isReminderEvery,
  reminderDescription,
  reminderFileName,
  reminderIcs,
} from "@/lib/calendar/ics";

/**
 * The calendar file (e5, O16): one event that repeats, with the link to the app, made in the browser and carrying nothing of the person. The tests
 * read it back the way a calendar does — unfolding its lines and splitting them in a name and a value — so that what is checked is the file and not the code.
 */

const NOW = new Date(2026, 9, 8, 11, 30, 0); // 8 October 2026, local time
const ORIGIN = "https://cvexact.example.com";

/** The file as a calendar reads it: lines unfolded, then name and value. */
function parse(text: string): Array<{ name: string; params: string; value: string }> {
  expect(text.endsWith("\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  return text
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      const [name, ...params] = line.slice(0, colon).split(";");
      return { name: name!, params: params.join(";"), value: line.slice(colon + 1) };
    });
}
const field = (lines: ReturnType<typeof parse>, name: string) => lines.find((line) => line.name === name);

describe("the file", () => {
  it("is a calendar with one event, and says what version and what made it", () => {
    const lines = parse(reminderIcs({ origin: ORIGIN, every: 3, now: NOW }));
    expect(lines.map((line) => line.name)).toEqual(["BEGIN", "VERSION", "PRODID", "CALSCALE", "BEGIN", "UID", "DTSTAMP", "LAST-MODIFIED", "DTSTART", "RRULE", "SUMMARY", "DESCRIPTION", "URL", "TRANSP", "END", "END"]);
    expect(lines[0]).toMatchObject({ name: "BEGIN", value: "VCALENDAR" });
    expect(lines[4]).toMatchObject({ name: "BEGIN", value: "VEVENT" });
    expect(field(lines, "VERSION")?.value).toBe("2.0");
    expect(field(lines, "PRODID")?.value).toBe("-//cvexact//recordatorio del perfil//ES");
    expect(lines.slice(-2).map((line) => line.value)).toEqual(["VEVENT", "VCALENDAR"]);
  });

  it("repeats every so many months, from that many months on, on a day of the month that every month has", () => {
    for (const every of REMINDER_EVERY) {
      const lines = parse(reminderIcs({ origin: ORIGIN, every, now: NOW }));
      expect(field(lines, "RRULE")?.value).toBe(`FREQ=MONTHLY;INTERVAL=${every}`);
    }
    expect(field(parse(reminderIcs({ origin: ORIGIN, every: 3, now: NOW })), "DTSTART")).toMatchObject({ params: "VALUE=DATE", value: "20270108" });
    expect(field(parse(reminderIcs({ origin: ORIGIN, every: 1, now: NOW })), "DTSTART")?.value).toBe("20261108");
    expect(field(parse(reminderIcs({ origin: ORIGIN, every: 6, now: NOW })), "DTSTART")?.value).toBe("20270408");
  });

  it("keeps to the 28th, so that no month is skipped, and rolls over the year", () => {
    expect(firstDay(new Date(2026, 0, 31), 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(firstDay(new Date(2026, 7, 30), 6)).toEqual({ year: 2027, month: 2, day: 28 });
    expect(firstDay(new Date(2026, 10, 15), 3)).toEqual({ year: 2027, month: 2, day: 15 });
    expect(firstDay(new Date(2026, 11, 1), 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(firstDay(new Date(2026, 8, 5), 6)).toEqual({ year: 2027, month: 3, day: 5 });
  });

  it("is all day, does not take the person's time, and has the link to the profile of this app", () => {
    const lines = parse(reminderIcs({ origin: `${ORIGIN}/`, every: 3, now: NOW }));
    expect(field(lines, "TRANSP")?.value).toBe("TRANSPARENT");
    expect(field(lines, "URL")?.value).toBe("https://cvexact.example.com/perfil");
    expect(field(lines, "DESCRIPTION")?.value).toContain("https://cvexact.example.com/perfil");
    expect(field(lines, "DTSTART")?.params).toBe("VALUE=DATE");
  });

  it("is the same event each time, so that downloading it again replaces it in the calendar instead of piling up", () => {
    const first = parse(reminderIcs({ origin: ORIGIN, every: 3, now: NOW }));
    const again = parse(reminderIcs({ origin: ORIGIN, every: 6, now: new Date(2026, 10, 2, 9, 0, 0) }));
    expect(field(first, "UID")?.value).toBe("revisar-el-perfil@cvexact.example.com");
    expect(field(again, "UID")?.value).toBe(field(first, "UID")?.value);
    expect(field(again, "LAST-MODIFIED")?.value).not.toBe(field(first, "LAST-MODIFIED")?.value);
    expect(field(first, "DTSTAMP")?.value).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("carries nothing of the person: no name, no email, no organiser, no guest, no alarm of its own", () => {
    const text = reminderIcs({ origin: ORIGIN, every: 3, now: NOW });
    for (const forbidden of ["ORGANIZER", "ATTENDEE", "MAILTO", "mailto:", "VALARM", "CONTACT", "@example.com", "ATTACH"]) expect(text, forbidden).not.toContain(forbidden);
    // The only address in it is the app's own.
    const unfolded = text.replace(/\r\n[ \t]/g, "");
    expect([...unfolded.matchAll(/https?:\/\/[^\s\\]+/g)].map((match) => match[0])).toEqual(["https://cvexact.example.com/perfil", "https://cvexact.example.com/perfil"]);
  });

  it("says why it is there and how to stop it, and does not say how long it has been or what is missing", () => {
    const description = reminderDescription(3, "https://x.example/perfil");
    expect(description).toContain("cada 3 meses");
    expect(description).toContain("borrá el evento");
    expect(reminderDescription(1, "https://x.example/perfil")).toContain("todos los meses");
    expect(`${REMINDER_TITLE} ${description}`).not.toMatch(/falta|incompleto|hace \d+ (?:meses|días) que no|atrás|urgente|última oportunidad/i);
  });
});

describe("how it is written", () => {
  it("never leaves a line longer than 75 bytes, counting a letter with an accent as two, and reads back as it was written", () => {
    const text = reminderIcs({ origin: ORIGIN, every: 3, now: NOW });
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    const description = field(parse(text), "DESCRIPTION")!.value;
    // Unescaped, it is the text that was meant.
    expect(description.replace(/\\n/g, "\n").replace(/\\,/g, ",")).toBe(reminderDescription(3, "https://cvexact.example.com/perfil"));
  });

  it("folds only between letters", () => {
    const line = `DESCRIPTION:${"ñandú á é í ó ú ".repeat(30)}`;
    const folded = fold(line);
    expect(folded.split("\r\n").every((part, index) => (index === 0 || part.startsWith(" ")) && new TextEncoder().encode(part).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    expect(fold("DTSTART:20270108")).toBe("DTSTART:20270108");
  });

  it("writes text the way a calendar wants: the backslash, the semicolon, the comma and the line break", () => {
    expect(escapeText("a,b;c\\d\ne\r\nf")).toBe("a\\,b\;c\\\\d\\ne\\nf");
  });
});

describe("the choices", () => {
  it("are monthly, quarterly and half-yearly, with quarterly the one that starts selected", () => {
    expect([...REMINDER_EVERY]).toEqual([1, 3, 6]);
    expect(DEFAULT_REMINDER_EVERY).toBe(3);
    for (const value of REMINDER_EVERY) expect(isReminderEvery(value)).toBe(true);
    for (const value of [0, 2, 12, "3", null, undefined]) expect(isReminderEvery(value)).toBe(false);
  });

  it("name the file for what it is and how often", () => {
    expect(reminderFileName(3)).toBe("cvexact-recordatorio-cada-3-meses.ics");
    expect(reminderFileName(6)).toBe("cvexact-recordatorio-cada-6-meses.ics");
    expect(reminderFileName(1)).toBe("cvexact-recordatorio-todos-los-meses.ics");
  });
});
