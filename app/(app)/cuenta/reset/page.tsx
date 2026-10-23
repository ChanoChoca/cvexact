import { Suspense } from "react";
import { Card } from "@/components/ui";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = { title: "Elegir una contraseña nueva" };

/**
 * The form reads the token out of the query string with `useSearchParams`,
 * which needs a `Suspense` boundary to prerender at all — without one, the
 * build fails. The boundary alone does not force the route dynamic, though:
 * it lets Next prerender everything outside it and read the URL client-side
 * instead. This route also shares its layout with `AppFooter`
 * (`components/legal/parts.tsx`), which reads production identity from
 * `lib/legal/operator.ts` — and that is what actually needs the request-time
 * render. See `app/page.tsx` for the full story. The fallback is what the
 * reader sees for the instant before hydration, so it says the same thing
 * the form is about to.
 */
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <p className="text-sm text-ink-3">Cargando…</p>
        </Card>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
