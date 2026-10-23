import type { ReactNode } from "react";

/** Each one a drawing of what it says; none of them a lock — the profile is kept as it is read, and a lock would promise a protection it does not have. */
const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "#b166d8",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "mt-0.5 size-5 shrink-0 text-ink-3",
} as const;

const SEALS: ReadonlyArray<{ text: string; icon: ReactNode }> = [
  {
    text: "Se leen en tu navegador: no se suben",
    icon: (
      <svg {...ICON}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" />
      </svg>
    ),
  },
  {
    text: "Sin cuenta: queda en este navegador",
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7M4 4l16 16" />
      </svg>
    ),
  },
  {
    text: "Lo borrás cuando quieras",
    icon: (
      <svg {...ICON}>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
      </svg>
    ),
  },
];

/**
 * Three things said once under the place to bring a document, each of them true of the product as it is: the file is read in the
 * browser, the profile starts without an account and stays in that browser, and the person can delete it. «256 bits» and «cumple el
 * RGPD» are not here on purpose: the first is true of a copy with a password and not of the profile, and the second is a legal claim the
 * policy does not make.
 */
export function TrustLine() {
  return (
    <ul
      className="grid gap-3 text-sm text-ink-2 sm:grid-cols-3"
      data-trust-line
    >
      {SEALS.map((seal) => (
        <li key={seal.text} className="flex items-start gap-2.5">
          {seal.icon}
          <span>{seal.text}</span>
        </li>
      ))}
    </ul>
  );
}
