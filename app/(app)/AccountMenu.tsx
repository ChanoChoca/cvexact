"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cx } from "@/components/ui";
import { SignOutDialog } from "@/components/account/SignOutDialog";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth-client";
import { UserGlyph } from "./TabIcons";

/**
 * «Cuenta»: the one place of the bar for what is about the person and not about a CV — their profile, their keys, their account, the data this browser holds, and the
 * session itself. It replaced «Ajustes», «Ingresar» and «Salir», which were three ways to say the same thing in three places. «Mi perfil» goes to `/perfil`,
 * «Mis keys» to `/ajustes` and the rest to its part of `/cuenta`; the session operation (sign in, sign out) is the last, apart from the settings.
 *
 * Closing on an outside click and on Escape is what makes this behave like a menu rather than a panel that has to be dismissed by its own button; opening it
 * moves the focus in and closing hands it back to the trigger, so a keyboard user is never dropped mid-tab-order.
 */
export function AccountMenu({ active, placement = "bar" }: { active: boolean; placement?: "bar" | "tabs" }) {
  const { data: session, isPending, error } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      menu.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      trigger.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  const user = session?.user;
  const close = () => setOpen(false);
  // On a phone the trigger is a tab of the bottom bar, the same as its neighbours (glyph over label), and the menu opens upwards from it.
  const tabs = placement === "tabs";

  return (
    <div ref={root} className={cx("relative", tabs && "h-full")}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          tabs
            ? cx(
                "flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] transition-colors motion-reduce:transition-none min-[360px]:text-[11px]",
                active || open ? "text-ink" : "text-ink-3",
              )
            : cx(
                "relative flex items-center gap-1.5 py-1 font-solar text-[14.5px] font-bold tracking-[0.16em] uppercase transition-colors motion-reduce:transition-none pointer-coarse:min-h-11",
                active || open ? "text-ink" : "text-ink-2 hover:text-ink",
              )
        }
      >
        {tabs ? <UserGlyph active={active || open} /> : null}
        Cuenta
        {tabs ? null : (
          <span aria-hidden className={cx("text-[10px] transition-transform motion-reduce:transition-none", open && "rotate-180")}>
            ▾
          </span>
        )}
        {active && !tabs ? (
          <span aria-hidden className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-(image:--gradient-solar-text)" />
        ) : null}
      </button>

      {open ? (
        <div
          ref={menu}
          role="menu"
          tabIndex={-1}
          className={cx(
            "absolute z-50 w-64 overflow-hidden border border-rule bg-paper py-1 focus:outline-none",
            tabs ? "bottom-full right-2 mb-2" : "top-full right-0 mt-3",
          )}
        >
          <MenuLink href="/perfil" onClick={close}>
            Mi perfil
          </MenuLink>
          <MenuLink href="/ajustes" onClick={close}>
            Mis keys
          </MenuLink>
          {user ? (
            <MenuLink href="/cuenta#cuenta" onClick={close}>
              Mi cuenta
            </MenuLink>
          ) : null}
          <MenuLink href="/cuenta#datos" onClick={close}>
            Mis datos
          </MenuLink>

          {/* Apart: these are not settings but what is done to the session. Not shown while it is still being asked (it would flash for everyone who is in) nor where
              there are no accounts (the session cannot be read at all). */}
          {user ? (
            <div className="mt-1 border-t border-rule pt-1">
              <p className="px-3 py-2 text-xs wrap-anywhere text-ink-3">{user.email}</p>
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  close();
                  setSignOutOpen(true);
                }}
              >
                Cerrar sesión
              </button>
            </div>
          ) : !isPending && !error ? (
            <div className="mt-1 border-t border-rule pt-1">
              <MenuLink href="/cuenta#cuenta" onClick={close}>
                Iniciar sesión
              </MenuLink>
            </div>
          ) : null}
        </div>
      ) : null}

      {user ? <SignOutDialog open={signOutOpen} onClose={() => setSignOutOpen(false)} email={user.email} onError={(message) => toast({ tone: "bad", message })} /> : null}
    </div>
  );
}

// Normal case, not the bar's capitals: these are sentences to read, not the sections of the app.
const ITEM = "flex w-full items-center px-3 py-2 text-left text-sm text-ink-2 hover:bg-paper-2 hover:text-ink pointer-coarse:min-h-11";

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} role="menuitem" onClick={onClick} className={ITEM}>
      {children}
    </Link>
  );
}
