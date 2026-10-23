import { describe, expect, it } from "vitest";
import { installOffer } from "@/lib/pwa/install";
import {
  COPY_REASON,
  NO_COPY_YET,
  RISK_TEXT,
  SAFARI_COPY_WINDOW_DAYS,
  UNKNOWN_SETTING,
  browserOf,
  copyFooter,
  copySavedLines,
  copyWindowDays,
  inWeeks,
  lastCopyLine,
  offersFor,
  placeOf,
  riskOf,
  settingOf,
  snoozeDays,
  type Risk,
} from "@/lib/storage/durability";
import { RULES } from "@/lib/voice";

/**
 * O1 (e5): what can take the profile from each browser, and what is offered about it. The facts are WebKit's (webkit.org/blog/10218
 * and /14403): Safari deletes a site's script-writable storage after seven days of use without a visit; an app on the home screen
 * counts its own days; Chromium and Firefox delete under storage pressure unless the site may keep its data.
 */

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari17: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari16: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  unknown: "SomeBrowser/1.0",
};

const agent = (userAgent: string, platform = "Linux x86_64", touchPoints = 0) => ({ userAgent, platform, touchPoints });

describe("which browser", () => {
  it("tells Safari on an iPhone or an iPad from Safari on a Mac, and both from what only looks like them", () => {
    expect(browserOf(agent(UA.iphoneSafari, "iPhone", 5))).toBe("safari");
    expect(browserOf(agent(UA.macSafari17, "MacIntel"))).toBe("safari-mac");
    expect(browserOf(agent(UA.macSafari16, "MacIntel"))).toBe("safari-mac");
    // An iPad that asks to be taken for a Mac, given away by its touch screen.
    expect(browserOf(agent(UA.ipadAsMac, "MacIntel", 5))).toBe("safari");
    // Every browser on iOS says "Safari" in its name; Chrome, and an app's own window, are not Safari.
    expect(browserOf(agent(UA.iphoneChrome, "iPhone", 5))).toBe("ios-other");
    expect(browserOf(agent(UA.iphoneInstagram, "iPhone", 5))).toBe("ios-other");
  });

  it("tells Chromium and Firefox apart, wherever they run", () => {
    for (const userAgent of [UA.macChrome, UA.androidChrome, UA.samsung, UA.edge]) expect(browserOf(agent(userAgent)), userAgent).toBe("chromium");
    expect(browserOf(agent(UA.firefox))).toBe("firefox");
    expect(browserOf(agent(UA.firefoxAndroid))).toBe("firefox");
    expect(browserOf(agent(UA.unknown))).toBe("other");
  });

  it("knows whether it runs as an app, and assumes nothing before it can be read", () => {
    expect(settingOf({ ...agent(UA.iphoneSafari, "iPhone", 5), standalone: true })).toEqual({ browser: "safari", installed: true });
    expect(UNKNOWN_SETTING).toEqual({ browser: "other", installed: false });
  });
});

describe("what can take it, and what is offered", () => {
  it("is the seven days in a Safari tab, and installing is what helps there — not the button that asks to keep it", () => {
    const tab = { browser: "safari" as const, installed: false };
    expect(riskOf(tab)).toBe("seven_days");
    expect(offersFor(tab)).toEqual(["install", "copy", "account"]);
    expect(RISK_TEXT.seven_days).toContain("siete días");
  });

  it("is a counter of its own for an app on the home screen of an iPhone — the one place WebKit says so", () => {
    expect(riskOf({ browser: "safari", installed: true })).toBe("own_counter");
    // Safari 17 grants persistence mostly to such an app: there the button is worth showing.
    expect(offersFor({ browser: "safari", installed: true })).toContain("persist");
    expect(RISK_TEXT.own_counter).toContain("según el equipo de Safari");
  });

  it("is the seven days in a Safari tab on a Mac too, and for an app in the Dock nothing is promised: WebKit says nothing of it", () => {
    expect(riskOf({ browser: "safari-mac", installed: false })).toBe("seven_days");
    expect(offersFor({ browser: "safari-mac", installed: false })).toEqual(["install", "copy", "account"]);
    expect(riskOf({ browser: "safari-mac", installed: true })).toBe("dock");
    expect(offersFor({ browser: "safari-mac", installed: true })).toEqual(["persist", "copy", "account"]);
    // The claim is Safari's about the iPhone, and is not made of the Dock.
    expect(RISK_TEXT.dock).not.toContain("según el equipo de Safari");
    expect(RISK_TEXT.dock).toContain("Safari no dice");
    expect(RISK_TEXT.dock).toContain("una copia en un archivo sigue siendo lo seguro");
  });

  it("is a full device in Chromium and Firefox, where asking to keep the data and installing both help", () => {
    for (const browser of ["chromium", "firefox"] as const) {
      expect(riskOf({ browser, installed: false })).toBe("pressure");
      expect(offersFor({ browser, installed: false })).toEqual(["persist", "install", "copy", "account"]);
    }
  });

  it("is said, and not guessed, for a browser nothing is known about — another browser on an iPhone included, installed or not", () => {
    expect(riskOf({ browser: "other", installed: false })).toBe("unknown");
    expect(riskOf({ browser: "ios-other", installed: false })).toBe("unknown");
    // What WebKit wrote about the home screen is about Safari: a Chrome on an iPhone does not get the promise.
    expect(riskOf({ browser: "ios-other", installed: true })).toBe("unknown");
    // Offered all the same, where the browser can do them: neither is known to fail there, and each says nothing where it cannot.
    expect(offersFor({ browser: "other", installed: false })).toEqual(["persist", "install", "copy", "account"]);
    expect(offersFor({ browser: "ios-other", installed: true })).toEqual(["persist", "install", "copy", "account"]);
  });

  it("always offers a copy, in a file or in the account: it is what does not depend on the browser", () => {
    const settings = [
      { browser: "safari", installed: false },
      { browser: "safari", installed: true },
      { browser: "safari-mac", installed: false },
      { browser: "safari-mac", installed: true },
      { browser: "chromium", installed: false },
      { browser: "other", installed: false },
    ] as const;
    for (const setting of settings) expect(offersFor(setting)).toEqual(expect.arrayContaining(["copy", "account"]));
  });
});

describe("how old a copy can be", () => {
  it("is a week in a Safari tab — on an iPhone or on a Mac — and the reminder's usual month everywhere else", () => {
    expect(copyWindowDays({ browser: "safari", installed: false })).toBe(SAFARI_COPY_WINDOW_DAYS);
    expect(copyWindowDays({ browser: "safari-mac", installed: false })).toBe(SAFARI_COPY_WINDOW_DAYS);
    expect(SAFARI_COPY_WINDOW_DAYS).toBe(7);
    expect(copyWindowDays({ browser: "safari", installed: true })).toBeUndefined();
    // Not promised, not documented: the reminder does not run on a fear that WebKit has not put in writing.
    expect(copyWindowDays({ browser: "safari-mac", installed: true })).toBeUndefined();
    expect(copyWindowDays({ browser: "chromium", installed: false })).toBeUndefined();
  });
});

describe("how long «Ahora no» holds the reminder (U06)", () => {
  it("is the usual stretch, except where the browser deletes sooner: in a Safari tab a fortnight of silence is twice the time it takes", () => {
    expect(snoozeDays({ browser: "chromium", installed: false }, 14)).toBe(14);
    expect(snoozeDays({ browser: "safari", installed: true }, 14)).toBe(14);
    expect(snoozeDays({ browser: "safari", installed: false }, 14)).toBe(SAFARI_COPY_WINDOW_DAYS);
    expect(snoozeDays({ browser: "safari-mac", installed: false }, 14)).toBe(SAFARI_COPY_WINDOW_DAYS);
    // Never longer than asked for: a shorter usual stretch is kept.
    expect(snoozeDays({ browser: "safari", installed: false }, 3)).toBe(3);
  });

  it("is said in weeks, so the button can promise when it is back", () => {
    expect(inWeeks(7)).toBe("en una semana");
    expect(inWeeks(14)).toBe("en dos semanas");
    expect(inWeeks(21)).toBe("en 3 semanas");
    expect(inWeeks(1)).toBe("en una semana");
  });
});

describe("what is in order, at the foot of the profile", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("says the date of the last copy and that the account has the profile, and nothing about how long it has been", () => {
    expect(copyFooter({ lastBackupAt: "2026-05-03T15:00:00.000Z", accountSynced: true }, now)).toBe("Tu última copia: el 3 de mayo · Tu cuenta tiene tu perfil al día.");
    expect(copyFooter({ lastBackupAt: "2026-05-03T15:00:00.000Z", accountSynced: false }, now)).toBe("Tu última copia: el 3 de mayo.");
    expect(copyFooter({ lastBackupAt: "2025-11-20T15:00:00.000Z", accountSynced: false }, now)).toBe("Tu última copia: el 20 de noviembre de 2025.");
    expect(copyFooter({ accountSynced: true }, now)).toBe("Tu cuenta tiene tu perfil al día.");
  });

  it("says nothing when there is nothing to say: no copy that is known and no account that has it", () => {
    expect(copyFooter({ accountSynced: false }, now)).toBeNull();
    expect(copyFooter({ lastBackupAt: "not a date", accountSynced: false }, now)).toBeNull();
  });
});

describe("what is said", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("says the date of the last copy, and not how long ago it was", () => {
    expect(lastCopyLine("2026-05-03T15:00:00.000Z", now)).toBe("Tu última copia, en un archivo o en tu cuenta, la hiciste el 3 de mayo.");
    expect(lastCopyLine("2025-11-20T15:00:00.000Z", now)).toBe("Tu última copia, en un archivo o en tu cuenta, la hiciste el 20 de noviembre de 2025.");
    expect(lastCopyLine(undefined, now)).toBe("Todavía no hay ninguna copia de tu perfil fuera de este navegador.");
    expect(lastCopyLine("not a date", now)).toBe("Todavía no hay ninguna copia de tu perfil fuera de este navegador.");
  });

  it("does not say there is no copy when the account has the profile, which is a copy and has its own line (U03)", () => {
    // Without a date, the account is the copy: nothing to say that would contradict «Tu cuenta tiene tu perfil al día».
    expect(lastCopyLine(undefined, now, true)).toBeNull();
    expect(lastCopyLine("not a date", now, true)).toBeNull();
    // With a date of a copy, it is still said, with the account or without it.
    expect(lastCopyLine("2026-05-03T15:00:00.000Z", now, true)).toBe("Tu última copia, en un archivo o en tu cuenta, la hiciste el 3 de mayo.");
    // And nothing is known of an account unless it is said, so the line is what it always was.
    expect(lastCopyLine(undefined, now, false)).toBe(NO_COPY_YET);
    expect(lastCopyLine(undefined, now)).toBe(NO_COPY_YET);
  });

  it("speaks in the product's voice, with no reproach in it", () => {
    const risks = Object.keys(RISK_TEXT) as Risk[];
    const lines = [...risks.map((risk) => RISK_TEXT[risk]), ...risks.map((risk) => COPY_REASON[risk])];
    for (const line of lines) for (const rule of RULES) expect(rule.not.test(line), `${rule.use}: «${line}»`).toBe(false);
  });
});

describe("where it can be installed", () => {
  const base = { standalone: false, hasPrompt: false, platform: "MacIntel", touchPoints: 0 };

  it("is the File menu of Safari 17 on a Mac, which adds a site to the Dock", () => {
    expect(installOffer({ ...base, userAgent: UA.macSafari17 })).toBe("mac");
    // An older Safari cannot, and Chrome on a Mac announces its own prompt or nothing.
    expect(installOffer({ ...base, userAgent: UA.macSafari16 })).toBe("none");
    expect(installOffer({ ...base, userAgent: UA.macChrome })).toBe("none");
    // An iPad, even one that says it is a Mac, is the share menu.
    expect(installOffer({ ...base, userAgent: UA.ipadAsMac, touchPoints: 5 })).toBe("ios");
  });
});

describe("where a download goes, and what is said after it (U33)", () => {
  const places = ["ios", "android", "computer"] as const;

  it("tells an iPhone or an iPad, an Android phone and a computer — and takes what it does not know for a computer", () => {
    for (const userAgent of [UA.iphoneSafari, UA.iphoneChrome, UA.iphoneInstagram]) expect(placeOf(agent(userAgent, "iPhone", 5)), userAgent).toBe("ios");
    // An iPad that asks to be taken for a Mac, given away by its touch screen: its downloads go where an iPhone's do.
    expect(placeOf(agent(UA.ipadAsMac, "MacIntel", 5))).toBe("ios");
    for (const userAgent of [UA.androidChrome, UA.samsung, UA.firefoxAndroid]) expect(placeOf(agent(userAgent, "Linux armv8l", 5)), userAgent).toBe("android");
    for (const userAgent of [UA.macSafari17, UA.macChrome, UA.edge, UA.firefox, UA.unknown]) expect(placeOf(agent(userAgent, "MacIntel")), userAgent).toBe("computer");
  });

  it("says three things, in this order: where the copy went, to keep it somewhere else, and how it comes back", () => {
    for (const place of places) {
      const lines = copySavedLines(place, { size: "profile", locked: false });
      expect(lines, place).toHaveLength(3);
      expect(lines[0], place).toMatch(/^Bajamos tu copia\. Quedó donde tu navegador guarda las descargas: /);
      expect(lines[1], place).toMatch(/^Guardala también fuera de /);
      expect(lines[2], place).toMatch(/^Para recuperarla: «Introducir perfil», en Ajustes\.$/);
    }
  });

  it("names the folder each system uses, and the phone or the computer the copy must not stay in", () => {
    const where = (place: (typeof places)[number]) => copySavedLines(place, { size: "profile", locked: false }).slice(0, 2).join(" ");
    expect(where("ios")).toContain("«Archivos › Descargas»");
    expect(where("ios")).toContain("fuera de este celular");
    expect(where("android")).toContain("«Descargas»");
    expect(where("android")).not.toContain("Archivos");
    expect(where("android")).toContain("fuera de este celular");
    expect(where("computer")).toContain("la carpeta «Descargas»");
    expect(where("computer")).toContain("fuera de esta computadora");
    // Never the one place that loses the profile with it.
    expect(where("computer")).not.toContain("celular");
  });

  it("is a copy that must be kept somewhere else, and says where: in the mail or in the cloud, which are the person's own", () => {
    for (const place of places) expect(copySavedLines(place, { size: "profile", locked: false })[1], place).toMatch(/en tu correo o en tu nube/);
  });

  it("says that the complete copy carries the postings and not the keys, and that the profile's does not say so", () => {
    for (const place of places) {
      const complete = copySavedLines(place, { size: "complete", locked: false });
      expect(complete[0], place).toMatch(/^Bajamos la copia completa: tu perfil y tus postulaciones, sin tus keys\. Quedó donde tu navegador guarda las descargas: /);
      expect(complete, place).toHaveLength(3);
      expect(copySavedLines(place, { size: "profile", locked: false }).join(" "), place).not.toMatch(/completa|postulaciones|keys/);
    }
  });

  it("says that a copy with a password opens with the one the person chose, and only then", () => {
    for (const place of places) {
      const locked = copySavedLines(place, { size: "profile", locked: true });
      expect(locked[2], place).toBe("Para recuperarla: «Introducir perfil», en Ajustes, con la contraseña que elegiste.");
      expect(copySavedLines(place, { size: "profile", locked: false })[2], place).not.toMatch(/contraseña/);
    }
  });

  it("speaks in the product's voice, whichever the place, the size and the lock — no «equipo», no «dispositivo», no old name for a copy", () => {
    for (const place of places) {
      for (const size of ["profile", "complete"] as const) {
        for (const locked of [false, true]) {
          for (const line of copySavedLines(place, { size, locked })) for (const rule of RULES) expect(rule.not.test(line), `${rule.use}: «${line}»`).toBe(false);
        }
      }
    }
  });
});
