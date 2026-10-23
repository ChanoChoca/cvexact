import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJobPosting } from "@/lib/tracker/jsonld";

const FIXTURES_DIR = join(process.cwd(), "tests/fixtures/jsonld");
const fixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf-8");

/**
 * Todos los fixtures de este directorio son sintéticos: reconstruyen sólo la
 * estructura que lee cada capa del extractor, con datos ficticios. No hay
 * copias de páginas de portales ni texto de terceros.
 *
 * `lever.html`, `greenhouse.html` y `ashby.html` ejercitan el mapeo de JSON-LD
 * (schema.org `JobPosting`); Ashby usa `@graph` a propósito.
 *
 * `linkedin-search.html`, `linkedin-jobcard*.html`, `linkedin-post-*.html`,
 * `indeed-search.html`, `glassdoor-search.html` y
 * `computrabajo-search.html` ejercitan las reglas de sitio (`site-rules/`).
 * `getonboard.html` no trae JSON-LD pero sí microdata schema.org
 * (`itemprop`), y ejercita `microdata.ts`, la capa entre el JSON-LD y las
 * reglas de sitio.
 */

describe("extractJobPosting — Lever (sintético)", () => {
  it("mapea el aviso del JSON-LD", () => {
    const result = extractJobPosting(fixture("lever.html"));
    expect(result.fromFallback).toBe(false);
    expect(result.jobTitle).toBe("IT Engineer Applications");
    expect(result.company).toBe("Omega Labs");
    expect(result.employmentType).toBe("Full-time");
    expect(result.datePosted).toBe("2026-08-31");
    expect(result.jdText).toContain("enterprise technology environment");
    expect(result.jdText).not.toContain("<p>");
  });
});

describe("extractJobPosting — Greenhouse (sintético)", () => {
  it("mapea título, empresa, ubicación, modalidad y salario", () => {
    const result = extractJobPosting(fixture("greenhouse.html"));
    expect(result.jobTitle).toBe("Senior Backend Engineer");
    expect(result.company).toBe("Acme Corp");
    expect(result.location).toBe("Buenos Aires, CABA");
    expect(result.remote).toBe(true);
    expect(result.salaryMin).toBe(3000);
    expect(result.salaryMax).toBe(4500);
    expect(result.currency).toBe("USD");
    expect(result.validThrough).toBe("2026-11-15T00:00:00Z");
  });
});

describe("extractJobPosting — Ashby (sintético, @graph)", () => {
  it("recorre @graph para encontrar el JobPosting", () => {
    const result = extractJobPosting(fixture("ashby.html"));
    expect(result.jobTitle).toBe("Product Designer");
    expect(result.company).toBe("Beta Studio");
    expect(result.remote).toBe(true);
  });
});

describe("extractJobPosting — LinkedIn (sintético, sin JSON-LD)", () => {
  it("usa la regla de sitio en vez de caer al <title> de la búsqueda", () => {
    const html = fixture("linkedin-search.html");
    const url = "https://www.linkedin.com/jobs/search/?currentJobId=4457361796&f_TPR=r86400&keywords=java";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site");
    expect(result.fromFallback).toBe(false);
    expect(result.jobTitle).toBe("Front-End Engineer");
    expect(result.company).toBe("Nexo Labs");
    expect(result.location).toBe("América Latina");
    expect(result.remote).toBe(true);
    expect(result.employmentType).toBe("Full-time");
    expect(result.jdText).toContain("Build the future with Nexo Labs");
    expect(result.jdText).not.toContain("<p>");
  });

  it("sin url, no puede aplicar la regla de sitio y cae al <h1> genérico", () => {
    const html = fixture("linkedin-search.html");
    const result = extractJobPosting(html);
    expect(result.extractedFrom).toBe("generic");
    // El <h1> sigue siendo único y correcto aunque no se sepa que es LinkedIn.
    expect(result.jobTitle).toBe("Front-End Engineer");
    expect(result.company).toBe("");
  });
});

describe("extractJobPosting — LinkedIn (sintético, rediseño con clases hasheadas)", () => {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4461976592&keywords=java";

  it("usa la vía nueva (componentkey) cuando las clases BEM ya no existen", () => {
    const html = fixture("linkedin-jobcard.html");
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site");
    expect(result.fromFallback).toBe(false);
    // El primer <p> de la tarjeta duplica el título en dos <span> (uno
    // aria-hidden, para lectores de pantalla) — no puede quedar concatenado.
    expect(result.jobTitle).toBe("Lead Java Server-side Engineer");
    expect(result.company).toBe("Acme Corp");
    expect(result.location).toBe("Argentina");
    expect(result.remote).toBe(true);
    expect(result.jdText).toContain("Backend-for-Frontend service layer");
    expect(result.jdText).not.toContain("<span");
  });

  it("sin url, cae al fallback genérico y no explota (sin <h1> en esta página)", () => {
    const result = extractJobPosting(fixture("linkedin-jobcard.html"));
    expect(result.extractedFrom).toBe("generic");
    // Regresión del bug real: el <title> trae DOS sufijos apilados
    // ("... | Acme Corp | LinkedIn") — antes sólo se sacaba el último.
    expect(result.jobTitle).toBe("Lead Java Server-side Engineer");
  });

  it("la vía vieja se sigue probando primero — el fixture con clases BEM no se rompió", () => {
    const html = fixture("linkedin-search.html");
    const oldUrl = "https://www.linkedin.com/jobs/search/?currentJobId=4457361796";
    const result = extractJobPosting(html, oldUrl);
    expect(result.jobTitle).toBe("Front-End Engineer");
    expect(result.company).toBe("Nexo Labs");
  });
});

describe("extractJobPosting — LinkedIn (sintético, lista con varias tarjetas)", () => {
  // El bug real: con una sola tarjeta en el fixture, "agarrar la primera del
  // documento" y "agarrar la que corresponde al id de la URL" dan el mismo
  // resultado por accidente — este fixture tiene dos tarjetas
  // completas, la única forma de detectar que ancla por posición y no por id.
  const html = fixture("linkedin-jobcard-list.html");

  it("ancla por el id de la URL, no por la primera tarjeta del documento", () => {
    // job-card-component-ref-4454142525 es la SEGUNDA tarjeta del fixture,
    // no la primera — si la regla agarrara "la primera que encuentra",
    // esto traería Senior Software Engineer / Beta Studio en su lugar.
    const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4454142525&keywords=java";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Sr. Java Developer");
    expect(result.company).toBe("Gamma SA");
    expect(result.location).toBe("Provincia de Buenos Aires, Argentina");
    expect(result.jdText).toContain("Gamma SA");
  });

  it("otro id en la misma página trae la otra tarjeta — confirma que ancla por id, no por posición", () => {
    // job-card-component-ref-4464130079 es la PRIMERA tarjeta del documento
    // real — la que el bug devolvía siempre, sin importar el aviso abierto.
    const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4464130079&keywords=java";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Senior Software Engineer");
    expect(result.company).toBe("Beta Studio");
  });

  it("sin currentJobId ni /jobs/view/ en la URL, no adivina — cae al fallback genérico", () => {
    const url = "https://www.linkedin.com/jobs/search-results/?keywords=java";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("generic");
  });
});

describe("extractJobPosting — LinkedIn (publicación del feed, texto libre)", () => {
  // Búsqueda de contenido, no de avisos — acá no hay ningún id de aviso en
  // la URL, a diferencia de los tres describe de arriba.
  const searchUrl = "https://www.linkedin.com/search/results/content/?keywords=java&datePosted=%5B%22past-24h%22%5D";

  it("ancla en la tarjeta marcada, no en la primera del documento", () => {
    // El fixture tiene dos tarjetas (con datos personales ficticios): Nexo Labs
    // (Lucía Fernández) PRIMERA y sin marca, Marcos Díaz SEGUNDA y con
    // `data-cvexact-anchor="1"` — la misma regresión que
    // `linkedin-jobcard-list.html` ya cubre para /jobs/view/.
    const html = fixture("linkedin-post-search.html");
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.fromFallback).toBe(false);
    expect(result.jdText).toContain("Work Location: Tampa, FL");
    expect(result.jdText).not.toContain("Nexo Labs");
    expect(result.jobTitle).toBe("Senior Java Developer");
    // El autor es una persona (un reclutador) y no hay ninguna empresa
    // mencionada como link dentro de su texto — no se inventa una.
    expect(result.company).toBe("");
    expect(result.domJobUrl).toBe("https://www.linkedin.com/feed/update/urn:li:share:7505675641804206081/");
  });

  it("conserva los saltos de línea del <br> y no se traga el botón «… más»", () => {
    const html = fixture("linkedin-post-search.html");
    const result = extractJobPosting(html, searchUrl);
    expect(result.jdText).toContain("Job Title: Senior Java Developer\nWork Location: Tampa, FL");
    expect(result.jdText).not.toContain("más");
    expect(result.jdText).not.toContain("<br");
    expect(result.jdText).not.toContain("<");
  });

  it("sin marca y con más de una tarjeta en la página, no adivina — cae al fallback genérico", () => {
    // El bug real que esto evita: agarrar "la primera tarjeta con
    // componentkey=update-card-focus…" sin ninguna otra señal.
    const html = fixture("linkedin-post-search.html").replace(' data-cvexact-anchor="1"', "");
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("generic");
  });

  it("el aviso adjunto gana como URL del puesto, y la empresa mencionada en el texto no se pierde", () => {
    // Misma tarjeta de Nexo Labs, ahora marcada — tiene un link a
    // /jobs/view/ (\"Empleo verificado\") y, dentro del propio texto, una
    // única mención a /company/nexolabs/ (\"Nexo Labs\").
    const html = fixture("linkedin-post-search.html")
      .replace(' data-cvexact-anchor="1"', "")
      .replace("<div class=", '<div data-cvexact-anchor="1" class=');
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.domJobUrl).toBe("https://www.linkedin.com/jobs/view/4466166850");
    expect(result.company).toBe("Nexo Labs");
    expect(result.jobTitle).toBe("Senior Java Developer");
    expect(result.location).toBe("Kochi (Hybrid)");
  });

  it("quien publica es una página de empresa — la empresa es quien publica, no una mención en el texto", () => {
    const html = fixture("linkedin-post-company.html");
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.company).toBe("Nexo Labs");
    expect(result.jobTitle).toBe("Java Software Engineer");
    expect(result.domJobUrl).toBe("https://www.linkedin.com/jobs/view/4465234484");
  });

  it("sin marca, el permalink de una publicación con una sola tarjeta también ancla", () => {
    const html = fixture("linkedin-post-permalink.html");
    const url = "https://www.linkedin.com/feed/update/urn:li:share:7505590119891103744/";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.company).toBe("Nexo Labs");
  });

  it("esa misma tarjeta sin marca, en una URL que no es el permalink, no ancla — no hay con qué desambiguar", () => {
    const html = fixture("linkedin-post-permalink.html");
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("generic");
  });

  it("una publicación que no es una oferta no inventa un título", () => {
    // Texto de ejemplo (un newsletter que convive con las
    // publicaciones de trabajo en el mismo feed) — sin "hiring" ni ninguna
    // etiqueta, y con una primera línea larga: ninguna de las tres reglas
    // de `guessTitle` debe inventar algo.
    const html = `<div data-cvexact-anchor="1" role="listitem" componentkey="update-card-focusXYZ">
      <p><span>Visual Studio Code</span></p>
      <span data-testid="expandable-text-box">☕ Java keeps evolving. And so does the way we build with it. Modern Java development brings together a more expressive language, powerful frameworks, AI-assisted development, and modern testing workflows.<br><br>Read more in our newsletter.</span>
    </div>`;
    const result = extractJobPosting(html, searchUrl);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.jobTitle).toBe("");
  });

  it("no le cambia nada al camino de /jobs/ existente — encadenar esta regla primero no lo rompe", () => {
    const html = fixture("linkedin-jobcard.html");
    const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4461976592&keywords=java";
    const result = extractJobPosting(html, url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Lead Java Server-side Engineer");
  });
});

describe("extractJobPosting — LinkedIn (publicación del feed, varios puestos o texto en prosa)", () => {
  // Los cuatro textos reales que el usuario capturó y reportó como mal
  // resueltos por la primera versión de la heurística (saludo/apertura
  // tomado como título). Envueltos en el mínimo HTML que necesita
  // `extractLinkedInPost` — mismo criterio que el test sintético de arriba
  // ("no inventa un título"), sin depender de un fixture real para esto.
  const searchUrl = "https://www.linkedin.com/search/results/content/?keywords=java";
  const wrapPost = (text: string, authorHtml = "<p><span>Reclutador</span></p>") =>
    `<div data-cvexact-anchor="1" role="listitem" componentkey="update-card-focusXYZ">
      ${authorHtml}
      <span data-testid="expandable-text-box">${text.replace(/\n/g, "<br>")}</span>
    </div>`;

  it("una publicación con varios puestos no agarra el saludo — devuelve los candidatos reales", () => {
    const text = `Hola Red!

Me encuentro en búsqueda de talento para las siguientes posiciones:

🔹 Desarrollador/a COBOL con inglés conversacional, interesado/a en capacitarse en VisionPLUS
🔹 Desarrollador/a Murex
🔹 Desarrollador/a Full Stack Java/Angular
🔹 Desarrollador/a Appian
🔹 Desarrollador/a Java Senior
🔹 Soporte de Aplicaciones SAP para procesos financieros y contables
🔹 Operador/a de Monitoreo de Aplicaciones N1

Si tienes experiencia en alguno de estos perfiles y te interesa conocer más, escribime.`;
    const result = extractJobPosting(wrapPost(text), searchUrl);
    expect(result.extractedFrom).toBe("site-post");
    expect(result.jobTitle).not.toBe("Hola Red");
    expect(result.jobTitle).not.toContain("Hola");
    expect(result.jobTitleCandidates).toHaveLength(7);
    expect(result.jobTitleCandidates).toContain("Desarrollador/a Java Senior");
    expect(result.jobTitleCandidates).toContain("Operador/a de Monitoreo de Aplicaciones N1");
  });

  it("el puesto real está en la segunda oración, no en el gancho inicial — lo encuentra igual", () => {
    const text = `💻 Buscamos talento Java.

En Nexo Labs tenemos una nueva oportunidad para un/a Desarrollador/a Java Semi Senior.
Buscamos experiencia, conocimiento técnico y ganas de asumir nuevos retos.
📍 Colombia
📩 seleccion@example.com`;
    const result = extractJobPosting(wrapPost(text), searchUrl);
    expect(result.jobTitle).toBe("Desarrollador/a Java Semi Senior");
    // Mención en prosa, sin link — nunca se autocompleta el campo real.
    expect(result.company).toBe("");
    expect(result.suggestedCompany).toBe("Nexo Labs");
    expect(result.location).toBe("");
    expect(result.suggestedLocation).toBe("Colombia");
  });

  it("dos puestos con viñeta en un mismo post — los dos, ninguna frase de apertura de más", () => {
    const text = `¡Seguimos sumando talento para afrontar nuevos desafíos! 🚀
Hoy tenemos nuevas oportunidades para vos:
🔹 Administrador/a de Bases de Datos PostgreSQL / Oracle SSR/SR
📍 CABA (Híbrido) - Postulate acá
🔹 Desarrollador/a Java SSR/SR
📍 CABA (Híbrido) - Postulate acá

Si te apasiona la tecnología, ¡queremos conocerte! 💙`;
    const result = extractJobPosting(wrapPost(text), searchUrl);
    expect(result.jobTitleCandidates).toEqual([
      "Administrador/a de Bases de Datos PostgreSQL / Oracle SSR/SR",
      "Desarrollador/a Java SSR/SR",
    ]);
  });

  it("un puesto mencionado dos veces, en español y en inglés, en oraciones distintas", () => {
    const text = `🚀 ¡Estamos buscando Desarrollador/a Java (Spring Boot)

🌎 100% remoto | Proyecto para Delta Tech
Estoy incorporando un/a Java Developer para sumarse a un proyecto de Delta Tech.`;
    const result = extractJobPosting(wrapPost(text), searchUrl);
    expect(result.jobTitle).toBe("Desarrollador/a Java (Spring Boot)");
    expect(result.jobTitleCandidates).toContain("Java Developer");
    // "Proyecto para Delta Tech" es ambiguo (¿empleador o cliente final de una
    // consultora?) — no hay mención con la forma de COMPANY_MENTION_RE
    // ("En <Empresa> tenemos/buscamos/estamos/somos"), así que ni siquiera
    // se sugiere.
    expect(result.company).toBe("");
    expect(result.suggestedCompany).toBeUndefined();
  });

  it("el autor-empresa sigue ganando por sobre cualquier candidato de texto", () => {
    const text = "Buscamos Desarrollador/a Java Senior para sumarse a nuestro equipo.";
    const result = extractJobPosting(
      wrapPost(text, '<p><span>Nexo Labs</span></p><a href="https://www.linkedin.com/company/areamovil/">empresa</a>'),
      searchUrl,
    );
    expect(result.company).toBe("Nexo Labs");
    expect(result.suggestedCompany).toBeUndefined();
  });
});

describe("extractJobPosting — Indeed (sintético, sin JSON-LD)", () => {
  const url = "https://ar.indeed.com/jobs?q=java&vjk=bca71b80d7034bb0";

  it("usa la regla de sitio — data-testid, no clases CSS", () => {
    const result = extractJobPosting(fixture("indeed-search.html"), url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Frontend Engineer – React, TypeScript & GenAI");
    expect(result.company).toBe("Delta Tech");
    expect(result.location).toBe("Desde casa");
    expect(result.remote).toBe(true);
    expect(result.employmentType).toBe("Tiempo completo");
    expect(result.jdText).toContain("Hey! We’re Delta Tech");
  });

  it("le saca el « - job post» pegado al título", () => {
    const result = extractJobPosting(fixture("indeed-search.html"), url);
    expect(result.jobTitle.endsWith("job post")).toBe(false);
  });

  it("sin url, el <h1> genérico descarta el saludo de la barra (\"Hola, Juan\")", () => {
    const result = extractJobPosting(fixture("indeed-search.html"));
    expect(result.extractedFrom).toBe("generic");
    expect(result.jobTitle).toBe("Frontend Engineer – React, TypeScript & GenAI");
  });
});

describe("extractJobPosting — Glassdoor (sintético, sin JSON-LD)", () => {
  const url =
    "https://www.glassdoor.com.ar/Empleo/desarrollador-java-empleos-SRCH_KO0,18.htm?jobListingId=1005696021315";

  it("usa la regla de sitio — clases CSS-module por prefijo, no por hash completo", () => {
    const result = extractJobPosting(fixture("glassdoor-search.html"), url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Desarrolladores JAVA");
    expect(result.company).toBe("Órbita Software");
    expect(result.location).toBe("Argentina");
    expect(result.jdText).toContain("Buscamos una persona con habilidades");
  });

  it("sin url, el <h1> genérico descarta el encabezado de la lista de resultados", () => {
    const result = extractJobPosting(fixture("glassdoor-search.html"));
    expect(result.extractedFrom).toBe("generic");
    expect(result.jobTitle).toBe("Desarrolladores JAVA");
  });
});

describe("extractJobPosting — Computrabajo (sintético, sin JSON-LD)", () => {
  const url = "https://ar.computrabajo.com/trabajo-de-java";

  it("usa la regla de sitio y arma la URL propia del aviso desde el link de la lista", () => {
    const result = extractJobPosting(fixture("computrabajo-search.html"), url);
    expect(result.extractedFrom).toBe("site");
    expect(result.jobTitle).toBe("Software Developer Java");
    expect(result.company).toBe("Kappa Finance");
    expect(result.location).toBe("Córdoba, Córdoba");
    expect(result.jdText).toContain("Kappa Finance potenciamos el ciclo financiero");
    expect(result.domJobUrl).toBe(
      "https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-software-developer-java-en-cordoba-AE23D3890F1230EE61373E686DCF3405",
    );
  });

  it("no confunde la plantilla Handlebars sin renderizar (no está en este fixture)", () => {
    const result = extractJobPosting(fixture("computrabajo-search.html"), url);
    expect(result.jobTitle).not.toContain("{{");
  });
});

describe("extractJobPosting — Get on Board (sintético, microdata sin JSON-LD)", () => {
  const url = "https://www.getonbrd.com/jobs/programming/desarrollador-integraciones-con-dynamics-365-bc-tecnologia-remote";

  it("la capa de microdata resuelve el aviso sin necesitar una regla de sitio", () => {
    const result = extractJobPosting(fixture("getonboard.html"), url);
    expect(result.extractedFrom).toBe("microdata");
    expect(result.fromFallback).toBe(false);
    expect(result.jobTitle).toBe("Desarrollador Integraciones con Dynamics 365");
    expect(result.company).toBe("Lambda Consulting");
    expect(result.location).toBe("Remote");
    expect(result.remote).toBe(true);
    expect(result.employmentType).toBe("Full-time");
    expect(result.datePosted).toBe("2026-09-11");
    expect(result.domJobUrl).toBe(
      "https://www.getonbrd.com/jobs/programming/desarrollador-integraciones-con-dynamics-365-lambda-consulting-remote",
    );
    expect(result.jdText).toContain("Profesional Senior responsable del desarrollo");
  });
});

describe("extractJobPosting — microdata no secuestra sitios sin itemprop=title", () => {
  it("microdata de la empresa (Organization/PostalAddress) sin itemprop=title del aviso no aplica", () => {
    const html = `<html><body>
      <div itemscope itemtype="https://schema.org/Organization">
        <span itemprop="name">Acme Corp</span>
      </div>
      <h1>Puesto real desde el h1</h1>
      </body></html>`;
    const result = extractJobPosting(html);
    expect(result.extractedFrom).toBe("generic");
    expect(result.jobTitle).toBe("Puesto real desde el h1");
  });
});

describe("extractJobPosting — casos borde", () => {
  it("sin JSON-LD, cae a title/meta description", () => {
    const html = `<html><head><title>Analista QA — Foo Inc</title>
      <meta name="description" content="Buscamos analista QA para equipo remoto."></head></html>`;
    const result = extractJobPosting(html);
    expect(result.fromFallback).toBe(true);
    expect(result.extractedFrom).toBe("generic");
    expect(result.jobTitle).toBe("Analista QA — Foo Inc");
    expect(result.jdText).toBe("Buscamos analista QA para equipo remoto.");
  });

  it("sin JSON-LD ni <h1>, limpia el contador y el sufijo de sitio del <title>", () => {
    const html = `<html><head><title>(22) Empleos de «java» | LinkedIn</title></head></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Empleos de «java»");
  });

  it("saca TODOS los sufijos de sitio apilados, no sólo el último", () => {
    // El bug real: LinkedIn manda "Puesto | Empresa | LinkedIn" y sólo se
    // sacaba " | LinkedIn", dejando "Puesto | Empresa" a medio limpiar.
    const html = `<html><head><title>Lead Java Server-side Engineer | Acme Corp | LinkedIn</title></head></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Lead Java Server-side Engineer");
  });

  it("prioriza <h1> sobre <title> cuando no hay og:title", () => {
    const html = `<html><head><title>(22) Empleos de «java» | LinkedIn</title></head>
      <body><h1>Front-End Engineer</h1></body></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Front-End Engineer");
    expect(result.extractedFrom).toBe("generic");
  });

  it("prioriza og:title sobre <title> en el fallback", () => {
    const html = `<html><head><title>Genérico</title>
      <meta property="og:title" content="Puesto real desde og:title"></head></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Puesto real desde og:title");
  });

  it("un array de bloques ld+json, el JobPosting no es el primero", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"name":"Acme"}}]</script>
      </head></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Data Engineer");
    expect(result.fromFallback).toBe(false);
  });

  it("JSON-LD roto en un bloque no rompe la extracción de los demás", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ esto no es json }</script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Recovers","hiringOrganization":{"name":"Acme"}}</script>
      </head></html>`;
    const result = extractJobPosting(html);
    expect(result.jobTitle).toBe("Recovers");
  });

  it("sin JSON-LD ni meta, no explota: campos vacíos", () => {
    const result = extractJobPosting("<html><body>nada acá</body></html>");
    expect(result.fromFallback).toBe(true);
    expect(result.jobTitle).toBe("");
  });
});
