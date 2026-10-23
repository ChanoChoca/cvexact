"use client";

import { PageHeading } from "@/components/ui";
import { AccountPanel } from "@/components/account/AccountPanel";
import { ANCHOR } from "@/components/profile/anchors";
import { SectionBar, type SectionLink } from "@/components/profile/SectionBar";
import { DataCard } from "@/components/storage/DataCard";

/** The two parts of the page, in the order they come: for the bar of a phone, and the anchors of what the «Cuenta» menu of the bar links to. */
const SECTIONS: readonly SectionLink[] = [
  { id: "cuenta", label: "Mi cuenta" },
  { id: "datos", label: "Mis datos" },
];

/**
 * Everything about the person and not about a CV, in one page: signing in (or the session and the account, once in) and the data this browser holds. The keys of the AI are
 * apart, in `/ajustes`.
 */
export function AccountPage({
  googleEnabled,
  authAvailable,
  mailAvailable,
  turnstileSiteKey,
}: {
  googleEnabled: boolean;
  authAvailable: boolean;
  mailAvailable: boolean;
  turnstileSiteKey: string;
}) {
  return (
    <div className="space-y-10" data-panel="wide">
      <PageHeading eyebrow="Tu cuenta" title="Mi cuenta">
        Con una cuenta tu perfil puede seguirte a otro celular o computadora, y no depende de un solo navegador. No hace falta para usar CV Exact.
      </PageHeading>

      <SectionBar label="Secciones de Mi cuenta" sections={SECTIONS} />

      <div id="cuenta" className={ANCHOR}>
        <AccountPanel googleEnabled={googleEnabled} authAvailable={authAvailable} mailAvailable={mailAvailable} turnstileSiteKey={turnstileSiteKey} />
      </div>

      <div id="datos" className={ANCHOR}>
        <DataCard />
      </div>
    </div>
  );
}
