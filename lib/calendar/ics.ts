/**
 * A calendar file the person downloads and keeps (e5, O16): one event that repeats every few months, with the link to their profile.
 *
 * It is the only reminder this product has, and it is not the product's: the notice is given by the calendar the person opens it with, and
 * whoever does not want it deletes the event there. Nothing is sent and nothing is asked of a server — the file is made in the browser, from
 * the address of this page and today's date, and carries nothing of the profile: no name, no email, no organiser, no guest. The report that
 * proposed it (E4, 2c) is plain about why it is the one reminder that fits: «sin recordatorios» stays true, because it is the person who asked,
 * in their own calendar, and can stop it there.
 *
 * Pure, so what it writes is tried: `now` and `origin` are handed in.
 */

/** Every how many months it repeats: monthly, quarterly — the one E4 names — and half-yearly. Nothing shorter, which is a nag, or longer, which is forgotten. */
export const REMINDER_EVERY = [1, 3, 6] as const;
export type ReminderEvery = (typeof REMINDER_EVERY)[number];
export const DEFAULT_REMINDER_EVERY: ReminderEvery = 3;

export const isReminderEvery = (value: unknown): value is ReminderEvery => REMINDER_EVERY.includes(value as ReminderEvery);

const pad = (value: number): string => String(value).padStart(2, "0");

/** A day, as the three numbers a calendar date is made of: the month from 1 to 12. */
export type CalendarDay = { year: number; month: number; day: number };

/**
 * The first day it falls on: this day, this many months on. The day of the month is kept to the 28th at most, because a repeat on the 31st skips every
 * month that has no 31st — and an event that disappears in February is a reminder that does not remind.
 */
export function firstDay(now: Date, every: ReminderEvery): CalendarDay {
  const months = now.getFullYear() * 12 + now.getMonth() + every;
  return { year: Math.floor(months / 12), month: (months % 12) + 1, day: Math.min(now.getDate(), 28) };
}

const dateOf = (day: CalendarDay): string => `${day.year}${pad(day.month)}${pad(day.day)}`;

/** A moment in UTC, the way a calendar file writes it: `20261008T143000Z`. */
const stampOf = (when: Date): string =>
  `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}T${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`;

/** Text in a calendar file: a backslash, a semicolon, a comma and a line break each have their own way of being written (RFC 5545, 3.3.11). */
export const escapeText = (text: string): string => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const encoder = new TextEncoder();

/**
 * A line folded to the 75 bytes a calendar file allows (RFC 5545, 3.1): the rest goes on the next line, after a space. Cut by bytes and never in
 * the middle of a letter — «á» is two — so that a line that is folded reads back as it was written.
 */
export function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The continuation lines begin with a space, which is one of their 75.
    const room = lines.length === 0 ? 75 : 74;
    if (size + bytes > room) {
      lines.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  lines.push(current);
  return lines.join("\r\n ");
}

/** What the event is called, and what it says: the date of nothing and the absence of nobody — a reason to come back, and how to stop it. */
export const REMINDER_TITLE = "Revisar mi perfil en cvexact";

export function reminderDescription(every: ReminderEvery, url: string): string {
  const when = every === 1 ? "todos los meses" : `cada ${every} meses`;
  return [
    `Entrá a tu perfil y mirá si algo cambió desde la última vez: agregá lo nuevo y sacá lo que ya no va. ${url}`,
    `Lo pediste vos para acordarte ${when}. Lo guarda tu calendario y cvexact no sabe que lo tenés: si no lo querés más, borrá el evento.`,
  ].join("\n\n");
}

export type ReminderInput = {
  /** The address of this app, as the browser has it (`https://cvexact.example`): the link goes to its profile. */
  origin: string;
  every: ReminderEvery;
  now: Date;
};

/**
 * The file. One event, all day, that repeats every `every` months from this day that many months on; it does not block the person's time, and
 * carries a link. Always the same event for the same interval (the identifier is fixed), so that downloading it again — to change the interval,
 * say — replaces the one in the calendar and does not pile a second one on it.
 */
export function reminderIcs({ origin, every, now }: ReminderInput): string {
  const url = `${origin.replace(/\/+$/, "")}/perfil`;
  const start = firstDay(now, every);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//cvexact//recordatorio del perfil//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:revisar-el-perfil@${new URL(url).hostname}`,
    `DTSTAMP:${stampOf(now)}`,
    `LAST-MODIFIED:${stampOf(now)}`,
    `DTSTART;VALUE=DATE:${dateOf(start)}`,
    `RRULE:FREQ=MONTHLY;INTERVAL=${every}`,
    `SUMMARY:${escapeText(REMINDER_TITLE)}`,
    `DESCRIPTION:${escapeText(reminderDescription(every, url))}`,
    `URL:${url}`,
    // An all-day reminder is not a commitment: it must not turn the person's day into «busy».
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The name of the file, which says what it is for and how often: `cvexact-recordatorio-cada-3-meses.ics`. */
export const reminderFileName = (every: ReminderEvery): string => `cvexact-recordatorio-${every === 1 ? "todos-los-meses" : `cada-${every}-meses`}.ics`;
