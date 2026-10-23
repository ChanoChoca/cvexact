import { CV_LABEL_DEFAULTS, type CVDocument } from "@/lib/schemas/cv";

/**
 * El CV de referencia, como datos: el mismo contenido que
 * public/plantilla-cv.html.
 *
 * Existe para verificar la fidelidad de la plantilla: se renderiza en
 * /cv/demo/print y se compara contra el espécimen abierto al lado. Si el
 * renderer se mueve, este fixture lo muestra. El contenido es inventado; los
 * largos —resumen, cantidad de viñetas, formas de las secciones— se mantienen
 * parecidos a los de un CV real, porque de eso depende que la comparación mida
 * algo. No se editan para "mejorarlos".
 */
export const templateCV: CVDocument = {
  language: "es",
  header: {
    fullName: "Lucía Ferrer Molina",
    location: "Valencia, España",
    phone: "+34 600 00 00 00",
    email: "lucia.ferrer.molina@example.com",
    links: [
      { label: "linkedin.com/in/perfil-ejemplo", url: "https://www.linkedin.com/in/perfil-ejemplo/" },
      { label: "github.com/perfil-ejemplo", url: "https://github.com/perfil-ejemplo" },
      { label: "perfil-ejemplo.dev", url: "https://perfil-ejemplo.dev" },
    ],
  },
  summary:
    "Desarrolladora de software con más de una década de experiencia en producto web. En Nube Ámbar coordiné el frontend de tres productos, reduje un 35 % el tiempo de entrega y acompañé a seis personas en su primer año. Doy charlas internas sobre accesibilidad y revisión de código.",
  sections: [
    {
      kind: "experience",
      title: "EXPERIENCIA PROFESIONAL",
      items: [
        {
          company: "Nube Ámbar",
          role: "Lead FrontEnd Architect",
          location: "Valencia, España",
          dateRange: "Marzo 2018 – Octubre 2023",
          bullets: [
            "Coordiné el frontend de tres productos y unifiqué su librería de componentes, lo que redujo el trabajo duplicado entre equipos y acortó las entregas en un 35 %.",
            "Implementé un flujo de integración y despliegue continuos que bajó los errores en producción y llevó el tiempo de publicación de horas a minutos.",
            "Impulsé la mejora del rendimiento web con presupuestos de carga, paneles de métricas y sesiones de revisión entre equipos.",
            "Construí una herramienta compartida de consentimiento de cookies para todos los productos, alineada con la normativa de protección de datos.",
            "Introduje prácticas acordadas por escrito —revisión en parejas, ramas cortas y despliegues graduales— y evalué alternativas de infraestructura para sostener el crecimiento.",
          ],
        },
        {
          company: "Estudio Bruma",
          role: "Desarrollador FullStack",
          location: "Oporto, Portugal",
          dateRange: "Junio 2014 – Febrero 2018",
          bullets: [
            "Puse en marcha la tienda en línea del estudio y su panel de pedidos, con pruebas automáticas y publicación semanal.",
            "Reduje un 30 % el tiempo de carga del catálogo midiendo primero y optimizando después, sin reescribir la interfaz.",
            "Documenté la arquitectura y acompañé a dos personas nuevas en sus primeras tareas de backend.",
          ],
        },
        {
          company: "Taller Pardo",
          role: "Desarrollador FrontEnd",
          location: "Montevideo, Uruguay",
          dateRange: "Enero 2011 – Mayo 2014",
          bullets: [
            "Maqueté las primeras versiones del sitio y dejé una guía de estilos que el equipo siguió usando después.",
            "Aprendí a trabajar con plazos cortos y a pedir revisión antes de publicar.",
          ],
        },
      ],
    },
    {
      kind: "education",
      title: "EDUCACIÓN",
      items: [
        {
          institution: "Escuela Superior de Ingeniería Delta",
          degree: "Ingeniería de Software",
          location: "Valencia, España",
          date: "Junio 2010",
          honors: "Beca de excelencia académica en el trabajo de fin de carrera",
        },
      ],
    },
    {
      kind: "bullets",
      title: "SKILLS ADICIONALES",
      bullets: [
        "Mantengo un blog técnico y doy charlas breves en encuentros locales sobre accesibilidad y rendimiento.",
        "Nativo en Español y Catalán. Fluido en Inglés.",
      ],
    },
  ],
  // The template is Spanish, so its labels are the defaults verbatim.
  labels: CV_LABEL_DEFAULTS,
  coverage: { requirements: [], omitted: [] },
};
