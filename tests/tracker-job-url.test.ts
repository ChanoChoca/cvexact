import { describe, expect, it } from "vitest";
import { canonicalizeJobUrl, extractLinkedInJobId } from "@/lib/tracker/job-url";

describe("extractLinkedInJobId", () => {
  // Compartido con site-rules/linkedin.ts, que lo usa para anclar la
  // tarjeta correcta dentro de una lista de resultados — no sólo para
  // canonicalizar. Cubierto acá directo, no sólo indirectamente vía
  // canonicalizeJobUrl.
  it("lee currentJobId de una búsqueda", () => {
    const url = new URL("https://www.linkedin.com/jobs/search-results/?currentJobId=4454142525&keywords=java");
    expect(extractLinkedInJobId(url)).toBe("4454142525");
  });

  it("cae a /jobs/view/<id> cuando no hay currentJobId", () => {
    const url = new URL("https://www.linkedin.com/jobs/view/4457361796/?trk=flagship3_search_srp_jobs");
    expect(extractLinkedInJobId(url)).toBe("4457361796");
  });

  it("null sin ninguna de las dos señales", () => {
    const url = new URL("https://www.linkedin.com/jobs/search-results/?keywords=java");
    expect(extractLinkedInJobId(url)).toBeNull();
  });
});

describe("canonicalizeJobUrl — LinkedIn", () => {
  it("reescribe la URL de búsqueda (currentJobId) a /jobs/view/<id>", () => {
    const url =
      "https://www.linkedin.com/jobs/search/?currentJobId=4457361796&f_TPR=r86400&keywords=java&origin=JOB_SEARCH_PAGE_JOB_FILTER&start=50";
    expect(canonicalizeJobUrl(url)).toBe("https://www.linkedin.com/jobs/view/4457361796");
  });

  it("limpia los parámetros de tracking de /jobs/view/<id>", () => {
    const url =
      "https://www.linkedin.com/jobs/view/4457361796/?alternateChannel=search&eBP=NOT_ELIGIBLE_FOR_CHARGING&refId=abc&trackingId=def&trk=d_flagship3_search_srp_jobs";
    expect(canonicalizeJobUrl(url)).toBe("https://www.linkedin.com/jobs/view/4457361796");
  });

  it("dos URLs distintas del mismo aviso (búsqueda vs. vista propia) coinciden", () => {
    const fromSearch = "https://www.linkedin.com/jobs/search/?currentJobId=4457361796&start=50";
    const fromView = "https://www.linkedin.com/jobs/view/4457361796/?trk=flagship3_search_srp_jobs";
    expect(canonicalizeJobUrl(fromSearch)).toBe(canonicalizeJobUrl(fromView));
  });

  // Sin id de aviso, `site-rules/linkedin-post.ts` arma el permalink de la
  // publicación (`urn:li:share:<n>` o `urn:li:ugcPost:<n>`) como jobUrl —
  // tiene que sobrevivir intacto al mismo camino de canonicalización.
  it("conserva el permalink de una publicación del feed (urn:li:share)", () => {
    const url = "https://www.linkedin.com/feed/update/urn:li:share:7505675641804206081/";
    expect(canonicalizeJobUrl(url)).toBe("https://www.linkedin.com/feed/update/urn:li:share:7505675641804206081/");
  });

  it("le saca los parámetros de tracking al permalink de una publicación", () => {
    const url = "https://www.linkedin.com/feed/update/urn:li:ugcPost:7505373022166601728/?utm_source=share&rcm=abc";
    expect(canonicalizeJobUrl(url)).toBe("https://www.linkedin.com/feed/update/urn:li:ugcPost:7505373022166601728/");
  });

  it("el mismo permalink con los ':' escapados (%3A) converge al mismo resultado", () => {
    const escaped = "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7505675641804206081/";
    const plain = "https://www.linkedin.com/feed/update/urn:li:share:7505675641804206081/";
    expect(canonicalizeJobUrl(escaped)).toBe(canonicalizeJobUrl(plain));
  });
});

describe("canonicalizeJobUrl — Indeed", () => {
  it("reescribe la URL de búsqueda (vjk) a /viewjob?jk=<id>", () => {
    const url = "https://ar.indeed.com/jobs?q=java&vjk=bca71b80d7034bb0&from=serp";
    expect(canonicalizeJobUrl(url)).toBe("https://ar.indeed.com/viewjob?jk=bca71b80d7034bb0");
  });

  it("limpia los parámetros de tracking de /viewjob?jk=<id>", () => {
    const url = "https://ar.indeed.com/viewjob?jk=bca71b80d7034bb0&tk=abc123&from=vjs";
    expect(canonicalizeJobUrl(url)).toBe("https://ar.indeed.com/viewjob?jk=bca71b80d7034bb0");
  });

  it("conserva el hostname de cada país — no fuerza un único dominio global", () => {
    const url = "https://www.indeed.com/viewjob?jk=bca71b80d7034bb0";
    expect(canonicalizeJobUrl(url)).toBe("https://www.indeed.com/viewjob?jk=bca71b80d7034bb0");
  });
});

describe("canonicalizeJobUrl — Glassdoor", () => {
  it("normaliza jl a jobListingId y saca la cola de tracking", () => {
    const url =
      "https://www.glassdoor.com.ar/Empleo/desarrollador-java-empleos-SRCH_KO0,18.htm?jobListingId=1005696021315&pos=101&ao=1136043&guid=abc&src=GD_JOB_AD&cb=123";
    expect(canonicalizeJobUrl(url)).toBe(
      "https://www.glassdoor.com.ar/Empleo/desarrollador-java-empleos-SRCH_KO0,18.htm?jobListingId=1005696021315",
    );
  });

  it("el link suelto con ?jl= converge al mismo nombre de parámetro", () => {
    const url = "https://www.glassdoor.com.ar/job-listing/desarrolladores-java-sam-sistemas-JV_KO0,20_KE21,33.htm?jl=1005696021315";
    expect(canonicalizeJobUrl(url)).toBe(
      "https://www.glassdoor.com.ar/job-listing/desarrolladores-java-sam-sistemas-JV_KO0,20_KE21,33.htm?jobListingId=1005696021315",
    );
  });

  it("nunca inventa un path — no hay evidencia de que uno corto resuelva, y jobUrl se muestra como link real (DetailPanel.tsx)", () => {
    const url = "https://www.glassdoor.com.ar/Empleo/algo-SRCH.htm?jobListingId=42";
    expect(canonicalizeJobUrl(url)).toContain("/Empleo/algo-SRCH.htm");
  });
});

describe("canonicalizeJobUrl — Computrabajo", () => {
  it("el id de 32 hex en el path ya alcanza — saca el slug de SEO y el #lc= de tracking", () => {
    const url =
      "https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-software-developer-java-en-cordoba-AE23D3890F1230EE61373E686DCF3405#lc=ListOffers-Score4-0";
    expect(canonicalizeJobUrl(url)).toBe("https://ar.computrabajo.com/ofertas-de-trabajo/AE23D3890F1230EE61373E686DCF3405");
  });

  it("la URL armada desde el link de la lista (domJobUrl) converge con la de la página propia del aviso", () => {
    const fromList =
      "https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-software-developer-java-en-cordoba-AE23D3890F1230EE61373E686DCF3405";
    const fromOwnPage =
      "https://ar.computrabajo.com/ofertas-de-trabajo/otro-slug-distinto-AE23D3890F1230EE61373E686DCF3405";
    expect(canonicalizeJobUrl(fromList)).toBe(canonicalizeJobUrl(fromOwnPage));
  });

  it("una URL de listado sin id no matchea y sigue el camino genérico", () => {
    const url = "https://ar.computrabajo.com/trabajo-de-java";
    expect(canonicalizeJobUrl(url)).toBe(url);
  });
});

describe("canonicalizeJobUrl — genérico", () => {
  it("saca parámetros utm_* y de tracking comunes en otros sitios", () => {
    const url = "https://jobs.lever.co/acme/abc123?utm_source=linkedin&utm_medium=social&ref=share";
    expect(canonicalizeJobUrl(url)).toBe("https://jobs.lever.co/acme/abc123");
  });

  it("no toca una URL que ya viene limpia", () => {
    const url = "https://jobs.lever.co/acme/abc123";
    expect(canonicalizeJobUrl(url)).toBe(url);
  });

  it("conserva parámetros que no son de tracking", () => {
    const url = "https://example.com/aviso?id=42";
    expect(canonicalizeJobUrl(url)).toBe("https://example.com/aviso?id=42");
  });

  it("una URL inválida se devuelve tal cual, sin explotar", () => {
    expect(canonicalizeJobUrl("no-es-una-url")).toBe("no-es-una-url");
  });
});
