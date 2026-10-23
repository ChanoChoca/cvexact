import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Clause, LegalDoc, Pending } from "@/components/legal/parts";
import { operator } from "@/lib/legal/operator";

/**
 * Dinámica, no revalidada por hora — mismo motivo que `/legales/privacidad`
 * y `app/page.tsx`: `operator()` lee el entorno de producción, y
 * `revalidate` no lo estaba recogiendo de forma confiable en este
 * despliegue.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description:
    "Las condiciones de uso de cvexact: qué es el Servicio, cómo se usa con tu propia " +
    "API key y qué responsabilidad asume cada parte.",
};

/**
 * Los términos y condiciones.
 *
 * Un contrato de adhesión (CCyC arts. 984-989): lo redacta una sola parte y la
 * otra no negocia, lo que hace que las cláusulas ambiguas se interpreten en
 * contra de quien las escribió (art. 987) y que las abusivas se tengan por no
 * escritas (art. 988). Por eso acá no hay ninguna exclusión total de
 * responsabilidad ni ninguna renuncia de derechos: serían nulas de todos modos
 * —el art. 37 de la Ley 24.240 las fulmina— y su único efecto real sería que
 * este texto pareciera escrito de mala fe.
 *
 * Reescrito para una instalación que no vende nada: esta versión no menciona
 * planes, precios, topes pagos, revocación de compra ni baja de suscripción,
 * porque ninguna de esas cosas existe hoy. No son condicionales dentro de un
 * mismo texto —un contrato que dice dos cosas distintas según una variable de
 * entorno es peor que no tener contrato— así que si esta instalación vuelve a
 * vender, este documento necesita reescribirse de nuevo con esas cláusulas, no
 * activarse. Ver el historial de git para el texto anterior.
 *
 * Segunda pasada: se sacó la cláusula de donaciones. Cobrarlas en una cuenta
 * de persona física sin monotributo exponía a que el régimen de información
 * de procesadores de pago reporte esos cobros como ingresos no declarados.
 *
 * Tercera pasada: se restauró, distinta. `/apoyar` nunca dejó de estar
 * enlazada en el footer ni la wallet de Polygon dejó de estar cargada en
 * producción (`DONATION_WALLET_ADDRESS`) — lo que faltaba
 * era el término que la cubriera, y un contrato mudo sobre una función que
 * sigue pidiendo plata es peor que uno que la nombra. El mecanismo elegido
 * —wallet propia, sin pasar por un procesador de pagos— no depende de estar
 * inscripto: la exposición real no es la donación en sí (ganancia no gravada
 * por la teoría de la fuente, art. 2 ap. 1 de la Ley de Impuesto a las
 * Ganancias, mientras no sea habitual) sino que se vuelva habitual y
 * recaracterizable como ingreso por un servicio. Eso se asume, no se resuelve
 * con este texto, y se retoma cuando haya monotributo.
 *
 * La cláusula nueva es la 5, después de "Cómo se usa" y antes de "Tu
 * revisión": las siguientes se renumeraron corriéndose una posición (la vieja
 * 5 es ahora la 6, y así hasta la vieja 10 que es ahora la 11 — que es, de
 * nuevo, la que cita la cláusula 1 al hablar de "los plazos de la cláusula
 * 11"). El único ajuste interno fue la referencia a "la cláusula 5" dentro de
 * la cláusula 2, que ahora dice 6.
 *
 * Cuarta pasada: descubrimiento de empleo (`/empleos`). Se sumaron dos
 * párrafos al final de la cláusula 2 en vez de una cláusula nueva — es
 * exactamente el terreno de "qué es el Servicio, y qué no es" que esa
 * cláusula ya cubre, y evita otro renumerado como el de la tercera pasada.
 * Dice dos cosas sin vueltas: los avisos son contenido de terceros que no
 * verificamos, y cvexact no es una agencia de empleo ni cobra comisión por
 * ninguna contratación. Pendiente de revisión por un abogado: si mostrar
 * avisos agregados con alertas por correo encuadra de algún modo en la Ley
 * 24.013 (agencias de colocación) — este texto describe el modelo real
 * (ningún dato de candidato llega a un empleador por este medio, no hay
 * proceso de selección de nuestro lado), pero no es una determinación legal
 * de que la ley no aplica.
 *
 * Pasada del 2026-09-18 (auditoría legal previa a la publicación): la lista de
 * fuentes de la cláusula 2 omitía a Jobicy (`SOURCES` en
 * `scripts/ingest-jobs.mjs`) y a los sistemas de reclutamiento de empresas
 * (`scripts/jobs/companies.json`). Si se suma una fuente o una plataforma, se
 * suma acá también.
 *
 * Pasada del 2026-09-19 (cuarta auditoría legal): la cláusula 10 prometía avisar por
 * correo «con 30 días de anticipación» y no existe ningún envío ni plazo que lo
 * cumpla (`lib/email/templates.ts` no tiene una plantilla de cambio de términos y
 * ningún CronJob la manda). Ahora dice lo que sí pasa: la versión y la fecha de esta
 * página, y que se puede dejar el Servicio y borrar la cuenta. Es una cláusula menos
 * protectora que la anterior, a propósito: una promesa que nadie cumple es peor que
 * no hacerla. Si se construye el aviso por correo, volver a prometerlo acá y en la
 * cl. 13 de privacidad. `LEGAL_VERSION` sube en la misma pasada.
 *
 * Pasada del 2026-09-22: el ingreso por enlace de correo (magic link) suma una
 * cuenta sin contraseña, y la cláusula 3 asumía que siempre había una. Ahora
 * dice qué cuidar según cómo se entra: la contraseña si la hay, el correo si
 * no. `LEGAL_VERSION` sube en la misma pasada — ver `app/legales/privacidad`
 * para el resto de ese cambio.
 *
 * Pasada del 2026-10-07: sin cambios en el texto. La versión sube con la de la
 * política (`app/legales/privacidad`: el perfil en el tiempo, etapas 1 a 5 de e5), y
 * la fecha de vigencia que muestran las dos páginas es la misma. La cláusula 4 ya
 * dice que el contrato con el proveedor de la key es entre la persona y él, y eso
 * incluye su edad mínima y las condiciones de su nivel gratuito, que la cláusula 5
 * de la política cuenta para Google. Si algún día los términos tienen que decirlo
 * ellos, es una decisión de la asesoría legal (Q2 y Q10 de e5).
 */
export default function TermsPage() {
  const o = operator();

  return (
    <LegalDoc
      title="Términos y condiciones"
      intro={
        <p>
          En resumen: usás el Servicio con tu propia API key, así que es gratis y sin tope de
          nuestro lado. Lo que sigue es eso mismo, en detalle.
        </p>
      }
    >
      <Clause n={1} title="Quién presta el servicio">
        <p>
          El servicio cvexact (el «Servicio») es prestado por <Pending>{o.name}</Pending>.
          Cualquier consulta o reclamo se canaliza por <Pending>{o.email}</Pending>, con el
          procedimiento de la cláusula 11.
        </p>
      </Clause>

      <Clause n={2} title="Qué es el Servicio, y qué no es">
        <p>
          cvexact adapta tu currículum a un aviso de empleo concreto. A partir del perfil que
          vos cargás y del texto del aviso que pegás, genera un CV, respuestas para el
          formulario de postulación, un email de presentación, un guion de video y una hoja de
          preparación para la entrevista.
        </p>
        <p>
          El Servicio usa modelos de lenguaje. Eso implica dos cosas que conviene decir sin
          vueltas. La primera: el resultado puede contener errores, incluidos datos que no
          estén en tu perfil, y por eso la cláusula 6 pone la revisión final de tu lado. La
          segunda: <strong>el Servicio no consigue trabajo ni garantiza entrevistas,
          respuestas ni contrataciones</strong>. Lo que se ofrece es la generación de los
          documentos, no un resultado en tu búsqueda laboral.
        </p>
        <p>
          El Servicio se ofrece exclusivamente para la República Argentina, y estos
          términos se escribieron para el consumidor argentino. No está dirigido a personas
          en otro país, y usarlo desde otra jurisdicción no extiende a ese lugar ninguna
          protección adicional a la que ya da esta cláusula.
        </p>
        <p>
          En <Link href="/empleos" className="underline underline-offset-4 hover:text-ink">
            Empleos
          </Link>{" "}
          el Servicio también muestra avisos de portales de terceros (hoy: Get on Board,
          Himalayas, Remotive, Arbeitnow, Jobicy y, cuando esté configurado, Jooble) y de las
          páginas de empleo de algunas empresas, leídas de los sistemas de reclutamiento que
          esas empresas usan (hoy: Greenhouse, Ashby, SmartRecruiters y Workable). Ese
          contenido es de terceros: no lo redactamos, no lo verificamos ni respondemos por su veracidad,
          vigencia o condiciones. El porcentaje de compatibilidad que ves junto a cada aviso es
          una estimación automática nuestra sobre tu propio perfil, no una evaluación de quien
          publicó el aviso ni una garantía de nada.
        </p>
        <p>
          <strong>cvexact no es una agencia de empleo ni un intermediario laboral</strong>: no
          interviene en ningún proceso de selección, no cobra comisión a ningún empleador ni
          candidato por una contratación, y «Postular» o «Ver aviso» te lleva directamente al
          portal o al aviso original. Si te postulás, es entre vos y quien publicó el aviso —el
          Servicio no participa de esa relación.
        </p>
      </Clause>

      <Clause n={3} title="Cuenta y edad">
        <p>
          Podés usar el Servicio con tu propia API key sin crear cuenta: en ese caso tu perfil
          vive únicamente en tu navegador. La cuenta hace falta solo para sincronizar tu perfil
          entre dispositivos.
        </p>
        <Bullets
          items={[
            "Para usar el Servicio hay que tener 16 años o más, que es la edad mínima de admisión al empleo en la Argentina (Ley 26.390).",
            "Los datos de la cuenta tienen que ser tuyos y verdaderos. Si tu cuenta tiene contraseña, cuidarla es tu responsabilidad; si entrás con un enlace por correo, lo que tenés que cuidar es el acceso a ese correo.",
          ]}
        />
      </Clause>

      <Clause n={4} title="Cómo se usa: con tu propia API key">
        <p>
          El Servicio entero —CV, respuestas, email, entrevista y video, sin límite de uso— se
          corre con una API key que vos conseguís de un proveedor de modelos de lenguaje y
          cargás en Ajustes. No es un plan ni una promoción: es la única forma en que este
          Servicio funciona hoy.
        </p>
        <p>
          La key es tuya y el contrato con ese proveedor es entre vos y él: lo que te cobre,
          lo que te limite o lo que te ofrezca de tier gratuito no depende de nosotros y no
          somos parte de esa relación. La key viaja en cada generación para llamar al proveedor,
          pero no la guardamos ni la registramos de nuestro lado.
        </p>
      </Clause>

      <Clause n={5} title="Donaciones">
        <p>
          El Servicio ya es gratis y sin tope con tu propia API key: nada de esta cláusula
          cambia eso. Quien quiera bancar el hosting puede hacerlo con una donación en{" "}
          <Link href="/apoyar" className="underline underline-offset-4 hover:text-ink">
            Apoyar el proyecto
          </Link>
          , enviada directamente a una wallet en la red Polygon, en USDC o USDT.
        </p>
        <p>
          Es una <strong>liberalidad</strong>: no compra créditos, no da acceso a nada que no
          tengas ya, no cambia tu lugar en ninguna cola y no crea ninguna obligación de nuestro
          lado más allá de las que ya tenemos con cualquier usuario. Por no ser una compra, no
          es reembolsable y no se le aplican el artículo 34 de la Ley 24.240 ni la Resolución
          SCI 424/2020: esas normas parten de que hubo una venta, y acá no la hay.
        </p>
        <p>
          Los envíos en otra red o en otro activo distinto de USDC o USDT sobre Polygon pueden
          perderse sin posibilidad de recuperación: la wallet no está preparada para recibirlos.
          No pedimos ni guardamos ningún dato de quien dona —ni nombre, ni contacto, ni el
          monto— porque la transferencia ocurre directo en la red, sin pasar por nuestros
          servidores.
        </p>
      </Clause>

      <Clause n={6} title="Tu revisión, antes de mandar nada">
        <p>
          El Servicio verifica cada dato del CV contra tu perfil y te marca lo que no puede
          respaldar. Esa verificación reduce los errores, pero no los elimina: los modelos de
          lenguaje pueden producir texto incorrecto, y en particular pueden atribuirte una
          disponibilidad horaria, una credencial o una experiencia que tu perfil no dice.
        </p>
        <p>
          Por eso, <strong>antes de enviar cualquier documento a un empleador, revisalo</strong>.
          Sos vos quien se postula y quien responde por lo que afirma en su currículum. Un
          dato incorrecto que llegue a un empleador puede tener consecuencias reales en tu
          búsqueda o en tu relación laboral, y esa revisión final es la que no podemos hacer
          por vos.
        </p>
      </Clause>

      <Clause n={7} title="Lo que generás es tuyo, y el uso que no corresponde">
        <p>
          Los documentos que el Servicio genera a partir de tu perfil son tuyos, y podés usarlos
          como quieras, incluso comercialmente. No reclamamos ningún derecho sobre ellos ni
          sobre el contenido de tu perfil.
        </p>
        <p>No se puede usar el Servicio para:</p>
        <Bullets
          items={[
            "Cargar datos de otra persona haciéndolos pasar por propios, o construir un currículum falso.",
            "Automatizar el uso por fuera de la interfaz o revender el acceso.",
            "Cargar datos de terceros sin que ellos lo sepan y lo consientan.",
          ]}
        />
        <p>Si detectamos un uso así podemos suspender la cuenta.</p>
      </Clause>

      <Clause n={8} title="Responsabilidad">
        <p>
          Respondemos por la prestación del Servicio en los términos de la Ley 24.240 y del
          Código Civil y Comercial. <strong>No excluimos ni limitamos esa responsabilidad</strong>:
          el artículo 37 de la Ley 24.240 tiene por no escrita cualquier cláusula que lo
          intente, y no tiene sentido escribir algo que no sería válido.
        </p>
        <p>
          Lo que sí conviene delimitar es el objeto, que es lo que dice la cláusula 2: se
          ofrece la generación de documentos, no un resultado en tu búsqueda laboral.
        </p>
        <p>
          El proveedor del modelo que usás con tu API key es tuyo: su disponibilidad, sus
          precios y sus condiciones son un contrato entre vos y él, del que no somos parte.
        </p>
      </Clause>

      <Clause n={9} title="Tus datos">
        <p>
          Cómo se tratan tus datos personales, a quién se le transfieren y cómo ejercer tus
          derechos de acceso, rectificación y supresión está en la{" "}
          <Link
            href="/legales/privacidad"
            className="underline underline-offset-4 hover:text-ink"
          >
            política de privacidad
          </Link>
          , que forma parte de estos términos. Conviene leerla: incluye el detalle de la
          transferencia internacional de datos al proveedor del modelo.
        </p>
      </Clause>

      <Clause n={10} title="Cambios en estos términos">
        <p>
          Cada versión de estos términos queda identificada por la fecha de vigencia y el número
          de versión que figuran al principio de esta página. Si los cambiamos de manera
          sustantiva, publicamos la versión nueva acá y actualizamos esos dos datos.
        </p>
        <p>
          Como el Servicio es gratis y no tiene plazo mínimo de permanencia, si una versión nueva
          no te convence podés dejar de usarlo y borrar tu cuenta cuando quieras, como explica la
          cláusula 8 de la{" "}
          <Link
            href="/legales/privacidad#c8"
            className="underline underline-offset-4 hover:text-ink"
          >
            política de privacidad
          </Link>
          .
        </p>
      </Clause>

      <Clause n={11} title="Ley aplicable, jurisdicción y reclamos">
        <p>
          Se aplica la ley argentina. Para cualquier controversia son competentes los
          tribunales del domicilio del consumidor, conforme al artículo 36 de la Ley 24.240 y
          al artículo 1109 del Código Civil y Comercial. No hay prórroga de jurisdicción ni
          arbitraje obligatorio.
        </p>
        <p>
          Antes de eso, escribinos a <Pending>{o.email}</Pending>: la mayoría de los reclamos
          se resuelven ahí. También podés recurrir a la{" "}
          <a
            href="https://autogestion.produccion.gob.ar/consumidores"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-ink"
          >
            Ventanilla Única Federal de Defensa del Consumidor
          </a>{" "}
          y al Servicio de Conciliación Previa en las Relaciones de Consumo (COPREC), sin
          necesidad de habernos escrito antes.
        </p>
      </Clause>
    </LegalDoc>
  );
}
