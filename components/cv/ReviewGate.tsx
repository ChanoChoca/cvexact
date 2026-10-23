"use client";

import type { Finding } from "@/lib/ai/verify";

/**
 * La confirmación de que el CV se miró antes de mandarlo.
 *
 * El producto verifica cada dato contra el perfil y marca lo que no puede
 * respaldar, pero verificar no es garantizar: `lib/ai/practical.ts` documenta
 * que, sobre 5 postulaciones medidas, 4 declararon una disponibilidad que el
 * perfil nunca dijo — le agendaron al candidato un horario que nunca aceptó.
 * Ese es el daño concreto que esta casilla enfrenta, y no es hipotético.
 *
 * Sirve para dos cosas a la vez, y conviene decir las dos. La primera es
 * práctica: obliga a que los hallazgos del panel de arriba se lean antes de
 * exportar, en vez de scrollear hasta el botón. La segunda es jurídica: el art.
 * 40 de la Ley 24.240 pone la responsabilidad por el servicio defectuoso del
 * lado del proveedor y el art. 37 no deja excluirla por contrato, así que la
 * defensa no puede ser una cláusula — tiene que ser que el usuario efectivamente
 * revisó y confirmó, en el momento y con los hallazgos a la vista.
 *
 * Deliberadamente **solo acá**. Los botones de descarga sirven también para la
 * hoja de entrevista, el guion de video y un CV de plantilla, y pedir «confirmá
 * que revisaste» en esos seis lugares sería fricción sin protección: ninguno de
 * ellos es un documento que le llegue a un empleador afirmando cosas sobre una
 * persona.
 *
 * Ya no es una casilla aparte: confirmar y descargar son el mismo click.
 * `DownloadPdfButton`/`DownloadDocxButton` reciben un `confirm` con la
 * etiqueta ("Confirmar y descargar PDF"/"...Word") y el primer click hace las
 * dos cosas a la vez — antes eran dos pasos porque tildar y descargar estaban
 * separados; ahora el texto del botón mismo es el acto de confirmación
 * explícito, y este componente sólo expone lo que hace falta ver *antes* de
 * ese click: cuántos hallazgos quedan sin resolver y el disclaimer de abajo.
 *
 * La confirmación queda guardada como `reviewedCvHash` en el `Application`
 * (lib/storage/local.ts), hasheado con `cvContentHash` (lib/cv/review-hash.ts)
 * contra el `cv` exacto — no un booleano suelto: volver a generar o editar a
 * mano produce contenido distinto, y por lo tanto un hash que ya no matchea.
 * Que sobreviva a un reload no relaja el argumento del art. 40/37: un reload
 * mostrando ya confirmada una versión sin editar no es distinto de que el
 * usuario nunca hubiera navegado afuera — «revisó y confirmó, en el momento y
 * con los hallazgos a la vista» ya pasó una vez para ese contenido exacto. Lo
 * que sigue sin poder pasar es que sobreviva a un contenido *distinto*, y no
 * sobrevive: deliberadamente nunca se pre-confirma para una versión que el
 * usuario no vio en esta forma.
 */
export function ReviewGate({
  findings,
  reviewed,
}: {
  findings: Finding[];
  reviewed: boolean;
}) {
  const errors = findings.filter((finding) => finding.severity === "error");

  return (
    <div className="border-l-2 border-oro-soft py-1 pl-4">
      <p className="max-w-prose text-[13.5px] leading-relaxed">
        {reviewed
          ? "Ya confirmaste esta versión del CV."
          : errors.length > 0
            ? `Al descargar confirmás que revisaste el CV, incluido${errors.length === 1 ? " el punto marcado" : `s los ${errors.length} puntos marcados`}, y te hacés cargo de lo que dice.`
            : "Al descargar confirmás que revisaste el CV y te hacés cargo de lo que dice."}
      </p>
      {/* Cada error con su texto, no solo la cantidad: confirmar es haberlos leído. */}
      {!reviewed && errors.length > 0 ? (
        <ul className="mt-1.5 max-w-prose list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed">
          {errors.map((finding, at) => (
            <li key={`${finding.field}-${at}`}>{finding.detail}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 max-w-prose text-[12.5px] leading-relaxed text-ink-3">
        Lo escribió un modelo a partir de tu perfil. Puede equivocarse, sobre todo con
        horarios y credenciales: lo que firmes es tuyo.
      </p>
    </div>
  );
}
