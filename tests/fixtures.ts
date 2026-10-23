import { profileSchema, type Profile } from "@/lib/schemas/profile";

/**
 * A backend profile whose tags name real technologies and whose bullets never
 * name an architecture pattern. It is the shape that makes a model reach for
 * the job ad's vocabulary instead of the candidate's, so it is what the
 * evidence checks are exercised against.
 */
export const backendProfile: Profile = profileSchema.parse({
  fullName: "Ana Gómez",
  city: "Junín",
  country: "Argentina",
  phone: "+54 236 555 0100",
  email: "ana.gomez@example.com",
  about:
    "Ingeniera de software especializada en servicios backend distribuidos y aplicaciones web escalables.",
  experience: [
    {
      id: "e1",
      company: "Flash Page",
      role: "Software Engineer",
      start: "Mayo 2024",
      end: "",
      current: true,
      bullets: [
        "Diseñé servicios desacoplados aplicando principios de arquitectura distribuida, con APIs REST/gRPC y procesamiento asíncrono mediante eventos.",
        "Optimicé sistemas backend sobre PostgreSQL y Redis, mejorando consultas SQL, caching e índices.",
        "Administré infraestructura cloud con Docker, Kubernetes y servicios AWS.",
      ],
      tags: ["Go", "Java", "Spring Boot", "PostgreSQL", "Redis", "Kafka", "gRPC", "Docker", "Kubernetes", "AWS", "Clean Code", "SOLID"],
    },
  ],
  education: [
    {
      id: "ed1",
      institution: "Universidad Nacional del Noroeste de la Provincia de Buenos Aires",
      degree: "Analista de Sistemas",
      end: "2025",
      status: "completed",
    },
  ],
  certifications: [{ id: "c1", name: "Cloud Practitioner", issuer: "AWS", date: "2024" }],
  languages: [
    { id: "l1", name: "Español", level: "Nativo" },
    { id: "l2", name: "Inglés", level: "Avanzado" },
  ],
});

/**
 * A developer profile with the shape the hard cases need: technical experience,
 * an unfinished degree, non-professional evidence, and practical facts that
 * only matter outside tech.
 */
export const devProfile: Profile = profileSchema.parse({
  fullName: "Juan Pérez",
  headline: "Desarrollador web",
  city: "Rosario",
  country: "Argentina",
  phone: "+54 341 555 0100",
  email: "juan.perez@example.com",
  links: [{ label: "github.com/perfil-ejemplo", url: "https://github.com/perfil-ejemplo" }],
  about: "Programo hace cuatro años, sobre todo aplicaciones web con React.",
  experience: [
    {
      id: "e1",
      company: "Talleres Digitales SRL",
      role: "Desarrollador Frontend",
      city: "Rosario",
      country: "Argentina",
      start: "Marzo 2021",
      end: "Agosto 2024",
      current: false,
      bullets: [
        "Desarrollé la interfaz del panel de clientes con React y TypeScript.",
        "Reduje el tiempo de carga inicial de 4s a 1,2s optimizando el bundle.",
        "Coordiné con dos diseñadores y un backend para entregar cada sprint.",
      ],
      tags: ["React", "TypeScript", "Git"],
      // This fixture stands for a finished profile, and finished now includes
      // having been through the numbers round — otherwise the agenda reports it
      // as still having something to ask about.
      metricsPass: true,
    },
    {
      id: "e2",
      company: "Kiosco San Martín",
      role: "Atención al público",
      city: "Rosario",
      country: "Argentina",
      start: "Enero 2019",
      end: "Febrero 2021",
      current: false,
      bullets: [
        "Atendí al público y manejé la caja durante turnos de ocho horas.",
        "Repuse mercadería y controlé el stock del depósito.",
      ],
      tags: [],
      metricsPass: true,
    },
  ],
  education: [
    {
      id: "ed1",
      institution: "Universidad Nacional de Rosario",
      degree: "Analista en Sistemas",
      city: "Rosario",
      country: "Argentina",
      end: "2020",
      honors: "",
      status: "in_progress",
    },
  ],
  skills: ["React", "TypeScript", "Git"],
  languages: [
    { id: "l1", name: "Español", level: "Nativo" },
    { id: "l2", name: "Inglés", level: "Intermedio" },
  ],
  extras: ["Voluntario en un comedor comunitario los sábados."],
  practical: {
    availability: "Disponibilidad full time, turnos rotativos incluidos",
    driverLicense: "B1",
    ownVehicle: false,
    willingToRelocate: false,
    workEligibility: "",
  },
});

/**
 * The profile behind the answer this whole check exists for.
 *
 * React and TypeScript live on one role's frontend work, Node.js on the same
 * role's backend services, and nothing says the three ever shared a repository.
 * Asked how many years of experience it had with all three, the generator
 * answered "0 años ... como combinación específica" — false by more than two
 * years, and signed by the user on an application form. The dates are the point:
 * a single current role starting May 2024, so every check that reads them has a
 * right answer to be measured against.
 */
export const fullstackProfile: Profile = profileSchema.parse({
  fullName: "Ana López Pérez",
  headline: "Desarrollador full stack",
  city: "Junín",
  country: "Argentina",
  email: "juan@example.com",
  about: "Desarrollo aplicaciones web de punta a punta.",
  experience: [
    {
      id: "e1",
      company: "Flash Page",
      role: "Desarrollador Full Stack",
      start: "Mayo 2024",
      end: "",
      current: true,
      bullets: [
        "Diseñé arquitecturas frontend con React y TypeScript para el panel de clientes.",
        "Construí los servicios backend en Node.js que alimentan ese panel.",
      ],
      tags: ["React", "TypeScript", "Node.js", "PostgreSQL"],
      metricsPass: true,
    },
  ],
  education: [
    {
      id: "ed1",
      institution: "Universidad Nacional del Noroeste de la Provincia de Buenos Aires",
      degree: "Analista de Sistemas",
      end: "2024",
      status: "completed",
    },
  ],
  skills: ["React", "TypeScript", "Node.js"],
  languages: [{ id: "l1", name: "Español", level: "Nativo" }],
});

/**
 * The profile from the run that motivated the selection work, reduced to the
 * parts that made it fail.
 *
 * Every property here is load-bearing and every one is what a real profile
 * looks like after a few months of use:
 *
 *   - one role, whose bullets are mostly backend and infrastructure, with a
 *     single line — the first — that mentions the visual, front-of-house work;
 *   - duplicated bullets, from a CV imported twice;
 *   - a very long skills list whose HTML and CSS entries sit at the very end,
 *     past anything a model reads, behind fragments left by a comma-split
 *     import ("índices", "locks", "connection pooling").
 *
 * Measured against a posting for an HTML developer it produced a CV that opened
 * on "Gestioné repositorios Git", kept the PostgreSQL and Linux bullets, listed
 * Java/Python/Go/SOAP as its additional skills, and dropped the landing-pages
 * line entirely.
 */
export const buriedFrontendProfile: Profile = profileSchema.parse({
  fullName: "Ana López Pérez",
  headline: "Software Engineer",
  city: "Junín",
  country: "Argentina",
  phone: "+54 236 555 0199",
  email: "ana.lopez@example.com",
  about:
    "Ingeniero de Software Full Stack especializado en aplicaciones web escalables, servicios backend distribuidos y arquitecturas frontend modernas.",
  experience: [
    {
      id: "e1",
      company: "Flash Page",
      role: "Software Engineer",
      start: "Abril 2024",
      end: "",
      current: true,
      bullets: [
        "Diseñé y entregué soluciones full-stack escalables para 5 proyectos de clientes: 2 plataformas de comercio electrónico y aplicaciones web empresariales personalizadas, además de paneles SaaS, sitios web corporativos, landing pages de conversión y sitios de portafolio.",
        "Desarrollé infraestructuras seguras de autenticación y autorización utilizando JWT, OAuth2, control de acceso basado en roles y gestión de sesiones.",
        "Construí arquitecturas frontend de alto rendimiento renderizadas en el servidor y estáticas, generando hasta 15 páginas estáticas con SSR, SSG, ISR y prerenderizado parcial para optimizar SEO, velocidad y conversión.",
        "Optimicé sistemas backend en PostgreSQL y Redis, aplicando mejoras en 300 consultas SQL por proyecto, logrando una reducción del 40% en tiempo de respuesta para operaciones críticas.",
        "Implementé módulos de negocio personalizados como sistemas de reservas, paneles administrativos, portales para miembros, flujos de captura de leads e interfaces orientadas al inventario.",
        // Typed three times over in the real profile; the duplicates are the point.
        "Implementé módulos de negocio personalizados como sistemas de reservas, paneles administrativos, portales para miembros, flujos de captura de leads e interfaces orientadas al inventario.",
        "Implementé módulos de negocio personalizados como sistemas de reservas, paneles administrativos, portales para miembros, flujos de captura de leads e interfaces orientadas al inventario.",
        "Colaboré bajo ciclos de entrega basados en sprints con requisitos de respuesta rápida.",
        "Administré 1 servidor Linux en entornos productivos, con systemd, análisis de logs, Nginx, certificados SSL/TLS, DNS y firewall.",
        "Gestioné repositorios Git siguiendo flujos de trabajo colaborativos, utilizando ramas, pull requests, code reviews y automatizaciones mediante pipelines CI/CD.",
      ],
      tags: ["Java", "Spring Boot", "React", "Next.js", "PostgreSQL", "Redis", "Docker", "Linux", "Git"],
    },
  ],
  education: [
    {
      id: "ed1",
      institution: "Universidad Nacional del Noroeste de la Provincia de Buenos Aires",
      degree: "Analista de Sistemas",
      end: "2025",
      status: "completed",
    },
  ],
  certifications: [{ id: "c1", name: "Cloud Practitioner", issuer: "AWS", date: "" }],
  languages: [
    { id: "l1", name: "Inglés", level: "Avanzado" },
    { id: "l2", name: "Español", level: "Nativo" },
  ],
  skills: [
    "Java", "JavaScript", "TypeScript", "Python", "Go", "Spring Boot", "Node.js", "MySQL",
    "PostgreSQL", "MongoDB", "APIs RESTful", "SOAP", "XML", "JWT", "OAuth2", "RBAC",
    "Drizzle ORM", "Django", "FastAPI", "ETL", "Kafka", "Redis", "gRPC", "Express.js",
    "Optimización SQL y rendimiento de bases de datos", "índices", "optimización de queries",
    "transacciones ACID", "niveles de aislamiento", "locks", "deadlocks", "connection pooling",
    "GraphQL", "React", "Next.js", "Astro", "Angular", "SSR", "SSG", "ISR", "PPR", "CSR",
    "Flutter (iOS y Android)", "Linux", "Docker", "Kubernetes", "CI/CD", "VPS", "Cloud",
    "Prometheus", "Grafana", "observabilidad", "monitoreo", "métricas", "dashboards", "alertas",
    "AWS", "GCP", "Azure", "Git", "Github Actions", "Nginx", "Bash scripting", "SSL/TLS", "DNS",
    "Networking TCP/IP", "Clean Code", "DRY", "SOLID", "KISS", "YAGNI", "diseño de APIs",
    "arquitectura escalable", "performance", "resiliencia", "pruebas unitarias",
    "pruebas de integración", "testing automatizado", "SCRUM (metodología ágil)", "OpenAPI",
    "Swagger", "LLMs", "Vercel AI SDK", "prompt engineering", "n8n", "Claude Code", "Cursor",
    "GitHub Copilot", "MCP servers", "context engineering",
    // The two the posting is named after, at the very end of the list.
    "CSS (Tailwind)",
    "HTML",
  ],
  practical: {
    availability: "Full time, Part time",
    driverLicense: "B1",
    ownVehicle: true,
    willingToRelocate: true,
    workEligibility: "Ciudadanía",
  },
});
