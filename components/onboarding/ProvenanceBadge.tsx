import { Badge } from "@/components/ui";
import { provenanceOf, type ProvenanceTone } from "@/lib/onboarding/provenance";
import type { Source, Status } from "@/lib/schemas/profile-v2";

const TONE: Record<ProvenanceTone, "info" | "neutral" | "good"> = {
  cv: "info",
  linkedin: "info",
  said: "neutral",
  edited: "good",
  legacy: "neutral",
};

/** Where a value came from, in words. Nothing when there is nothing to say. */
export function ProvenanceBadge({ status, source }: { status: Status; source?: Source | undefined }) {
  const provenance = provenanceOf(status, source);
  if (!provenance) return null;
  return <Badge tone={TONE[provenance.tone]}>{provenance.label}</Badge>;
}
