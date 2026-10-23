"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, SecretInput } from "@/components/ui";
import { passwordProblem, type LockedHolds } from "@/lib/storage/locked-copy";

/**
 * The password of a copy, asked for in one dialog wherever a copy is made or opened: «Bajar una copia con contraseña» in the profile and
 * in «Mis datos», the copy taken before «Borrar los datos de este navegador», and every place a copy is brought back.
 *
 * What is done with the password is the caller's (`use`), and it runs with the dialog still open: stretching a password into a
 * key takes about a second (`PBKDF2_ROUNDS`), and a wrong one is said where it was typed, not in a dialog that closed and
 * opened again. `use` returns `null` for a password that does not open the copy; whatever else it returns is what `ask`
 * resolves to. `ask` resolves to `null` when the person cancels.
 */

export type PasswordRequest<T> =
  /** A copy is being made: the password is chosen, twice, and nobody can recover it. */
  | { mode: "choose"; holds: LockedHolds; use: (password: string) => Promise<T> }
  /** A copy is being opened: `use` returns `null` when the password does not open it. */
  | { mode: "enter"; holds: LockedHolds; use: (password: string) => Promise<T | null> };

type AskFn = <T>(request: PasswordRequest<T>) => Promise<T | null>;

type Pending = { request: PasswordRequest<unknown>; resolve: (value: unknown) => void };

const PasswordContext = createContext<AskFn | null>(null);

export function useCopyPassword(): AskFn {
  const ask = useContext(PasswordContext);
  if (!ask) throw new Error("useCopyPassword must be used within a CopyPasswordProvider");
  return ask;
}

const WHAT: Record<LockedHolds, string> = {
  "cvexact-profile": "tu perfil",
  "cvexact-backup": "tu perfil y tus postulaciones",
};

export function CopyPasswordProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const ask = useCallback<AskFn>(
    <T,>(request: PasswordRequest<T>) =>
      new Promise<T | null>((resolve) => {
        setPassword("");
        setRepeated("");
        setError(null);
        setBusy(false);
        setPending({ request: request as PasswordRequest<unknown>, resolve: resolve as (value: unknown) => void });
      }),
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  const settle = (value: unknown) => {
    pending?.resolve(value);
    setPending(null);
    setPassword("");
    setRepeated("");
  };

  const cancel = () => {
    // Cancelling while the key is being made would leave the work running for nobody: it is waited for.
    if (!busy) settle(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending || busy) return;
    const { request } = pending;
    if (request.mode === "choose") {
      const problem = passwordProblem(password, repeated);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const result = await request.use(password);
      if (request.mode === "enter" && result === null) {
        setError("Esa contraseña no abre la copia.");
        return;
      }
      settle(result);
    } catch {
      setError(request.mode === "choose" ? "No pudimos armar la copia. Probá de nuevo." : "No pudimos abrir la copia. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const request = pending?.request;

  return (
    <PasswordContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={request ? "copy-password-title" : undefined}
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) cancel();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm border border-rule bg-paper-2 p-6 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        {request ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" data-copy-password={request.mode}>
            <p id="copy-password-title" className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-ink-3 uppercase">
              Copia con contraseña
            </p>
            {request.mode === "choose" ? (
              <p className="text-[14.5px] leading-relaxed text-ink-2">
                Sirve para una computadora que usa más de una persona: sin la contraseña, nadie puede abrir la copia de {WHAT[request.holds]}. Si la olvidás, no
                hay forma de recuperarla, tampoco nosotros.
              </p>
            ) : (
              <p className="text-[14.5px] leading-relaxed text-ink-2">Esta copia de {WHAT[request.holds]} tiene contraseña.</p>
            )}
            <label className="block space-y-1.5">
              <span className="block text-sm text-ink-2">Contraseña</span>
              <SecretInput
                value={password}
                autoFocus
                autoComplete={request.mode === "choose" ? "new-password" : "current-password"}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            {request.mode === "choose" ? (
              <label className="block space-y-1.5">
                <span className="block text-sm text-ink-2">Repetila</span>
                <SecretInput value={repeated} autoComplete="new-password" onChange={(event) => setRepeated(event.target.value)} disabled={busy} />
              </label>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-amber-300">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" type="button" onClick={cancel} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || password === ""} aria-busy={busy}>
                {busy ? (request.mode === "choose" ? "Protegiendo…" : "Abriendo…") : request.mode === "choose" ? "Bajar la copia" : "Abrir"}
              </Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </PasswordContext.Provider>
  );
}
