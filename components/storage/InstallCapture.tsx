"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/pwa/install";

/** Listens, from the shell, for the browser's offer to install the app, and draws nothing: see `lib/pwa/install.ts`. */
export function InstallCapture() {
  useEffect(() => captureInstallPrompt(), []);
  return null;
}
