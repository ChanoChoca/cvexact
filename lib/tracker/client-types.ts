import type { application, applicationContact, applicationEvent, applicationReminder, cvVersion } from "@/lib/db/schema";

/**
 * Las filas de `application` tal como las recibe el cliente: los mismos
 * campos que Drizzle infiere, con cada `Date` ya convertida a string ISO por
 * `NextResponse.json()` — mismo motivo que `JobPosting` en
 * `lib/jobs/feed-query.ts`. Sólo tipos, se borran en el build; nada runtime
 * de `lib/db/schema` cruza al bundle del cliente.
 */
export type TrackerApplication = Omit<
  typeof application.$inferSelect,
  "createdAt" | "updatedAt" | "appliedAt" | "lastActivityAt"
> & {
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  lastActivityAt: string;
};

export type TrackerEvent = Omit<typeof applicationEvent.$inferSelect, "occurredAt" | "createdAt"> & {
  occurredAt: string;
  createdAt: string;
};

export type TrackerContact = Omit<typeof applicationContact.$inferSelect, "createdAt"> & {
  createdAt: string;
};

export type TrackerCvVersion = Omit<typeof cvVersion.$inferSelect, "createdAt"> & {
  createdAt: string;
};

export type TrackerReminder = Omit<
  typeof applicationReminder.$inferSelect,
  "dueAt" | "sentAt" | "createdAt"
> & {
  dueAt: string;
  sentAt: string | null;
  createdAt: string;
};
