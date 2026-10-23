"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { BalanceIndicator } from "@/components/billing/BalanceIndicator";
import { NoteCapture } from "@/components/notes/NoteCapture";
import { cx, NavCta } from "@/components/ui";
import { AutoSync } from "@/components/account/AutoSync";
import { AccountMenu } from "./AccountMenu";
import { InstallCapture } from "@/components/storage/InstallCapture";
import { StorageBootstrap } from "@/components/storage/StorageBootstrap";
import { UnsavedNotice } from "@/components/storage/UnsavedNotice";
import { SpaceWarning } from "@/components/storage/SpaceWarning";
import {
  BriefcaseGlyph,
  GearGlyph,
  IdCardGlyph,
  KanbanGlyph,
  SparkleDocGlyph,
  UserGlyph,
} from "./TabIcons";

/**
 * The signed-in app, wearing the same Solar identity as the landing: a fixed
 * navbar built from the landing's own chrome pieces (`LogoMark`, `NavCta`),
 * and a single centred column below it. A page that needs the room says so
 * itself, by putting `data-panel="wide"` (1180 px, centred, with margins) or
 * `data-panel="full"` (the whole width, for columns that grow with the screen:
 * a sheet of CV beside a form, a board) on its root element — the column
 * widens off that with `has-*`, so no page has to reach up into the shell to
 * resize it.
 */

const SECTIONS = [
  { href: "/postular", label: "Postular", Icon: SparkleDocGlyph },
  { href: "/empleos", label: "Empleos", Icon: BriefcaseGlyph },
  { href: "/perfil", label: "Perfil", Icon: IdCardGlyph },
  { href: "/postulaciones", label: "Postulaciones", Icon: KanbanGlyph },
  { href: "/ajustes", label: "Mis keys", Icon: GearGlyph },
  { href: "/cuenta", label: "Cuenta", Icon: UserGlyph },
] as const;

type Href = (typeof SECTIONS)[number]["href"];

/**
 * Perfil (`/perfil`), Mis keys (`/ajustes`) and Cuenta (`/cuenta`) are sections (routes that light their place and get the width of a tab) but not links of the bar:
 * they are reached from the «Cuenta» menu (`AccountMenu`): at the right of the top bar on a computer, and as the last tab of the bottom bar on a phone.
 */
const ACCOUNT_SECTIONS: readonly Href[] = ["/perfil", "/ajustes", "/cuenta"];
const BAR_SECTIONS = SECTIONS.filter((s) => !ACCOUNT_SECTIONS.includes(s.href));

/**
 * The desktop nav's plain-text links — every section of the bar except Postular, which
 * gets the `NavCta` treatment instead (below): generating a CV is the one
 * action this whole app exists for, the same way "Crear mi CV" is the landing's
 * own `NavCta`. `MobileTabBar` still renders all three equally — a bottom tab
 * bar is a set of destinations, not a page with one primary action to reach
 * for over the rest.
 */
const NAV_LINK_SECTIONS = BAR_SECTIONS.filter((s) => s.href !== "/postular");

/**
 * Which section a URL belongs to. Sub-paths count, so `/postular?app=…` and
 * any future nested route keep their section lit.
 */
function sectionOf(pathname: string): Href | null {
  // `/cuenta/reset` is the form of a link from a mail, not a tab: it stays a column, with the legal text.
  if (pathname.startsWith("/cuenta/")) return null;
  return (
    SECTIONS.find(
      ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
    )?.href ?? null
  );
}

function AppNav() {
  const active = sectionOf(usePathname());

  return (
    // `fixed`, not `sticky` like the landing's own nav: the app column below
    // relies on `--nav-h` (set on `AppShell`'s root) to reserve exactly this
    // much padding, and switching the positioning scheme would mean re-doing
    // that math for no visible difference — both read as "pinned while
    // scrolling" to whoever is looking at it.
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--nav-h)] border-b border-white/[0.07] bg-[rgba(1,2,12,0.72)] backdrop-blur-[22px] backdrop-saturate-[1.6]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "linear-gradient(180deg, rgba(127,102,240,0.10), rgba(1,2,12,0) 70%)",
        }}
      />
      {/* The bar keeps the app's widest column — the 1180 px of `data-panel="wide"`, the width every page but the narrow ones uses — instead of stretching
          to the edges the moment a section is active: at 1920 px the logo and the sections ended up in opposite corners, reading as two unrelated pieces of
          chrome. A `full` page (the board) still goes edge to edge below; the bar above stays in the column, and its ends land on the content's own margins. */}
      <nav className="relative mx-auto flex h-full max-w-[1180px] items-center justify-between gap-6 px-6 sm:px-10">
        <Link href="/">
          <div className="flex h-[42px] items-center gap-[0.3em] text-[42px] leading-none pointer-coarse:h-11">
            <span className="relative block h-[1em] w-[1em] shrink-0 text-[0.68em]">
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 rotate-45 bg-oro" />
              <span className="absolute left-1/2 top-1/2 h-[0.125em] w-[0.66em] -translate-x-[0.33em] -translate-y-1/2 -rotate-45 bg-oro" />

              <span className="absolute left-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute right-0 top-1/2 h-[0.05em] w-[0.15em] -translate-y-1/2 bg-oro-soft" />
              <span className="absolute left-1/2 top-0 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
              <span className="absolute bottom-0 left-1/2 h-[0.15em] w-[0.05em] -translate-x-1/2 bg-oro-soft" />
            </span>

            <span className="whitespace-nowrap font-semibold tracking-[-0.045em]">
              cve
              <span className="relative mx-[0.055em] inline-block h-[0.5em] w-[0.48em] align-baseline">
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 rotate-45 bg-oro" />
                <span className="absolute left-1/2 top-1/2 h-[0.086em] w-[0.63em] -translate-x-[0.315em] -translate-y-1/2 -rotate-45 bg-oro" />

                <span className="absolute left-1/2 top-[-0.15em] h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
                <span className="absolute bottom-[-0.15em] left-1/2 h-[0.1em] w-[0.038em] -translate-x-1/2 bg-oro-soft" />
              </span>
              act
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-7">
          {/* Below `chrome` (736 px) these live in the fixed tab bar at the bottom
              instead — a thumb reaches that; a `flex-wrap` row up here just
              crushes the links, the balance and «Cuenta» into a strip too
              narrow to tap. */}
          {NAV_LINK_SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={active === s.href ? "page" : undefined}
              className={cx(
                "relative hidden py-1 font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase transition-colors chrome:inline motion-reduce:transition-none",
                active === s.href ? "text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {s.label}
              {/* Same "you are here" gradient bar `Tabs` draws under its own
                  active tab — one convention for both levels of navigation. */}
              {active === s.href ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-(image:--gradient-solar-text)"
                />
              ) : null}
            </Link>
          ))}
          {/* Renders nothing until there is something worth saying — see the
              component. Placed after the sections so it reads as a status, not
              as another place to go. */}
          <BalanceIndicator />
          <div className="hidden chrome:block">
            <NavCta href="/postular">Postular</NavCta>
          </div>
          {/* On a phone it is a tab of the bottom bar (`MobileTabBar`), within thumb's reach. */}
          <div className="hidden chrome:block">
            <AccountMenu active={active !== null && ACCOUNT_SECTIONS.includes(active)} />
          </div>
        </div>
      </nav>
      {/* The sweeping hairline the landing's own nav draws under itself
          (`[data-solar-sweep]`, `app/globals.css`) — a continuous 7s loop
          rather than the Podio nav's scroll-triggered reveal, since there is
          no "past the hero" moment on these pages for a reveal to key off. */}
      <div aria-hidden className="absolute inset-x-0 -bottom-px h-px overflow-hidden">
        <div data-solar-sweep />
      </div>
    </header>
  );
}

/**
 * The mobile counterpart to `AppNav`'s section links: a bottom bar, the
 * pattern every native app on the phone this renders on already uses, so a
 * thumb reaches every section without stretching. Hidden at `chrome` and up,
 * where the links live in the top nav instead.
 *
 * Each tab is a glyph over its label (`./TabIcons.tsx`). The active tab lights
 * up in the glyph — violet stroke plus a wash of the same violet — and in the
 * label going white; there is no separate marker any more, so a section that
 * gains a tab must bring a glyph with it.
 */
function MobileTabBar() {
  const active = sectionOf(usePathname());

  return (
    <nav
      aria-label="Secciones"
      data-tab-bar
      className="fixed inset-x-0 bottom-0 z-50 h-[var(--tab-h)] border-t border-white/[0.07] bg-[rgba(1,2,12,0.85)] backdrop-blur-[22px] chrome:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-full grid-cols-4">
        {BAR_SECTIONS.map((s) => {
          const isActive = active === s.href;

          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={isActive ? "page" : undefined}
              className={cx(
                "flex flex-col items-center justify-center gap-1 text-[10px] transition-colors motion-reduce:transition-none min-[360px]:text-[11px]",
                isActive ? "text-ink" : "text-ink-3",
              )}
            >
              <s.Icon active={isActive} />
              {s.label}
            </Link>
          );
        })}
        {/* Last, and a menu rather than a page: it opens upwards over the bar and holds the sections `BAR_SECTIONS` leaves out. */}
        <AccountMenu placement="tabs" active={active !== null && ACCOUNT_SECTIONS.includes(active)} />
      </div>
    </nav>
  );
}

export function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const active = sectionOf(usePathname());
  return (
    <div className="[--nav-h:76px] [--tab-h:3.75rem] min-h-dvh font-podio font-normal text-ink">
      <AppNav />
      <main
        // Lo que el pie del servidor (`AppFooter`) marca con `data-main-tab-only` —Términos, Privacidad, Apoyar y la línea del
        // operador— se esconde por CSS en toda pestaña que no sea la principal. Sin pestaña (`/cuenta/reset`) se deja: ahí se acepta el texto legal.
        data-off-main-tab={active && active !== "/postular" ? "" : undefined}
        className={cx(
          "mx-auto w-full px-6 pt-[calc(var(--nav-h)+2.5rem)] pb-[calc(var(--tab-h)+2rem)] sm:px-10 chrome:pb-24",
          // The page picks its width (`data-panel`): a column by default, `wide` with margins at the sides, `full` the whole width. `full` is `!` so that it wins over a
          // `wide` block inside it, whatever order the two rules come out in.
          "max-w-[760px] has-data-[panel=wide]:max-w-[1180px] has-data-[panel=full]:max-w-none!",
          "data-off-main-tab:**:data-main-tab-only:hidden",
        )}
      >
        <StorageBootstrap />
        <AutoSync />
        <InstallCapture />
        {/* What the browser refused to keep, and the room it has left — above
            every page, because either can happen on any of them. */}
        <UnsavedNotice />
        <SpaceWarning />
        {children}
        {/* Server-rendered by `AppLayout` and passed in as `footer`, not
            imported here — see `AppFooter`'s own comment for why this
            client component must never compute it itself. */}
        {footer}
        {/* «Anotá algo», from any screen, when that is switched on: nothing is drawn otherwise. Last, so that the room it asks for on a phone is the end of the page. */}
        <NoteCapture />
      </main>
      <MobileTabBar />
    </div>
  );
}
