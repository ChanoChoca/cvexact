-- Detección de duplicados (Fase 1): "ya existe una postulación parecida" se
-- responde con similarity() de pg_trgm sobre `company_norm` y `job_title`,
-- en vez de exigir una coincidencia exacta que "Mercado Libre" vs "MELI" o
-- "Backend Engineer" vs "Backend Engineer (Node.js)" nunca dan.
--
-- Si esta extensión no se puede crear en producción (el rol no tiene
-- permiso para CREATE EXTENSION — pasa en algunos Postgres administrados),
-- la migración falla acá mismo, en el deploy, de forma ruidosa — no en
-- silencio en medio de una búsqueda de duplicados. La alternativa sin
-- extensión (Levenshtein a mano sobre `company_norm`) está documentada en
-- docs/tracker-plan.md, sección de riesgos, para ese caso.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- GIN para que `similarity()`/`%` no hagan un scan secuencial de todas las
-- postulaciones de la cuenta a medida que crece.
CREATE INDEX IF NOT EXISTS application_company_norm_trgm_idx
  ON application USING gin (company_norm gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS application_job_title_trgm_idx
  ON application USING gin (job_title gin_trgm_ops);
