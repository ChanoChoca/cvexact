import {
  DM_Sans,
  IBM_Plex_Sans,
  Instrument_Serif,
  JetBrains_Mono,
  Libre_Franklin,
  Manrope,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from "next/font/google";

/**
 * Every family the 9 scenes (`./scenes/*.tsx`) use for their demo CV
 * content, declared here rather than in `app/layout.tsx` so only `/` pays
 * for them — self-hosted at build by `next/font/google`, so the CSP's
 * `font-src 'self' data:` already covers them with no change needed there.
 *
 * IBM Plex Mono isn't here: `step-perfil` uses it, but the app already loads
 * it site-wide as `--font-plex-mono` (`app/layout.tsx`) — reusing that
 * avoids shipping the same family twice.
 */

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-libre-franklin",
  display: "swap",
});

export const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

/** Applied once on the landing's root element. */
export const SOLAR_FONT_VARS = [
  instrumentSerif.variable,
  manrope.variable,
  ibmPlexSans.variable,
  jetBrainsMono.variable,
  plusJakartaSans.variable,
  libreFranklin.variable,
  dmSans.variable,
  spaceGrotesk.variable,
].join(" ");

/** Literal font-family stacks, for scenes that set `fontFamily` inline (as the originals did) rather than via a Tailwind class. */
export const FONT_STACKS = {
  instrumentSerif: "var(--font-instrument-serif), Georgia, serif",
  manrope: "var(--font-manrope), system-ui, sans-serif",
  ibmPlexSans: "var(--font-ibm-plex-sans), system-ui, sans-serif",
  ibmPlexMono: "var(--font-plex-mono), ui-monospace, monospace",
  jetBrainsMono: "var(--font-jetbrains-mono), ui-monospace, monospace",
  plusJakartaSans: "var(--font-plus-jakarta-sans), system-ui, sans-serif",
  libreFranklin: "var(--font-libre-franklin), system-ui, sans-serif",
  dmSans: "var(--font-dm-sans), system-ui, sans-serif",
  spaceGrotesk: "var(--font-space-grotesk), system-ui, sans-serif",
} as const;
