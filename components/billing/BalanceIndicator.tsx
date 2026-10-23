"use client";

import Link from "next/link";
import { cx } from "@/components/ui";
import { useBillingStatus } from "@/lib/api/billing";

/**
 * How much is left, shown only when that is worth knowing.
 *
 * The server has always sent this and nothing ever read it, so the only way to
 * discover a limit was to hit one — in the middle of writing an application,
 * with no warning. This is the warning.
 *
 * It is deliberately almost always absent. A permanent counter turns every
 * generation into a spending decision, which is the last thing to put in front
 * of someone looking for work: it would make them ration the regenerations that
 * make a CV good. So it appears when the number has become actionable and stays
 * out of the way until then.
 */

/** Below this share of the allowance, running out is close enough to mention. */
const LOW_WATER = 0.34;

export function BalanceIndicator() {
  const { status } = useBillingStatus();

  // Nothing to say: no answer yet, or a user paying for their own inference,
  // for whom there is no ceiling and never a reason to show one.
  if (!status || status.tier === "byok" || status.allowance === null) return null;

  const left =
    status.tier === "credits" ? status.credits : Math.max(0, status.allowance - status.used);
  const ceiling = status.tier === "credits" ? status.credits : status.allowance;

  if (ceiling <= 0) return null;
  if (left > ceiling * LOW_WATER) return null;

  const empty = left === 0;

  return (
    <Link
      href="/ajustes"
      // The affordance is the point: the number is only useful next to the two
      // things that fix it, and both live in Ajustes.
      title={
        empty
          ? status.tier === "credits"
            ? "Sin créditos — conseguí una key gratis o comprá"
            : "Llegaste al tope diario — se libera a la medianoche UTC"
          : "Te queda poco"
      }

      className={cx(
        "font-mono text-[11px] tracking-[0.12em] tabular-nums uppercase transition-colors",
        empty ? "text-red-300 hover:text-red-200" : "text-oro hover:text-ink",
      )}
    >
      {/* Este renglón decía «prueba agotada», de cuando había una prueba
          financiada por el servidor. Esta rama no puede ser `free`: `free`
          reporta allowance 0 y sale por el `ceiling <= 0` de arriba. Es `pro`
          contra su tope diario antiabuso — que no es lo mismo, y decirle prueba
          a la suscripción que alguien está pagando es peor que no decir nada. */}
      {status.tier === "credits"
        ? `${left} créditos`
        : empty
          ? "tope diario"
          : `quedan ${left}`}

    </Link>
  );
}
