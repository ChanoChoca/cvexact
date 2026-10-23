import Link from "next/link";
import { CvTresScene } from "@/components/landing/solar/scenes/CvTresScene";
import { HeroScene } from "@/components/landing/solar/scenes/HeroScene";
import { StepCvexactScene } from "@/components/landing/solar/scenes/StepCvexactScene";
import { StepEntrevistaScene } from "@/components/landing/solar/scenes/StepEntrevistaScene";
import { StepPerfilScene } from "@/components/landing/solar/scenes/StepPerfilScene";
import { VerifiedRubroScene } from "@/components/landing/solar/scenes/VerifiedRubroScene";
import { VerifiedScopeScene } from "@/components/landing/solar/scenes/VerifiedScopeScene";
import { VerifiedTestsScene } from "@/components/landing/solar/scenes/VerifiedTestsScene";
import { Cta } from "@/components/landing/solar/Cta";
import { FloorShadow, Footer, Nav } from "@/components/landing/solar/parts";
import { RunwayTrack } from "@/components/landing/solar/RunwayTrack";
import { GradientText } from "@/components/ui";

/**
 * The public landing follows the project's own design reference
 * (`CVExact hero design/cvexact Landing.dc.html`, a local, unversioned design
 * artifact created for this project), rather than an approximation. Structure,
 * measurements and copy below are the design reference's; `Section`/`CardRow`
 * from the Podio primitives aren't reused this time because this layout
 * (full-bleed hero, a 300vh runway, per-step accent colours, no boxed tiles)
 * doesn't match their shape. `components/landing/solar/parts.tsx` still keeps
 * this isolated from `/precios`, `/apoyar`, `/legales/*`, `/baja` and
 * `/arrepentimiento`, which import Nav/Footer from the Podio module instead.
 *
 * The nine animated visuals (`components/landing/solar/scenes/*.tsx`) are React
 * implementations created with AI assistance under the project owner's
 * direction, based on the design reference above. They are not third-party
 * assets. The exact AI tool and its applicable terms are not documented; see
 * `ASSETS.md`. Their demo CV content is localized to Argentina; see each scene's
 * header comment for what changed.
 */

const STEPS = [
  { Scene: StepPerfilScene, label: "Paso 01", color: "text-solar-g4", text: "Cargás tu perfil una vez." },
  { Scene: StepCvexactScene, label: "Paso 02", color: "text-solar-g3", text: "Pegás el aviso." },
  { Scene: StepEntrevistaScene, label: "Paso 03", color: "text-solar-g1", text: "Recibís CV, respuestas, email y entrevista." },
];

/*
 * The claim below is deliberately qualitative: a public test count ages badly
 * and reads like a quality guarantee. What the copy says is what the product
 * does: lib/ai/verify.ts and lib/ai/evidence.ts look for professional claims
 * that the profile does not support. The relevant suites are verify.test.ts,
 * evidence.test.ts, practical.test.ts and coverage-audit.test.ts; they remain
 * the source of truth for the behavior.
 */
const REASONS = [
  { Scene: VerifiedTestsScene, text: "Controles automáticos que buscan afirmaciones sin respaldo en tu perfil." },
  { Scene: VerifiedScopeScene, text: "Te muestra qué cubre y qué no." },
  { Scene: VerifiedRubroScene, text: "Sirve también fuera de tu rubro." },
];

/**
 * Dinámica, no revalidada — por la misma razón que se probó `revalidate =
 * 3600` antes: el bloque de identificación del `Footer` sale de variables de
 * entorno (`lib/legal/operator.ts`), leídas en el momento del render. La
 * hipótesis de ISR era que la regeneración en segundo plano volviera a leer
 * `process.env` cada hora; verificado contra producción, no pasa así en este
 * despliegue — la página siguió sirviendo «[pendiente de carga]» con
 * `x-nextjs-cache: HIT` mucho después de vencido ese plazo, mientras rutas ya
 * dinámicas como `/ajustes` mostraban el valor correcto del mismo pod. `force-
 * dynamic` saca la duda: se lee el Secret en cada request, igual que en
 * cualquier ruta con sesión. `scripts/verify-build-legal.mjs` corre en el
 * build y falla si esto se revierte sin querer.
 */
export const dynamic = "force-dynamic";

// Grid overlay behind the hero and footer — `sc-if value={gridOverlay}` in
// the design reference, defaulted `true` there and never exposed to an end user;
// baked in rather than ported as a toggle nobody would flip.
function GridOverlay({ mask }: { mask: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-28"
      style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "92px 92px",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

export default function LandingPage() {
  return (
    <div className="bg-solar-bg font-sans font-normal text-solar-ink">
      <Nav />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="relative flex min-h-[calc(100svh-77px)] items-center overflow-x-clip">
          <div aria-hidden className="pointer-events-none absolute -top-[180px] -right-[120px] size-[900px]" style={{ background: "radial-gradient(circle at center, rgba(127,102,240,0.34), rgba(177,102,216,0.13) 42%, rgba(1,2,12,0) 68%)" }} />
          <div aria-hidden className="pointer-events-none absolute -top-[120px] -left-[280px] size-[760px]" style={{ background: "radial-gradient(circle at center, rgba(233,181,126,0.14), rgba(1,2,12,0) 65%)" }} />
          <GridOverlay mask="radial-gradient(ellipse 80% 60% at 50% 40%, #000 20%, transparent 75%)" />

          <div className="relative mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-12 px-6 py-10 pb-12 sm:px-10 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.3fr)]">
            <div>
              <h1 className="text-[clamp(64px,8.6vw,148px)] leading-[0.94] font-light tracking-[-0.045em] text-white text-balance">
                Generá tu <GradientText>CV</GradientText>
              </h1>
              <div className="mt-11 flex">
                <Cta href="/perfil/empezar">Crear mi CV</Cta>
              </div>
            </div>

            <div className="relative flex justify-center lg:justify-end lg:-mr-10">
              <div className="relative w-full" style={{ maxWidth: "calc((100svh - 200px) * 16 / 9)" }}>
                <FloorShadow inset={18} bottom={4} height={20} blur={22} />
                <div data-solar-float className="relative z-1">
                  <div className="block aspect-video w-full">
                    <HeroScene />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── Runway — no heading, matching the design reference ──────── */}
        <RunwayTrack />

        {/* ── Tres pasos ───────────────────────────────────────────────── */}
        <section id="pasos" className="relative overflow-hidden bg-solar-bg">
          <div className="relative mx-auto max-w-[1440px] px-6 pt-[80px] pb-6 sm:px-10 sm:pt-[120px]">
            <h2 className="text-[clamp(44px,5.6vw,92px)] leading-none font-light tracking-[-0.045em] text-white">
              Tres <GradientText>pasos</GradientText>
            </h2>
          </div>

          {STEPS.map((step, i) => (
            <div
              key={step.label}
              className={`relative mx-auto box-border grid min-h-[calc(100svh-77px)] max-w-[1440px] grid-cols-1 items-center gap-10 px-6 sm:px-10 lg:gap-14 ${
                i % 2 === 0 ? "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
              }`}
            >
              <div className={`flex flex-col gap-5 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                <span className={`font-solar text-[13px] font-bold tracking-[0.24em] uppercase ${step.color}`}>{step.label}</span>
                <p className="text-[clamp(30px,3.4vw,52px)] leading-[1.1] font-light tracking-[-0.035em] text-white text-balance">{step.text}</p>
              </div>
              <div className={`relative lg:scale-[1.09] ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                <FloorShadow inset={16} bottom={3} height={18} blur={22} />
                <div className="relative z-1 block aspect-video w-full">
                  <step.Scene />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── Verificado contra tu perfil ──────────────────────────────── */}
        <section id="verificado" className="relative box-border overflow-hidden bg-solar-bg py-16 sm:min-h-[calc(100svh-77px)] sm:py-0">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-55" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(127,102,240,0.13), rgba(1,2,12,0) 70%)" }} />
          <div className="relative mx-auto box-border flex h-full max-w-[1440px] flex-col gap-[clamp(18px,3.5vh,48px)] px-6 py-[clamp(20px,4vh,56px)] pb-[clamp(24px,4.5vh,60px)] sm:h-full sm:px-10">
            <h2 className="text-[clamp(30px,3.9vw,66px)] leading-none font-light tracking-[-0.045em] text-white">
              Verificado contra tu <GradientText>perfil</GradientText>
            </h2>

            <div className="grid flex-1 grid-cols-1 items-start gap-x-[clamp(24px,3.4vw,56px)] gap-y-8 sm:grid-cols-3 sm:content-center">
              {REASONS.map((reason) => (
                <div key={reason.text} className="flex flex-col gap-[clamp(14px,2.2vh,28px)]">
                  <div className="relative">
                    <FloorShadow inset={10} bottom={4} height={20} blur={20} />
                    <div className="relative z-1 block aspect-video w-full">
                      <reason.Scene />
                    </div>
                  </div>
                  <p className="text-center text-[clamp(17px,1.55vw,26px)] leading-[1.2] font-light tracking-[-0.03em] text-white text-balance">{reason.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA final ────────────────────────────────────────────────── */}
        <section className="relative box-border flex min-h-[calc(100svh-77px)] items-center overflow-hidden bg-solar-bg">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-55" style={{ background: "radial-gradient(ellipse 65% 55% at 50% 45%, rgba(127,102,240,0.16), rgba(1,2,12,0) 70%)" }} />
          <div className="relative mx-auto flex w-full max-w-[1180px] flex-col items-center gap-[clamp(24px,4vh,44px)] px-6 py-[clamp(60px,9vh,120px)] pb-[clamp(72px,10vh,130px)] sm:px-10">
            <div className="relative w-full max-w-[860px]">
              <FloorShadow inset={14} bottom={4} height={20} blur={22} />
              <div className="relative z-1 block aspect-video w-full">
                <CvTresScene />
              </div>
            </div>

            <p className="text-center text-[clamp(34px,4.4vw,72px)] leading-[1.02] font-light tracking-[-0.045em] text-white text-balance">
              Empezá por tu <GradientText>perfil</GradientText>
            </p>

            <div className="flex flex-col items-center gap-[22px]">
              <Cta href="/perfil/empezar">Crear mi CV</Cta>
              <Link
                href="/cv/demo/print"
                target="_blank"
                className="inline-flex items-center gap-[10px] border-b border-white/[0.16] px-0.5 py-1 font-solar text-[14.5px] font-bold tracking-[0.16em] text-solar-muted uppercase transition-colors hover:border-solar-g3 hover:text-solar-ink"
              >
                Ver un CV de ejemplo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
