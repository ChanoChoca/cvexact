"use client";

import { useSyncExternalStore } from "react";
import { UNKNOWN_SETTING, browserOf, isIOS, placeOf, settingOf, type BrowserSetting, type Place } from "@/lib/storage/durability";

/**
 * «Agregar a la pantalla de inicio»: what the browser offers, and what can be said about it.
 *
 * Chrome and its relatives announce that the app can be installed with an event (`beforeinstallprompt`) that fires once per
 * page and is lost if nobody was listening, so it is caught from the shell (`components/storage/InstallCapture.tsx`) and kept
 * here for whoever asks later. Safari offers no event at all: on an iPhone it is the share menu, and on a Mac, from Safari 17,
 * the File menu's «Agregar al Dock» — so the most that can be done is to say where. Anywhere else there is nothing to offer,
 * and nothing is shown.
 *
 * `installOffer` is the decision with no browser around it, so it is tested; `useBrowserSetting` is the browser itself, read
 * once and kept, for what `lib/storage/durability.ts` says about it.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type InstallOffer = "prompt" | "ios" | "mac" | "none";

/** The version Safari says it is, «Version/17.5 … Safari»: 0 when it does not say. */
function safariMajor(userAgent: string): number {
  const version = /Version\/(\d+)/.exec(userAgent);
  return version ? Number(version[1]) : 0;
}

export function installOffer(input: { standalone: boolean; hasPrompt: boolean; userAgent: string; platform: string; touchPoints: number }): InstallOffer {
  // Already on the home screen: nothing to ask.
  if (input.standalone) return "none";
  if (input.hasPrompt) return "prompt";
  if (isIOS(input)) return "ios";
  // Safari on a Mac adds a site to the Dock from version 17 on; an earlier one has nowhere to put it.
  if (browserOf(input) === "safari-mac" && safariMajor(input.userAgent) >= 17) return "mac";
  return "none";
}

let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Starts listening for the browser's offer; returns what stops it. Safe to call more than once. */
export function captureInstallPrompt(): () => void {
  const onPrompt = (event: Event) => {
    // The browser's own bar over the page would be the first the person hears of it: they are asked, where it fits.
    event.preventDefault();
    deferred = event as InstallEvent;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    installed = true;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/** Whether this page is already running as the installed app. */
function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** The offer is the same for as long as nothing changes: a string compares by value, so the store can hand it out as it is. */
function snapshot(): InstallOffer {
  if (installed) return "none";
  return installOffer({ standalone: isStandalone(), hasPrompt: deferred !== null, userAgent: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints });
}

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    () => "none",
  );
}

let cachedSetting: BrowserSetting = UNKNOWN_SETTING;

/** The same object for as long as nothing in it changes: `useSyncExternalStore` compares snapshots by reference. */
function settingSnapshot(): BrowserSetting {
  const next = settingOf({ userAgent: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints, standalone: isStandalone() });
  if (next.browser !== cachedSetting.browser || next.installed !== cachedSetting.installed) cachedSetting = next;
  return cachedSetting;
}

/** Which browser this is, and whether it runs as an app — what can take the profile from it is said from this. */
export function useBrowserSetting(): BrowserSetting {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settingSnapshot,
    () => UNKNOWN_SETTING,
  );
}

/** What holds the profile —an iPhone or an iPad, an Android phone, a computer—: for what is said of where a download went. A string, so the store hands it out as it is. */
export function usePlace(): Place {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => placeOf({ userAgent: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints }),
    () => "computer",
  );
}

/** Asks the browser to install, from a tap. `true` when the person said yes. */
export async function installNow(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  try {
    await event.prompt();
    return (await event.userChoice).outcome === "accepted";
  } catch {
    return false;
  }
}

const INSTALL_ASKED_KEY = "cvexact.installAsked.v1";

/**
 * Offers the install once, from the tap that downloads a CV: the browser's own dialog needs a tap that has just happened, and this is the one
 * moment the app has proved itself. Called first in the handler, before any `await`. Once: whatever the answer, it is not asked again.
 */
export function offerInstallOnce(): void {
  try {
    if (!deferred || window.localStorage.getItem(INSTALL_ASKED_KEY)) return;
    window.localStorage.setItem(INSTALL_ASKED_KEY, "1");
  } catch {
    // Without a way to remember that it was asked, it is not asked.
    return;
  }
  void installNow();
}
