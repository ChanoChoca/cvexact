"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";

type Kind = "arrepentimiento" | "baja";

type State =
  | { name: "idle" }
  | { name: "sending" }
  | { name: "sent"; code: string }
  | { name: "failed"; message: string };

/**
 * El formulario del botón de arrepentimiento y el de baja.
 *
 * Uno solo para los dos, porque son el mismo formulario: una dirección de
 * correo, un campo libre que nadie está obligado a llenar, y un botón. Lo que
 * cambia es el texto, no el flujo.
 *
 * Pide el correo y nada más. Ni número de operación, ni DNI, ni "motivo" con
 * asterisco: el art. 34 de la Ley 24.240 dice que la revocación no requiere
 * expresar causa, y un formulario que igual la exige está poniendo una condición
 * que la ley no permite poner. Lo mismo con la sesión — no la pide, ver el
 * comentario del handler en `app/api/legales/solicitud/route.ts`.
 */
export function RequestForm({ kind }: { kind: Kind }) {
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<State>({ name: "idle" });

  const arrepentimiento = kind === "arrepentimiento";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || state.name === "sending") return;

    setState({ name: "sending" });
    try {
      const response = await fetch("/api/legales/solicitud", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, email: email.trim(), details: details.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "No pudimos registrar tu solicitud.",
        );
      }
      setState({ name: "sent", code: String(payload.code ?? "") });
    } catch (error) {
      setState({
        name: "failed",
        message:
          error instanceof Error ? error.message : "No pudimos registrar tu solicitud.",
      });
    }
  };

  if (state.name === "sent") {
    return (
      <Alert tone="good" title="Listo, queda registrado">
        {arrepentimiento
          ? "Te mandamos la constancia por correo. Procesamos el reintegro por el mismo medio de pago dentro de los diez días hábiles."
          : "Te mandamos la constancia por correo. La suscripción no se renueva más."}
        {state.code ? `\n\nTu código de solicitud es ${state.code}.` : null}
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Field
        label="Tu correo electrónico"
        hint="El mismo con el que comprás o con el que tenés la cuenta. Si no estás seguro, poné el que usaste para pagar."
      >
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="vos@ejemplo.com"
        />
      </Field>

      <Field
        label="Algo que quieras agregar"
        hint="Opcional. No hace falta que expliques por qué: la ley no te obliga a dar ningún motivo."
      >
        <Textarea
          rows={3}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={
            arrepentimiento
              ? "Por ejemplo, el número de operación de Mercado Pago, si lo tenés a mano."
              : "Por ejemplo, si además querés el reintegro proporcional."
          }
        />
      </Field>

      {state.name === "failed" ? (
        <Alert tone="bad" title="No pudimos registrarla">
          {state.message}
        </Alert>
      ) : null}

      <Button type="submit" disabled={state.name === "sending"}>
        {state.name === "sending"
          ? "Enviando…"
          : arrepentimiento
            ? "Ejercer el arrepentimiento"
            : "Dar de baja la suscripción"}
      </Button>
    </form>
  );
}
