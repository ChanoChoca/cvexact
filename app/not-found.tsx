import Link from "next/link";
import { Wordmark } from "@/components/landing/Wordmark";
import { ButtonLink } from "@/components/ui";

/**
 * Renders for any URL that matches no route — including a stale `/cv/<id>`
 * link nobody typed correctly. It sits outside `(app)`'s `AppShell`, so it
 * cannot assume the fixed nav is there; it wears the same rules-and-mono
 * language as the landing instead, the one identity every visitor has seen
 * regardless of which section they were headed for.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <Link href="/" className="text-[15px] text-ink">
        <Wordmark />
      </Link>
      <div>
        <p className="mb-3.5 font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
          404
        </p>
        <h1 className="text-[clamp(1.75rem,3.4vw,2.375rem)] leading-tight font-light tracking-[-0.045em] text-balance text-ink">
          Esta página no existe
        </h1>
        <p className="mx-auto mt-3 max-w-[42ch] text-[14.5px] leading-relaxed text-pretty text-ink-2">
          Puede que el link esté viejo o mal escrito. Tus datos siguen donde
          estaban — no se perdió nada.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5.5">
        <ButtonLink href="/postulaciones" className="px-7 py-3.5">
          Ir a mis postulaciones
        </ButtonLink>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.14em] text-ink-3 underline underline-offset-4 hover:text-ink"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
