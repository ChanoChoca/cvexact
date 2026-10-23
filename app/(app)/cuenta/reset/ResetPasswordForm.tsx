"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, Input, SectionTitle } from "@/components/ui";
import { resetPassword } from "@/lib/auth-client";

/**
 * Where the link in the reset mail lands.
 *
 * Better Auth's `/reset-password/:token` endpoint checks the token first and
 * redirects here with either `?token=` (good for one use) or
 * `?error=INVALID_TOKEN` — so this page never sees a token it has to validate
 * itself, and an expired link is a message rather than a form that fails on
 * submit.
 */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const linkError = params.get("error");

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token || linkError) {
    return (
      <Card>
        <SectionTitle>El enlace no sirve</SectionTitle>
        <Alert tone="bad">
          Este enlace venció o ya se usó. Los enlaces de recuperación duran una hora y
          sirven una sola vez.
        </Alert>
        <p className="mt-4 text-sm text-ink-2">
          Pedí uno nuevo desde{" "}
          <a
            href="/cuenta"
            className="underline decoration-oro-soft underline-offset-4 hover:text-ink"
          >
            Mi cuenta
          </a>
          , con la opción “¿Olvidaste tu contraseña?”.
        </p>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <SectionTitle>Contraseña cambiada</SectionTitle>
        <Alert tone="good">
          Listo. Ya podés entrar con la contraseña nueva.
        </Alert>
        <p className="mt-4">
          <Button onClick={() => router.push("/cuenta")}>Ir a mi cuenta</Button>
        </p>
      </Card>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Checked here as well as by the server: catching a typo before spending
    // the token is the difference between fixing a field and asking for another
    // mail, because the token is consumed either way.
    if (password !== repeat) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña necesita al menos 8 caracteres.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await resetPassword({ newPassword: password, token });
    setBusy(false);

    if (result.error) {
      setError(result.error.message ?? "No pudimos cambiar la contraseña.");
      return;
    }
    setDone(true);
  };

  return (
    <Card>
      <SectionTitle>Elegí una contraseña nueva</SectionTitle>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres.">
          <Input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Repetila">
          <Input
            type="password"
            required
            minLength={8}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        {error ? <Alert tone="bad">{error}</Alert> : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </Card>
  );
}
