"use client";

import { useState } from "react";
import { CollapsibleCard } from "@/components/ui";
import { loadTrackerSettingsOpen, saveTrackerSettingsOpen } from "@/lib/storage/local";
import { EmailInboxCard } from "./EmailInboxCard";
import { GhostingMailCard } from "./GhostingMailCard";
import { ExtensionTokenCard } from "./ExtensionTokenCard";

/**
 * The three account-level tracker settings, folded below the job list so a
 * returning user doesn't scroll past them on every visit. Expanded the
 * first time — nothing to hide yet, since nothing's configured either —
 * and after that remembers whatever the user leaves it at.
 */
export function TrackerSettingsSection({ userId }: { userId: string }) {
  const [open] = useState(() => loadTrackerSettingsOpen() ?? true);

  return (
    <CollapsibleCard title="Configuración de seguimiento" defaultOpen={open} onToggle={saveTrackerSettingsOpen}>
      <div className="space-y-6">
        <EmailInboxCard userId={userId} />
        <GhostingMailCard userId={userId} />
        <ExtensionTokenCard userId={userId} />
      </div>
    </CollapsibleCard>
  );
}
