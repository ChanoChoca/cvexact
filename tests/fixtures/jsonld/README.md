# Fixtures de portales de empleo

Todos los fixtures de este directorio son **sintéticos**. Reconstruyen sólo la
estructura que lee cada capa del extractor (`lib/tracker/jsonld.ts`,
`lib/tracker/microdata.ts` y `lib/tracker/site-rules/`), con datos ficticios. No
contienen copias de páginas reales ni texto de terceros.

| Archivo | Qué ejercita | Datos ficticios |
|---|---|---|
| `lever.html`, `greenhouse.html`, `ashby.html` | JSON-LD schema.org `JobPosting` (Ashby con `@graph`) | Omega Labs, Acme Corp, Beta Studio |
| `linkedin-search.html`, `linkedin-jobcard.html`, `linkedin-jobcard-list.html` | regla de sitio de LinkedIn (markup viejo y rediseño hasheado) | Nexo Labs, Acme Corp, Beta Studio, Gamma SA |
| `linkedin-post-search.html`, `linkedin-post-company.html`, `linkedin-post-permalink.html` | publicaciones del feed (persona, empresa, permalink) | Lucía Fernández, Marcos Díaz, Nexo Labs |
| `indeed-search.html` | regla de sitio de Indeed (`data-testid`) | Delta Tech |
| `glassdoor-search.html` | regla de sitio de Glassdoor (clases por prefijo) | Órbita Software |
| `computrabajo-search.html` | regla de sitio de Computrabajo (`data-offers-grid-detail-*`) | Kappa Finance |
| `getonboard.html` | microdata schema.org (`itemprop`) | Lambda Consulting |

## Regla

Ningún fixture puede contener un correo que no termine en `example.com`,
`example.org` o `ejemplo.com`. `tests/fixtures-no-pii.test.ts` lo verifica en cada
corrida y falla con el archivo y la dirección que encuentre.

Los comentarios dentro de un fixture no pueden incluir etiquetas HTML como
`<h1>`: el extractor genérico las lee como parte del documento.

## Cómo agregar o actualizar un fixture

1. Escribir el HTML mínimo que el extractor necesita — los selectores están en
   `lib/tracker/site-rules/` y en `lib/tracker/microdata.ts`.
2. Usar personas, empresas y correos ficticios.
3. Correr `pnpm vitest run tests/tracker-jsonld.test.ts tests/fixtures-no-pii.test.ts`.
