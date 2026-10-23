import "server-only";

import { eq } from "drizzle-orm";
import { databaseConfigured, getDb, schema } from "@/lib/db";
import { withdrawJobAlertsConsent } from "@/lib/legal/consent";

/**
 * Apaga la alerta de empleo de un usuario: borra `jobAlert` y retira el
 * consentimiento `job_alerts` en el mismo paso, para que un alert apagado
 * nunca deje un permiso vivo sin nada que lo ejerza. Compartido entre el
 * `DELETE` logueado (`app/api/jobs/alerts/route.ts`) y la baja de un clic sin
 * sesión (`app/api/jobs/alerts/unsubscribe/route.ts`) — un solo lugar para
 * que ambos caminos apaguen la alerta exactamente igual.
 */
export async function deactivateJobAlert(userId: string): Promise<void> {
  if (!databaseConfigured) return;

  await getDb().delete(schema.jobAlert).where(eq(schema.jobAlert.userId, userId));
  await withdrawJobAlertsConsent(userId);
}
