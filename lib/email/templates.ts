import "server-only";

import type { Mail } from "@/lib/email/mailer";

/**
 * The account mails, in one place.
 *
 * Plain text first and HTML second, both carrying the same link: a fair number
 * of clients still render text, and a "please enable HTML to continue" mail is a
 * locked account. The HTML is inline-styled and asset-free on purpose — remote
 * images in a security mail are a read receipt for whoever intercepts it, and
 * every mail client would block them anyway.
 *
 * The tone matches the app: second person, rioplatense, no exclamation marks.
 *
 * Each mail carries a `kind` — see `MailKind` in `lib/email/mailer.ts` — so
 * `lib/email/budget.ts` can tell the two apart under load. `verificationMail`
 * is "unsolicited": anyone can trigger it against any address, at signup or
 * through the resend button, without proving they control it. The next four
 * are "account": each one requires an existing account and a request from
 * someone who can already reach it, and none of them go out because a stranger
 * typed an address into a form. `jobAlertMail` is its own third kind,
 * "job_alert": it requires an account too, but also its own consent and a
 * synced profile (cláusula 14 de privacidad) — see the comment on `MailKind`.
 */

const BRAND = "cvexact";

/** Wraps body copy and one call to action in the same shell. */
function layout(heading: string, body: string, action: { label: string; url: string }): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${heading}</h1>
  ${body}
  <p style="margin:24px 0">
    <a href="${action.url}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">${action.label}</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">
    Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br>
    <span style="word-break:break-all">${action.url}</span>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`;
}

export function verificationMail(to: string, url: string): Mail {
  return {
    to,
    kind: "unsolicited",
    subject: `Confirmá tu correo en ${BRAND}`,
    text: [
      `Creaste una cuenta en ${BRAND} con esta dirección.`,
      "",
      "Confirmala para poder sincronizar tu perfil entre dispositivos:",
      url,
      "",
      "El enlace vence en 24 horas. Si no fuiste vos, ignorá este mensaje: sin",
      "confirmar, la cuenta no puede hacer nada con tu correo.",
    ].join("\n"),
    html: layout(
      "Confirmá tu correo",
      `<p style="margin:0">Creaste una cuenta en ${BRAND} con esta dirección. Confirmala para poder sincronizar tu perfil entre dispositivos.</p>
       <p style="margin:12px 0 0;color:#666">El enlace vence en 24 horas. Si no fuiste vos, ignorá este mensaje: sin confirmar, la cuenta no puede hacer nada con tu correo.</p>`,
      { label: "Confirmar correo", url },
    ),
  };
}

/**
 * The magic link itself — "unsolicited" like `verificationMail`, for the same
 * reason: anyone can trigger it against any address they type, without
 * proving they control it. It can both sign in an existing account and create
 * a new one; either way, nothing happens with this address until the link is
 * actually clicked.
 */
export function magicLinkMail(to: string, url: string): Mail {
  return {
    to,
    kind: "unsolicited",
    subject: `Tu enlace para entrar a ${BRAND}`,
    text: [
      `Pediste entrar a ${BRAND} con esta dirección.`,
      "",
      "Este enlace te abre la sesión, sin contraseña:",
      url,
      "",
      "Vence en 15 minutos y sirve una sola vez. Si no lo pediste vos, ignorá",
      "este mensaje: sin hacer clic, no pasa nada con tu correo.",
    ].join("\n"),
    html: layout(
      "Tu enlace para entrar",
      `<p style="margin:0">Pediste entrar a ${BRAND} con esta dirección. Este enlace te abre la sesión, sin contraseña.</p>
       <p style="margin:12px 0 0;color:#666">Vence en 15 minutos y sirve una sola vez. Si no lo pediste vos, ignorá este mensaje: sin hacer clic, no pasa nada con tu correo.</p>`,
      { label: "Entrar a mi cuenta", url },
    ),
  };
}

export function resetPasswordMail(to: string, url: string): Mail {
  return {
    to,
    kind: "account",
    subject: `Restablecer tu contraseña de ${BRAND}`,
    text: [
      `Pediste restablecer la contraseña de tu cuenta de ${BRAND}.`,
      "",
      "Elegí una nueva desde acá:",
      url,
      "",
      "El enlace vence en 1 hora y sirve una sola vez. Si no lo pediste vos, no",
      "hace falta que hagas nada: tu contraseña actual sigue siendo la única válida.",
    ].join("\n"),
    html: layout(
      "Restablecer tu contraseña",
      `<p style="margin:0">Pediste restablecer la contraseña de tu cuenta de ${BRAND}. Elegí una nueva desde acá.</p>
       <p style="margin:12px 0 0;color:#666">El enlace vence en 1 hora y sirve una sola vez. Si no lo pediste vos, no hace falta que hagas nada: tu contraseña actual sigue siendo la única válida.</p>`,
      { label: "Elegir nueva contraseña", url },
    ),
  };
}

export function deleteAccountMail(to: string, url: string): Mail {
  return {
    to,
    kind: "account",
    subject: `Confirmá que querés borrar tu cuenta de ${BRAND}`,
    text: [
      `Pediste borrar tu cuenta de ${BRAND}.`,
      "",
      "Confirmá desde acá:",
      url,
      "",
      "Se borran tu perfil sincronizado y todas tus postulaciones guardadas en el",
      "servidor, y no se pueden recuperar. Los créditos que te queden no se",
      "reembolsan. Lo que tengas en este navegador no se toca.",
      "",
      "Si no lo pediste vos, ignorá este mensaje y no se borra nada.",
    ].join("\n"),
    html: layout(
      "Confirmá que querés borrar tu cuenta",
      `<p style="margin:0">Pediste borrar tu cuenta de ${BRAND}.</p>
       <p style="margin:12px 0 0">Se borran tu perfil sincronizado y todas tus postulaciones guardadas en el servidor, y <strong>no se pueden recuperar</strong>. Los créditos que te queden no se reembolsan. Lo que tengas en este navegador no se toca.</p>
       <p style="margin:12px 0 0;color:#666">Si no lo pediste vos, ignorá este mensaje y no se borra nada.</p>`,
      { label: "Borrar mi cuenta", url },
    ),
  };
}

/**
 * Sent the first time an account gets locked out.
 *
 * The only channel we have to tell someone their account is being guessed at.
 * It carries no link and asks for no action — a mail that arrives *because*
 * someone is attacking you is the worst possible place to train the habit of
 * clicking through — so it points at the app the user already knows how to reach.
 */
export function lockoutMail(to: string, minutes: number): Mail {
  const wait = `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  return {
    to,
    kind: "account",
    subject: `Bloqueamos los intentos de acceso a tu cuenta de ${BRAND}`,
    text: [
      "Hubo varios intentos fallidos de entrar a tu cuenta, así que la bloqueamos",
      `por ${wait}.`,
      "",
      "Si eras vos y te olvidaste la contraseña, esperá ese rato y usá la opción",
      `"¿Olvidaste tu contraseña?" en la pantalla de acceso.`,
      "",
      "Si no eras vos, alguien está probando contraseñas. Tu cuenta sigue segura —",
      "nadie entró — pero conviene que cambies la contraseña por una que no uses en",
      "ningún otro lado.",
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">Bloqueamos los intentos de acceso a tu cuenta</h1>
  <p style="margin:0">Hubo varios intentos fallidos de entrar a tu cuenta, así que la bloqueamos por ${wait}.</p>
  <p style="margin:12px 0 0">Si eras vos y te olvidaste la contraseña, esperá ese rato y usá la opción “¿Olvidaste tu contraseña?” en la pantalla de acceso.</p>
  <p style="margin:12px 0 0">Si no eras vos, alguien está probando contraseñas. Tu cuenta sigue segura —nadie entró— pero conviene que cambies la contraseña por una que no uses en ningún otro lado.</p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}

/** El tipo de solicitud, que decide el texto y no mucho más. */
export type LegalRequestKind = "arrepentimiento" | "baja";

/**
 * La constancia de una solicitud de arrepentimiento o de baja.
 *
 * La Res. SCI 424/2020 no se conforma con recibir el pedido: exige dejar
 * constancia de él. Este correo es esa constancia del lado del usuario —la otra
 * mitad es la fila en `legal_request`— y por eso lleva un código: sirve para
 * citar el pedido después, que es lo único que le permite a alguien discutir una
 * demora sin tener que probar que escribió.
 *
 * `kind: "unsolicited"`, igual que `verificationMail` y por la misma razón:
 * el formulario es público, cualquiera puede tipear cualquier dirección, y nadie
 * probó todavía que controla la casilla. Que el presupuesto lo trate como tal es
 * lo que evita que el botón de arrepentimiento se convierta en un caño para
 * mandarle correo a desconocidos.
 *
 * No lleva enlace y no pide hacer nada. Un acuse de recibo que además te manda a
 * hacer clic en algo es un acuse de recibo que enseña a confiar en el correo
 * equivocado.
 */
export function legalRequestMail(
  to: string,
  kind: LegalRequestKind,
  code: string,
): Mail {
  const arrepentimiento = kind === "arrepentimiento";

  const title = arrepentimiento
    ? "Recibimos tu solicitud de arrepentimiento"
    : "Recibimos tu solicitud de baja";

  /*
   * Párrafos enteros, no líneas sueltas. Las plantillas de arriba cortan el
   * texto plano a mano y eso está bien mientras el HTML se escriba aparte; acá
   * las dos salidas se derivan de la misma fuente, así que la unidad tiene que
   * ser el párrafo — repartir media oración por `<p>` es lo que pasa cuando no
   * lo es.
   */
  const paragraphs = arrepentimiento
    ? [
        "Recibimos tu pedido de revocación de la compra, en los términos del artículo 34 de la Ley 24.240. No hace falta que expliques nada.",
        "Lo procesamos y te reintegramos por el mismo medio de pago que usaste, dentro de los diez días hábiles. Si el pago fue con tarjeta, el plazo de acreditación de tu banco puede sumarse a eso.",
      ]
    : [
        "Recibimos tu pedido de baja de la suscripción.",
        "La damos de baja para que no se renueve. Conservás el acceso hasta el final del período que ya está pago; si además querés el reintegro proporcional, respondé este correo y lo tramitamos.",
      ];

  const note = `Guardá este código por si necesitás mencionar el pedido: ${code}`;

  return {
    to,
    kind: "unsolicited",
    subject: `${title} — ${BRAND}`,
    text: [...paragraphs, "", note].join("\n\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${title}</h1>
  ${paragraphs
    .map((line, index) => `<p style="margin:${index === 0 ? "0" : "12px 0 0"}">${line}</p>`)
    .join("\n  ")}
  <p style="margin:24px 0 0;font-size:13px;color:#666">Guardá este código por si necesitás mencionar el pedido: <strong style="color:#1a1a1a">${code}</strong></p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}

/**
 * El comprobante fiscal de una compra, ya con CAE.
 *
 * `kind: "account"`: sale de una compra real de una cuenta real, no de un
 * formulario que cualquiera puede completar con el mail de otro — mismo
 * criterio que `deleteAccountMail` y `lockoutMail`.
 *
 * Sin botón de acción, como `lockoutMail`: esto no pide nada, informa. ARCA no
 * entrega un PDF por el web service —sólo el CAE y su vencimiento—, así que el
 * comprobante es el texto de este correo, no un adjunto.
 */
export function invoiceMail(
  to: string,
  invoice: {
    ptoVta: number;
    cbteNro: number;
    cae: string;
    caeVto: Date;
    importe: number;
  },
): Mail {
  const numero = `${String(invoice.ptoVta).padStart(5, "0")}-${String(invoice.cbteNro).padStart(8, "0")}`;
  const importe = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(invoice.importe);
  const vencimiento = invoice.caeVto.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });

  return {
    to,
    kind: "account",
    subject: `Comprobante de tu compra en ${BRAND} — Factura C ${numero}`,
    text: [
      `Este es el comprobante de tu compra en ${BRAND}.`,
      "",
      `Factura C ${numero}`,
      `Importe: ${importe}`,
      `CAE: ${invoice.cae}`,
      `Vencimiento del CAE: ${vencimiento}`,
      "",
      "Conservá este correo: es tu constancia fiscal de la compra.",
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">Comprobante de tu compra</h1>
  <p style="margin:0">Este es el comprobante de tu compra en ${BRAND}.</p>
  <table style="margin:16px 0 0;width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#666">Factura C</td><td style="padding:4px 0;text-align:right">${numero}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Importe</td><td style="padding:4px 0;text-align:right">${importe}</td></tr>
    <tr><td style="padding:4px 0;color:#666">CAE</td><td style="padding:4px 0;text-align:right">${invoice.cae}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Vencimiento del CAE</td><td style="padding:4px 0;text-align:right">${vencimiento}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:13px;color:#666">Conservá este correo: es tu constancia fiscal de la compra.</p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}

/**
 * "N avisos nuevos para vos" — lo que manda `app/api/jobs/alerts/send/route.ts`
 * cuando encuentra avisos por encima del `minScore` de la alerta.
 *
 * `kind: "job_alert"`: exige cuenta, perfil sincronizado y el consentimiento
 * de la cláusula 14 — ver el comentario de `MailKind` en `lib/email/mailer.ts`
 * para por qué eso no lo hace un `"account"` más.
 *
 * Sin `layout()`: esa función arma un solo botón de acción, y acá el cuerpo
 * es una lista de avisos, cada uno con su propio enlace — el mismo motivo por
 * el que `invoiceMail` tampoco la usa. El enlace de gestionar la alerta va al
 * final, una sola vez, no por aviso.
 */
export function jobAlertMail(
  to: string,
  jobs: { title: string; company: string; score: number; url: string }[],
  manageUrl: string,
): Mail {
  const count = jobs.length;
  const subject = count === 1 ? `1 aviso nuevo para vos en ${BRAND}` : `${count} avisos nuevos para vos en ${BRAND}`;

  const textItems = jobs
    .map((job) => `- ${job.title}${job.company ? ` — ${job.company}` : ""} (${job.score}%)\n  ${job.url}`)
    .join("\n\n");

  const htmlItems = jobs
    .map(
      (job) => `<div style="margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid #e5e5e5">
    <a href="${job.url}" style="color:#1a1a1a;font-weight:600;text-decoration:none">${job.title}</a>
    <div style="margin-top:2px;font-size:13px;color:#666">${[job.company, `${job.score}% compatible`].filter(Boolean).join(" · ")}</div>
  </div>`,
    )
    .join("");

  return {
    to,
    kind: "job_alert",
    subject,
    text: [
      `Encontramos ${count === 1 ? "un aviso nuevo" : `${count} avisos nuevos`} que encaja${count === 1 ? "" : "n"} con tu perfil:`,
      "",
      textItems,
      "",
      "El puntaje se calculó en nuestro servidor con tu perfil sincronizado, sin pasar por ningún proveedor de modelos de lenguaje.",
      "",
      `Gestioná o apagá esta alerta acá: ${manageUrl}`,
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${count === 1 ? "1 aviso nuevo" : `${count} avisos nuevos`} para vos</h1>
  ${htmlItems}
  <p style="margin:16px 0 0;font-size:13px;color:#666">
    <a href="${manageUrl}" style="color:#1a1a1a">Gestioná o apagá esta alerta</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}

/**
 * El aviso de ghosting — un correo por corrida del cron, con todas las
 * postulaciones que ese día se marcaron `sin_respuesta`
 * (`scripts/tracker-cron.mjs`), nunca uno por postulación: agruparlas es lo
 * que hace que detectar diez procesos abandonados el mismo día no le cueste
 * diez envíos al presupuesto compartido (`lib/email/budget.ts`).
 *
 * El copy es deliberadamente no culpabilizante — es la única línea de este
 * archivo que existe por una razón de producto, no legal ni de seguridad:
 * "sin respuesta" en vez de "te ignoraron" o "fallaste", y la aclaración de
 * que es lo más común. Ver `docs/tracker-plan.md`, sección 7.
 */
export function ghostingMail(
  to: string,
  applications: { jobTitle: string; company: string }[],
  manageUrl: string,
): Mail {
  const count = applications.length;
  const subject =
    count === 1
      ? `Una postulación quedó sin respuesta — ${BRAND}`
      : `${count} postulaciones quedaron sin respuesta — ${BRAND}`;

  const list = applications.map((a) => `${a.jobTitle}${a.company ? ` — ${a.company}` : ""}`);

  return {
    to,
    kind: "tracker",
    subject,
    text: [
      count === 1
        ? "Esta postulación lleva más de 21 días sin novedades y la marcamos \"sin respuesta\":"
        : "Estas postulaciones llevan más de 21 días sin novedades y las marcamos \"sin respuesta\":",
      "",
      ...list.map((l) => `- ${l}`),
      "",
      "Es lo más común: la mayoría de los procesos de selección terminan así, sin aviso. No es necesariamente que hayas quedado afuera — a veces el puesto se pausa o el proceso simplemente no se cierra formalmente.",
      "",
      `Si en realidad seguís en carrera, podés revertir la marca en un click desde tu seguimiento: ${manageUrl}`,
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${count === 1 ? "Una postulación quedó sin respuesta" : `${count} postulaciones quedaron sin respuesta`}</h1>
  <ul style="margin:0 0 16px;padding-left:20px">
    ${list.map((l) => `<li style="margin:0 0 6px">${l}</li>`).join("")}
  </ul>
  <p style="margin:0 0 16px;color:#444">
    Es lo más común: la mayoría de los procesos de selección terminan así, sin aviso.
    No es necesariamente que hayas quedado afuera — a veces el puesto se pausa o el
    proceso simplemente no se cierra formalmente.
  </p>
  <p style="margin:0 0 16px">
    <a href="${manageUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">Revisar en mi seguimiento</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}

/**
 * Recordatorios vencidos, agrupados en un solo correo por la misma razón que
 * `ghostingMail`. `message` es lo que el usuario escribió al crear el
 * recordatorio (o el texto por default de "seguimiento a los 7 días" que
 * ofrece la UI al marcar una postulación como postulada).
 */
export function followUpMail(
  to: string,
  reminders: { jobTitle: string; company: string; message: string | null }[],
  manageUrl: string,
): Mail {
  const count = reminders.length;
  const subject = count === 1 ? `Un recordatorio de seguimiento — ${BRAND}` : `${count} recordatorios de seguimiento — ${BRAND}`;

  const list = reminders.map((r) => {
    const heading = `${r.jobTitle}${r.company ? ` — ${r.company}` : ""}`;
    return r.message ? `${heading}: ${r.message}` : heading;
  });

  return {
    to,
    kind: "tracker",
    subject,
    text: [
      count === 1 ? "Tenías un recordatorio para hoy:" : "Tenías estos recordatorios para hoy:",
      "",
      ...list.map((l) => `- ${l}`),
      "",
      `Gestioná tus recordatorios desde tu seguimiento: ${manageUrl}`,
    ].join("\n"),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 16px">${count === 1 ? "Un recordatorio de seguimiento" : `${count} recordatorios de seguimiento`}</h1>
  <ul style="margin:0 0 16px;padding-left:20px">
    ${list.map((l) => `<li style="margin:0 0 6px">${l}</li>`).join("")}
  </ul>
  <p style="margin:0 0 16px">
    <a href="${manageUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">Ver mi seguimiento</a>
  </p>
  <p style="margin:24px 0 0;font-size:13px;color:#666">— ${BRAND}</p>
</div>`,
  };
}
