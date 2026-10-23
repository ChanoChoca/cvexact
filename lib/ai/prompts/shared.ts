import {
  buildEvidenceIndex,
  buildIndexFrom,
  findUnsupportedTerms,
  normalize,
  supports,
  type EvidenceIndex,
  type ExperienceFacts,
  type Tenure,
} from "@/lib/ai/evidence";
import { mentionsSkill } from "@/lib/onboarding/tools";
import { meaningfulExperience, type Profile } from "@/lib/schemas/profile";
import type { SkillLevel } from "@/lib/schemas/profile-v2";
import { skillKey } from "@/lib/text/normalize";
import type { InferredSkill, JobAnalysis } from "@/lib/schemas/job";

/**
 * Prompts are written in English regardless of the user's language — models
 * follow English instructions more reliably. The *output* language is a
 * parameter, carried by `languageDirective` below.
 */

/**
 * Injected into every generator. A CV with an invented employer is worse than a
 * thin one: it fails at the interview and costs the user the role. Rewriting
 * what the user wrote is the job; adding facts is not.
 */
export const HONESTY_RULES = `
FACTUAL INTEGRITY — these override every other instruction:
- Never invent employers, job titles, dates, degrees, certifications, or metrics.
  If a number is not in the profile, do not produce one.
- Never extend a date range, promote a title, or imply seniority the profile
  does not support.
- Rephrasing, reordering, translating, summarising, and reframing what the user
  wrote is expected. Adding facts they did not state is not.
- Every claim must trace to a specific profile entry or to a supplied inferred
  skill. If you cannot trace it, leave it out.
- When the job asks for something the candidate lacks, do not paper over it.
- Do not claim tools, languages, or systems the candidate never mentioned, even
  when the job asks for them.
`.trim();

/**
 * Where an uncovered requirement goes — a field only the CV has.
 *
 * This used to be a line inside `HONESTY_RULES`, which put "record it as
 * uncovered in the coverage report instead" into six prompts that emit no
 * coverage report. In the answer generator, with no such field to write it to,
 * the only reading left was "state the shortfall in the answer", and it read as
 * licence to open on it: a candidate with two years of React, TypeScript and
 * Node answered a form with "I have 0 years of formal experience in that stack
 * as a specific combination". Only `build-cv` appends it now.
 */
export const COVERAGE_REPORT_RULE = `
- An uncovered requirement is recorded in the coverage report. That report is the
  only place a shortfall belongs: it never appears on the CV itself, so no
  employer reads it. The candidate does — it is shown to them beside the preview
  and it is what they read to decide whether to apply — so write it for them.
`.trim();

export function languageDirective(language: string): string {
  return `
OUTPUT LANGUAGE: write every user-visible string in "${language}". This includes
section titles, summaries, bullet text and dates ("Agosto 2017 – Septiembre 2022"
in Spanish, "August 2017 – September 2022" in English). It also includes the
coverage report — "evidence", and every "item" and "reason" under "omitted" —
which is not printed on the CV but is read by the candidate. Field names and enum
values stay exactly as the schema defines them.
`.trim();
}

/**
 * The answer generator's variant. There, the posting's language is only the
 * default: the questions pasted from the employer's form were asked in their
 * own language, and an answer in any other language than its question reads as
 * written by someone else. `languageDirective` above still serves the
 * generators whose whole output answers to one source — the CV, the email.
 */
export function questionLanguageDirective(defaultLanguage: string): string {
  return `
OUTPUT LANGUAGE: the default is "${defaultLanguage}" — the posting's language.
Each answer, though, is written in the language its own question was asked in.
A form can mix languages — an English question gets an English answer even when
the posting is in Spanish — and an answer in any other language than its
question reads as written by someone else. For a question whose language gives
nothing away, fall back to the default.
`.trim();
}

/** The words the profile's job types and modes go by in a prompt. «other» says nothing worth the tokens. */
const EMPLOYMENT_WORDS: Record<string, string> = {
  full_time: "full-time",
  part_time: "part-time",
  freelance: "freelance",
  contract: "contract",
  internship: "internship",
  volunteer: "volunteer work",
  teaching: "teaching or teaching assistantship",
  research: "research",
  student_org: "student organisation",
};
const MODE_WORDS: Record<string, string> = { onsite: "on-site", remote: "remote", hybrid: "hybrid" };

/** When a study was: its start and end when it has a start, and as it always read — just the end — when it has none. */
function studyPeriod(edu: { start: string; end: string; status: string }): string {
  if (!edu.start) return edu.end || "?";
  return `${edu.start} – ${edu.end || (edu.status === "in_progress" ? "present" : "?")}`;
}

/**
 * What the candidate said stands out of a study — subjects or papers, a thesis, a grade — as the points they wrote, on the
 * study's own line. For a student these are most of what the education has to say.
 */
function highlightsOf(edu: { highlights: readonly string[] }): string {
  const points = edu.highlights.map((point) => point.trim()).filter(Boolean);
  return points.length > 0 ? ` highlights="${points.join("; ")}"` : "";
}

/**
 * Compact profile serialisation. Stable ordering matters: it keeps the prompt
 * prefix byte-identical across calls so provider-side caching can hit.
 */
export function serializeProfile(
  profile: Profile,
  options: {
    /**
     * Marks a tool the current posting asks about and floats it to the front of
     * its role's list. A profile with a hundred tags otherwise presents them in
     * the order they were typed, which is the order the model reads them in and
     * the reason the two that answer this posting get skipped.
     */
    highlight?: (tag: string) => boolean;
    /**
     * How many of the posting's terms a bullet carries. Supplied, the role's
     * bullets are sorted by it and annotated with the count. See
     * `orderBullets`.
     */
    rankBullet?: (text: string) => number;
    /**
     * Drops the candidate's technology inventory from the serialisation: the
     * headline, the ABOUT paragraph, each role's `tools:` line, and the whole
     * STATED SKILLS block.
     *
     * Set outside the candidate's field, where `STRATEGIES.unrelated` forbids
     * naming any of it and `serializeJargonBan` then lists it term by term as a
     * deny-list. Until now the same prompt printed all hundred-odd tags a few
     * thousand tokens earlier — the headline "Software Engineer", an ABOUT
     * naming Java, Spring Boot, React and Next.js, a `tools:` line per role —
     * and then asked for none of it to be used. A CV built for a
     * camera-installer vacancy came back naming RBAC, Zero Trust, SSR, SSG,
     * ISR, systemd, Nginx and DNS, none of it invented and all of it addressed
     * to the wrong reader.
     *
     * The bullets stay: they are the material the strategy reframes, and there
     * is nothing left to write from without them. So do education,
     * certifications, languages, extras and PRACTICAL, which are what this
     * reader actually wants.
     */
    omitTechInventory?: boolean;
    /**
     * Labels each project `[P1]`, `[P2]`… and each activity of the OTHER block `[O1]`, `[O2]`… by its position in the profile,
     * so the CV can point at one instead of naming it. Only the CV prompt asks: the CV is the one output that prints a project
     * or an activity, and what it prints comes from the profile, found again by this number (`withProfileProjects`,
     * `withProfileActivities`).
     */
    projectRefs?: boolean;
  } = {},
): string {
  const lines: string[] = [];

  // El nombre real no se serializa — ver `IDENTITY_WITHHELD` y
  // `restoreCandidateName` más abajo en este archivo.
  lines.push(`NAME: ${profile.fullName ? NAME_PLACEHOLDER : "(not given)"}`);
  if (profile.headline && !options.omitTechInventory) {
    lines.push(`HEADLINE: ${profile.headline}`);
  }
  lines.push(`LOCATION: ${[profile.city, profile.country].filter(Boolean).join(", ") || "(not given)"}`);
  /*
   * El teléfono, el correo y los links NO se serializan. Ver `IDENTITY_WITHHELD`
   * más abajo para el porqué; lo que importa acá es que ninguna salida los
   * necesitaba: el header del CV lo repone `headerFromProfile` en
   * `app/api/generate/cv/route.ts`, descartando lo que haya escrito el modelo, y
   * la firma del email la agrega la ruta después de generar. Se estaban
   * mandando a un proveedor en el exterior para que el servidor los tirara.
   */
  if (profile.about && !options.omitTechInventory) {
    lines.push(`\nABOUT (the candidate's own words):\n${profile.about}`);
  }

  const experience = meaningfulExperience(profile);

  if (experience.length) {
    // The annotation is only worth its line when it distinguishes something. On
    // a posting whose vocabulary the profile shares none of, every bullet
    // scores zero, and a wall of "[0 matches]" tells the model its only
    // material is worthless at exactly the moment that is the last thing it
    // needs to hear.
    const bulletsFor = new Map(experience.map((job) => [job, dedupe(job.bullets)]));
    // How each line was told, when the candidate said: an outcome they reported, or a thing that carries over to the kind of
    // job they are after. Said once, above the roles, and only for a profile that has any such mark: one that has none reads
    // exactly as it did.
    const tagsFor = (job: (typeof experience)[number]) => (text: string) =>
      [job.achievements.includes(text) ? "result" : "", job.transferable.includes(text) ? "transferable" : ""].filter(Boolean).join(", ");
    const tagged = experience.some((job) => job.achievements.length > 0 || job.transferable.length > 0);

    const ranked =
      options.rankBullet &&
      experience.some((job) => bulletsFor.get(job)!.some((b) => options.rankBullet!(b) > 0));

    lines.push(
      ranked
        ? "\nWORK EXPERIENCE — each role's bullets are ordered by how much of THIS posting they answer, and [n matches] is how many of its terms each one carries:"
        : "\nWORK EXPERIENCE:",
    );
    if (tagged) {
      lines.push("(A bullet tagged [result] is an outcome the candidate reported, not a duty; [transferable], one they say carries over to the kind of job they are after.)");
    }
    for (const job of experience) {
      const period = `${job.start || "?"} – ${job.current ? "present" : job.end || "?"}`;
      const place = [job.city, job.country].filter(Boolean).join(", ");
      // What kind of job it was and how it was done, when a source said it outright: an internship and a full-time post read differently.
      const how = [EMPLOYMENT_WORDS[job.employmentType], MODE_WORDS[job.workMode]].filter(Boolean).join(", ");
      lines.push(`- ${job.role || "(role not given)"} @ ${job.company || "(company not given)"}${place ? ` (${place})` : ""} [${period}]${how ? ` · ${how}` : ""}`);
      lines.push(...orderBullets(bulletsFor.get(job)!, ranked ? options.rankBullet : undefined, tagged ? tagsFor(job) : undefined));
      if (job.tags.length && !options.omitTechInventory) {
        lines.push(`    tools: ${orderTags(job.tags, options.highlight)}`);
      }
    }
  } else {
    lines.push("\nWORK EXPERIENCE: none recorded.");
  }

  if (profile.education.length) {
    lines.push("\nEDUCATION:");
    for (const edu of profile.education) {
      const place = [edu.city, edu.country].filter(Boolean).join(", ");
      lines.push(
        `- ${edu.degree || "(degree not given)"} @ ${edu.institution}${place ? ` (${place})` : ""} [${studyPeriod(edu)}] status=${edu.status}${edu.honors ? ` honours="${edu.honors}"` : ""}${highlightsOf(edu)}`,
      );
    }
  }

  if (profile.projects.length) {
    lines.push("\nPROJECTS:");
    for (const [index, p] of profile.projects.entries()) {
      const tags = p.tags.length ? ` [${p.tags.join(", ")}]` : "";
      // `p.url` no se serializa — ver `IDENTITY_WITHHELD`: un repositorio
      // personal identifica igual que un teléfono. Con `projectRefs` sí se dice
      // que hay uno, porque el modelo tiene que poder poner primero los que lo
      // tienen; la posición (`P{n}`) es la que `withProfileProjects` vuelve a leer.
      if (!options.projectRefs) lines.push(`- ${p.name}: ${p.description}${tags}`);
      else if (projectHasSubstance(p)) lines.push(`- [P${index + 1}] ${p.name}${p.url.trim() ? " (link on file)" : ""}${p.description ? `: ${p.description}` : ""}${tags}`);
    }
  }

  if (profile.certifications.length) {
    lines.push("\nCERTIFICATIONS:");
    for (const c of profile.certifications) {
      lines.push(`- ${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`);
    }
  }

  if (profile.skills.length && !options.omitTechInventory) {
    lines.push(
      options.highlight
        ? `\nSTATED SKILLS — the ones this posting names come first, each marked "*":\n${serializeSkills(dedupe(profile.skills), options.highlight, new Set(unusedSkills(profile)), profile.skillLevels)}`
        : `\nSTATED SKILLS: ${dedupe(profile.skills).join(", ")}`,
    );
  }

  if (profile.languages.length) {
    lines.push(`\nLANGUAGES: ${profile.languages.map((l) => `${l.name} (${l.level || "level not given"})`).join(", ")}`);
  }

  if (profile.extras.length) {
    lines.push("\nOTHER (volunteering, community, sport, interests):");
    for (const [index, e] of profile.extras.entries()) {
      if (!options.projectRefs) lines.push(`- ${e}`);
      else if (e.trim()) lines.push(`- [O${index + 1}] ${e}`);
    }
  }

  const p = profile.practical;
  const practical = [
    p.availability && `availability: ${p.availability}`,
    p.driverLicense && `driving licence: ${p.driverLicense}`,
    p.ownVehicle && "has own vehicle",
    p.willingToRelocate && "willing to relocate",
    p.workEligibility && `work eligibility: ${p.workEligibility}`,
  ].filter(Boolean);
  if (practical.length) lines.push(`\nPRACTICAL: ${practical.join("; ")}`);

  return lines.join("\n");
}

/**
 * The profile as the interview needs to see it: every entity labelled with the
 * id an operation must quote to change it.
 *
 * `serializeProfile` above deliberately hides ids — every other generator reads
 * the profile and writes a document, and an id in that prompt is noise the model
 * can only get wrong. The interview is the one caller that writes *back*, and
 * without ids the only correction it can express is "add another one": a user
 * saying "no, salí en 2022" gets a second copy of their job.
 *
 * Bullets and extras are numbered from 0, matching the array indices
 * `updateBullet` and `remove` take. Off-by-one here edits the wrong line.
 */
/**
 * Qué datos personales NO cruzan la frontera, y por qué.
 *
 * Los tiers pagos corren sobre nuestra key, hoy en DeepSeek: cada generación
 * manda el perfil a un proveedor en China, que no integra la lista de países con
 * protección adecuada de la Disp. AAIP 60-E/2016. El consentimiento del titular
 * es lo que sostiene esa transferencia (Ley 25.326 art. 12), pero el
 * consentimiento no vuelve necesario lo que era gratuito: el principio de
 * minimización pide mandar lo que hace falta y nada más.
 *
 * Teléfono, correo y links salieron porque **ninguna salida los usaba**:
 *
 *   - El CV: `app/api/generate/cv/route.ts` reemplaza `header` entero por
 *     `headerFromProfile(profile)`, o sea que lo que el modelo escribía en esos
 *     campos se descartaba. Se estaban transfiriendo para nada.
 *   - El email: la firma la arma la ruta después de generar, con los datos del
 *     perfil, en vez de pedirle al modelo que copie un bloque.
 *   - El resto —analyze-job, infer-skills, interview-prep, video-script,
 *     intake— no imprime datos de contacto en ningún caso.
 *
 * El NOMBRE también sale ahora, con el mismo mecanismo que evitaba sacarlo:
 * `answer-questions` responde el formulario del aviso, y un formulario puede
 * preguntar el nombre — sacarlo sin más convertía esa respuesta en un hueco
 * que el usuario tenía que llenar a mano. La salida es `NAME_PLACEHOLDER`
 * abajo: el prompt lo instruye a usar ese token literal donde hubiera puesto
 * el nombre, y `restoreCandidateName` lo repone del lado del servidor sobre
 * cualquier texto que la generación devuelva, antes de que salga de la ruta.
 * El modelo nunca ve el nombre real; quien lee la respuesta sí.
 *
 * `project.url` también sale de `serializeProfile`: un link a un repositorio
 * personal identifica igual que un teléfono, y ninguna salida lo necesitaba
 * más que `links[]`, que ya estaba afuera.
 *
 * Quien no quiera transferir nada tiene la salida entera: con su propia key
 * elige proveedor y país.
 */
const IDENTITY_WITHHELD = ["phone", "email", "links", "fullName", "project.url"] as const;

/**
 * Exportado para que los tests puedan afirmar sobre la decisión y no sobre su
 * implementación. `tests/pseudonymize.test.ts` comprueba que ninguno de estos
 * valores aparezca en ningún prompt.
 */
export const WITHHELD_PROFILE_FIELDS: readonly string[] = IDENTITY_WITHHELD;

/**
 * El token que el modelo ve en vez del nombre real.
 *
 * Deliberadamente ruidoso y entre corchetes: un nombre de pila real puede
 * aparecer por casualidad en cualquier texto ("Ana" el sistema de gestión, no
 * la candidata), y un token que no se parece a una palabra evita que
 * `restoreCandidateName` reemplace algo que no puso él mismo. La instrucción
 * de abajo le pide al modelo que lo use literal, sin traducirlo ni adaptarlo
 * al idioma de salida — es un identificador, no una palabra del texto.
 */
export const NAME_PLACEHOLDER = "[CANDIDATE_NAME]";

/**
 * La línea que le explica al modelo qué hacer con el placeholder.
 *
 * Exportada para `answer-questions.ts` únicamente: es el único prompt que
 * puede necesitar escribir el nombre en su salida (una pregunta del
 * formulario que lo pida), así que es el único que paga el costo en tokens de
 * esta instrucción. El resto de los generadores no imprime el nombre en
 * ningún caso — ver el comentario de `IDENTITY_WITHHELD` — y agregarles la
 * regla sería pagar tokens por una instrucción que nunca hace falta seguir.
 */
export const NAME_PLACEHOLDER_RULE = `
The candidate's real name has been replaced with the literal token ${NAME_PLACEHOLDER}
in the profile below. If you need to refer to the candidate by name anywhere in
your output — for example, answering a form question that asks for it — write
that exact token, unchanged and untranslated. Do not invent a name, and do not
explain the token; it is replaced with the real name after you respond.
`.trim();

/**
 * Repone el nombre real sobre lo que el modelo devolvió.
 *
 * Recorre cualquier valor JSON —string, array u objeto, a cualquier
 * profundidad— y reemplaza el token literal por el nombre real. Genérico y no
 * un reemplazo campo por campo porque el placeholder puede aparecer en
 * cualquier string de cualquier esquema de salida (`answers`, `interview`,
 * `video`…) y una lista de campos a mano es una lista que alguien se olvida de
 * actualizar cuando se agrega un campo nuevo.
 *
 * Se aplica sobre la respuesta entera de cada ruta, después de la validación
 * de esquema y antes de devolverla — nunca sobre lo que se guarda como
 * `analysis` o `inferredSkills` para reenviar en el siguiente pedido, porque
 * eso vuelve a viajar al modelo y el nombre real no tiene que estar ahí.
 */
export function restoreCandidateName<T>(value: T, fullName: string): T {
  if (typeof value === "string") {
    return value.split(NAME_PLACEHOLDER).join(fullName || NAME_PLACEHOLDER) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => restoreCandidateName(item, fullName)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = restoreCandidateName(val, fullName);
    }
    return out as T;
  }
  return value;
}

export function serializeProfileForIntake(profile: Profile): string {
  const lines: string[] = [];

  // El nombre real no se serializa — ver `IDENTITY_WITHHELD` y
  // `restoreCandidateName` más abajo en este archivo.
  lines.push(`NAME: ${profile.fullName ? NAME_PLACEHOLDER : "(not given)"}`);
  lines.push(`HEADLINE: ${profile.headline || "(not given)"}`);
  lines.push(`CITY: ${profile.city || "(not given)"}`);
  lines.push(`COUNTRY: ${profile.country || "(not given)"}`);
  // Mismo criterio que `serializeProfile`: ver `IDENTITY_WITHHELD`. Ni el
  // asistente de perfil ni el import escriben datos de contacto en su salida —
  // el import los extrae del documento que sube el usuario, no de este bloque.
  lines.push(`ABOUT: ${profile.about || "(not given)"}`);

  lines.push("\nWORK EXPERIENCE:");
  if (profile.experience.length === 0) lines.push("  (none recorded)");
  for (const job of profile.experience) {
    const place = [job.city, job.country].filter(Boolean).join(", ");
    const period = `${job.start || "?"} – ${job.current ? "present" : job.end || "?"}`;
    lines.push(
      `- [id=${job.id}] ${job.role || "(role not given)"} @ ${job.company || "(company not given)"}` +
        `${place ? ` (${place})` : ""} [${period}]`,
    );
    job.bullets.forEach((text, index) => lines.push(`    bullet ${index}: ${text}`));
    if (job.tags.length) lines.push(`    tools: ${job.tags.join(", ")}`);
  }

  lines.push("\nEDUCATION:");
  if (profile.education.length === 0) lines.push("  (none recorded)");
  for (const edu of profile.education) {
    const place = [edu.city, edu.country].filter(Boolean).join(", ");
    lines.push(
      `- [id=${edu.id}] ${edu.degree || "(degree not given)"} @ ${edu.institution || "(institution not given)"}` +
        `${place ? ` (${place})` : ""} [${edu.end || "?"}] status=${edu.status}` +
        `${edu.honors ? ` honours="${edu.honors}"` : ""}${highlightsOf(edu)}`,
    );
  }

  if (profile.projects.length) {
    lines.push("\nPROJECTS:");
    for (const p of profile.projects) {
      lines.push(
        `- [id=${p.id}] ${p.name}: ${p.description}${p.tags.length ? ` [${p.tags.join(", ")}]` : ""}`,
      );
    }
  }

  if (profile.certifications.length) {
    lines.push("\nCERTIFICATIONS:");
    for (const c of profile.certifications) {
      lines.push(`- [id=${c.id}] ${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`);
    }
  }

  lines.push(`\nSKILLS: ${profile.skills.join(", ") || "(none)"}`);

  lines.push("\nLANGUAGES:");
  if (profile.languages.length === 0) lines.push("  (none recorded)");
  for (const l of profile.languages) {
    lines.push(`- [id=${l.id}] ${l.name} (${l.level || "level not given"})`);
  }

  lines.push("\nOTHER ACTIVITIES (volunteering, community, sport):");
  if (profile.extras.length === 0) lines.push("  (none recorded)");
  profile.extras.forEach((extra, index) => lines.push(`- extra ${index}: ${extra}`));

  const pr = profile.practical;
  lines.push("\nPRACTICAL:");
  lines.push(`  availability: ${pr.availability || "(not given)"}`);
  lines.push(`  driverLicense: ${pr.driverLicense || "(not given)"}`);
  lines.push(`  workEligibility: ${pr.workEligibility || "(not given)"}`);
  lines.push(`  ownVehicle: ${pr.ownVehicle}`);
  lines.push(`  willingToRelocate: ${pr.willingToRelocate}`);

  return lines.join("\n");
}

/** Matching tags first, each marked, with the rest kept in their stated order. */
function orderTags(tags: string[], highlight?: (tag: string) => boolean): string {
  if (!highlight) return tags.join(", ");
  return matchingFirst(tags, highlight).join(", ");
}

/** Matching entries first, each marked; the rest keep the order they were typed. `note` adds a word after an entry. */
function matchingFirst(values: string[], highlight: (value: string) => boolean, note: (value: string) => string = () => ""): string[] {
  const matched = values.filter(highlight);
  const rest = values.filter((value) => !highlight(value));
  return [...matched.map((value) => `${value}*${note(value)}`), ...rest.map((value) => `${value}${note(value)}`)];
}

/**
 * How many stated skills reach the prompt.
 *
 * The list had neither an order nor a limit, and both were load-bearing. A
 * profile with 105 skills — the honest size once a user has filled the field in
 * over a few months — presented them in the order they were typed, and the
 * model wrote the first twelve into the skills section verbatim: Java,
 * JavaScript, TypeScript, Python, Go, Spring Boot, Node.js, MySQL, PostgreSQL,
 * MongoDB, APIs RESTful, SOAP, on a CV for an HTML developer. HTML, CSS, React
 * and Next.js were all in the same list, past the point anything was read.
 *
 * The cap is applied after the ordering, so what this cuts is always the tail
 * the posting does not name.
 */
const STATED_SKILLS_SHOWN = 40;

/** What the prompt says of a stated skill that no role, bullet or project of the profile names (`unusedSkills`). */
const UNUSED_SKILL_MARK = "(not used in any role or project)";

/** What the prompt says of a skill the person marked: how well they know it, and that a basic one is not for the CV. */
const SKILL_LEVEL_MARK: Record<SkillLevel, string> = { strong: "(strong)", working: "(regular use)", basic: "(basic: not listed in the CV)" };

function serializeSkills(skills: string[], highlight: (skill: string) => boolean, unused: ReadonlySet<string>, levels: Profile["skillLevels"] = {}): string {
  const ordered = matchingFirst(skills, highlight, (skill) => `${unused.has(skill) ? ` ${UNUSED_SKILL_MARK}` : ""}${levels[skill] ? ` ${SKILL_LEVEL_MARK[levels[skill]]}` : ""}`);
  const shown = ordered.slice(0, STATED_SKILLS_SHOWN);
  const hidden = ordered.length - shown.length;

  // Said rather than silently truncated: the model should know the list is the
  // relevant end of a longer one, not the whole of a short one.
  return hidden > 0
    ? `${shown.join(", ")}\n(and ${hidden} more the posting does not name, left out)`
    : shown.join(", ");
}

/**
 * The stated skills that nothing in the profile says where they were used: no role or project lists them as a tool, no bullet
 * names them and no project's text does — `mentionsSkill`, the same reading «¿Dónde usaste X?» asks by. A skill linked to a role is among
 * that role's tags (`linkedSkillTags`), so it is used.
 *
 * A skill of this kind says what the person can do, not what they did: the generator wrote it a use the profile does not give
 * it ("MongoDB y GraphQL como parte del stack de datos y consultas"), so it is marked in the prompt and is no material for the
 * skills section.
 */
export function unusedSkills(profile: Profile): string[] {
  const jobs = meaningfulExperience(profile);
  // A tag is a skill's name written as a list item, which `mentionsSkill` does not always read as a mention ("UX", a bare "Swift").
  const tags = [...jobs.flatMap((job) => job.tags), ...profile.projects.flatMap((project) => project.tags)];
  const named = new Set(tags.map(skillKey));
  const texts = [...jobs.flatMap((job) => job.bullets), ...tags, ...profile.projects.flatMap((project) => [project.name, project.description])];
  return profile.skills.filter((skill) => !named.has(skillKey(skill)) && !mentionsSkill(texts, skill));
}

/**
 * The same entry typed more than once, collapsed.
 *
 * Profiles accumulate duplicates: an imported CV pasted twice, a bullet written
 * by copying the one above it and then not edited. One real profile carried
 * three identical copies of each of two bullets — six of its fourteen lines,
 * spent telling the model the same two things.
 *
 * Done here rather than in `meaningfulExperience`, which other callers use to
 * show the user the profile as they actually typed it.
 */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How many projects the CV's "projects" section holds (`cvSectionSchema`). */
export const PROJECT_SLOTS = 4;

/**
 * A project the CV can show: it has a name and something to print beside it, a description or a link. One that is only
 * a name is not offered to the generator, not counted as material and not accepted back — a line that says nothing
 * is not worth a page's room, and the base CV (no generator, no page to fill) is where it still shows.
 */
export const projectHasSubstance = (project: { name: string; description: string; url: string }): boolean =>
  Boolean(project.name.trim() && (project.description.trim() || project.url.trim()));

/**
 * What the profile can honestly put on a page, counted by the kind of line it becomes.
 *
 * The length budget used to ask for a page without looking at how much the profile had: a role with two tasks was
 * told "write 7 bullets", and the five that did not exist were invented. Counted by kind because the kinds do not
 * trade: a project is a line of the projects section and never a bullet under a job, so `roleBullets` is what
 * each job may carry whatever the total says, and `total` only decides whether the page can be pushed to fill.
 * Certifications are not here — they are rows of the pairs section, and the prompt does not budget those.
 */
export type ProfileMaterial = {
  /** Per role of `meaningfulExperience`, in order: the tasks it gives, a repeated one counted once. */
  roleBullets: number[];
  /** Projects with something to show beyond a name (`projectHasSubstance`), up to the section's four. */
  projects: number;
  extras: number;
  /** One per study with highlights: they print together on that study's single line. */
  studyLines: number;
  /** Lines of tools the bullets leave over, up to three — and never one, because a skills section needs two. */
  skillLines: number;
  total: number;
};

export function profileMaterial(profile: Profile, options: { unrelated?: boolean } = {}): ProfileMaterial {
  const experience = meaningfulExperience(profile);
  const roleBullets = experience.map((job) => dedupe(job.bullets).length);
  const projects = Math.min(PROJECT_SLOTS, profile.projects.filter(projectHasSubstance).length);
  const extras = profile.extras.filter((extra) => extra.trim()).length;
  const studyLines = profile.education.filter((study) => study.highlights.some((point) => point.trim())).length;
  // Outside the candidate's field the tools are the jargon the strategy strips, so they are no material there.
  // Nor are the stated skills nothing says where they were used (`unusedSkills`): they are not listed, so they fill no line.
  const unused = new Set(options.unrelated ? [] : unusedSkills(profile));
  // A skill the person marked as basic is not listed either: it fills no line.
  const tools = options.unrelated ? 0 : dedupe([...experience.flatMap((job) => job.tags), ...profile.skills.filter((skill) => !unused.has(skill) && profile.skillLevels[skill] !== "basic")]).length;
  const toolLines = Math.min(3, Math.ceil(tools / 4));
  const skillLines = toolLines >= 2 ? toolLines : 0;

  return { roleBullets, projects, extras, studyLines, skillLines, total: roleBullets.reduce((a, b) => a + b, 0) + projects + extras + studyLines + skillLines };
}

/**
 * The role's own bullets, ordered by how much of this posting each one answers.
 *
 * `orderTags` above does this for tools and was added for the same reason: a
 * flat list in the order the candidate typed it is read in that order, and the
 * entries that answer this posting sit in the middle of it. Bullets are the
 * worse case, because the model does not merely skip the buried ones — it keeps
 * the profile's order wholesale, so the CV's opening line, the one line a
 * recruiter is guaranteed to read, is whatever the candidate happened to write
 * first. A run for a Python role opened on e-commerce landing pages.
 *
 * The count is shown rather than just the order: an ordering alone reads as
 * arbitrary, while "[3 matches]" says what it is ordered by, and a run of
 * "[0 matches]" at the bottom tells the model what it can safely leave out.
 *
 * Numbered, not bulleted with "*", because the system prompt forbids emitting
 * that character and the profile block should not be modelling it.
 */
function orderBullets(bullets: string[], rank?: (text: string) => number, tags?: (text: string) => string): string[] {
  const tag = (text: string) => {
    const found = tags ? tags(text) : "";
    return found ? `[${found}] ` : "";
  };
  if (!rank) return bullets.map((text, i) => `    b${i + 1} ${tag(text)}${text}`);

  const scored = bullets.map((text, index) => ({ text, index, hits: rank(text) }));
  // Stable: equal scores keep the candidate's own order, which is roughly
  // chronological and is the only ordering information left at that point.
  scored.sort((a, b) => b.hits - a.hits || a.index - b.index);

  return scored.map(
    (b, i) => `    b${i + 1} [${b.hits} ${b.hits === 1 ? "match" : "matches"}] ${tag(b.text)}${b.text}`,
  );
}

/**
 * The overlap between profile and posting, computed rather than left to the
 * model to spot.
 *
 * `serializeProfile` above is faithful but flat: a candidate with a hundred
 * tags gets them all on one `tools:` line, in the order they were typed, and
 * the two that answer this posting are buried in the middle of it. That is how
 * a CV for an event-driven backend role ends up without the word Kafka while
 * the profile has stated it all along.
 *
 * This block does not add facts. Everything in it is already in the profile
 * block; this says which parts of it this particular posting is asking about,
 * and — just as usefully — which requirements nothing in the profile answers.
 */
/**
 * A language is the one profile item routinely written in a different language
 * than the posting that asks for it: a Spanish profile says "Inglés" and an
 * English posting says "English", and nothing matches. The requirement most
 * often stated outright ("excellent communication skills in English") is
 * therefore the one most often missed.
 */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  ingles: ["english", "ingles", "inglez"],
  espanol: ["spanish", "espanol", "castellano", "espanhol"],
  portugues: ["portuguese", "portugues", "brazilian portuguese"],
  frances: ["french", "frances", "francais"],
  aleman: ["german", "aleman", "deutsch"],
  italiano: ["italian", "italiano"],
};

function languageNames(name: string): string[] {
  const key = normalize(name);
  for (const aliases of Object.values(LANGUAGE_ALIASES)) {
    if (aliases.includes(key)) return aliases;
  }
  return [name];
}

/** A short labelled fact the posting asks for and the profile answers. */
export type MatchedCredential = { label: string; value: string };

/**
 * Credentials, certifications and languages this posting names and the
 * candidate holds — computed here so the CV prompt can require them rather
 * than hope for them.
 */
export function matchedCredentials(profile: Profile, analysis: JobAnalysis): MatchedCredential[] {
  const jobIndex = buildJobIndex(analysis);

  return [
    ...profile.certifications
      .filter((c) => supports(jobIndex, c.name) || (c.issuer && supports(jobIndex, c.issuer)))
      .map((c) => ({
        label: c.name,
        value: [c.issuer, c.date].filter(Boolean).join(", "),
      })),
    ...profile.languages
      .filter((l) => languageNames(l.name).some((n) => supports(jobIndex, n)))
      .map((l) => ({ label: l.name, value: l.level })),
  ];
}

export function buildJobIndex(analysis: JobAnalysis): EvidenceIndex {
  return buildIndexFrom([
    analysis.title,
    analysis.domain,
    ...analysis.keywords,
    ...analysis.requirements.map((r) => r.text),
    ...analysis.responsibilities,
  ]);
}

export function serializeJobMatch(
  profile: Profile,
  profileIndex: EvidenceIndex,
  analysis: JobAnalysis,
): string {
  const sections: string[] = [];

  const credentials = matchedCredentials(profile, analysis);
  if (credentials.length) {
    sections.push(
      `Credentials and languages this posting asks for that the candidate holds. These are hard requirements, already met — they go in a "pairs" section, not into prose:\n${credentials
        .map((c) => `- ${c.label}${c.value ? ` — ${c.value}` : ""}`)
        .join("\n")}`,
    );
  }

  const gaps = analysis.requirements
    .map((r) => ({ text: r.text, missing: findUnsupportedTerms(r.text, profileIndex) }))
    .filter((r) => r.missing.length > 0);
  if (gaps.length) {
    sections.push(
      `Requirements naming a technology the profile never states. The named term
must not appear in the CV. What the candidate does have adjacent to it may —
in their own words, drawn from the profile — and where that adjacent evidence
is real, cover the requirement with it and set "inferred" true. Where there is
nothing adjacent, record the requirement as uncovered:\n${gaps
        .map((g) => `- ${g.text} → do not write: ${g.missing.join(", ")}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n") || "Nothing further to flag; work from the profile above.";
}

/**
 * Months as a person says them: "2 años y 3 meses" is written here as the
 * English the prompt is in, and the answer is translated by the output-language
 * directive like every other string.
 */
export function describeMonths(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest || !years) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.join(" ");
}

function describeTenure(tenure: Tenure): string {
  const where = tenure.roles
    .map((r) => `${r.role || "(role not given)"} @ ${r.company || "(company not given)"} (${r.period})`)
    .join("; ");

  // Named only in the profile's skills list, not in any role's own bullets or
  // tags. Real experience — credited for the whole (technical) career, the
  // same generosity `absent` already extends by not reporting it as lacking —
  // but with nothing tying it to one project. Said so explicitly: without
  // this, the model either invents a bullet that never named it, or reads the
  // silence as licence to hedge, which is the bug this branch exists to close.
  if (!tenure.linked) {
    const length = tenure.dated
      ? describeMonths(tenure.months)
      : "length unknown, the profile gives no dates";
    return (
      `- ${tenure.term} — listed in the candidate's skills, not tied to a specific role or ` +
      `bullet. Credit the full ${length} of general experience, across: ${where}. Describe how ` +
      `it was used in general, plain terms; do not invent a specific project, feature or ` +
      `codebase that named it.`
    );
  }

  // A technology the profile names in a role with no readable dates. Real
  // experience of unknown length: the one thing that must not be rendered as a
  // number, because every number available to render it is zero.
  if (!tenure.dated) return `- ${tenure.term} — length unknown, the profile gives no dates: ${where}`;
  return `- ${tenure.term} — ${describeMonths(tenure.months)}: ${where}`;
}

/**
 * The candidate's tenure, worked out in code and handed to the model as a fact.
 *
 * Arithmetic over free-text dates is the thing a model is worst at and this
 * codebase is already good at, and getting it wrong here is not a style defect:
 * a profile holding React, TypeScript and Node since May 2024 answered a form
 * with "0 years of formal experience in that stack as a specific combination",
 * which is both false and signed by the user. The fix is not a better
 * instruction, it is not asking. Same move `serializeJobMatch` above makes with
 * the posting's overlap, and `orderBullets` makes with bullet relevance.
 *
 * Each term stands on its own. A question naming three technologies is three
 * questions, not one question about whether they ever appeared in one repo.
 */
export function serializeExperienceFacts(facts: ExperienceFacts): string {
  const lines = [
    "These numbers are already worked out from the profile's dates. Use them as",
    "they stand: do not recompute them, and do not revise them downwards.",
    "",
  ];

  if (facts.dated) {
    lines.push(`Total professional experience: ${describeMonths(facts.totalMonths)}.`);
  } else {
    lines.push(
      "The profile's dates cannot be read, so no length of experience can be stated.",
      'Answer any "how long" question by naming where the work was done, give no',
      'number, and set "needsUserInput" true.',
    );
  }

  if (facts.tenures.length) {
    lines.push(
      "",
      "How long the profile backs each technology the questions or the posting name.",
      "Every one of these is experience the candidate genuinely has:",
      ...facts.tenures.map(describeTenure),
    );
  }

  if (facts.absent.length) {
    lines.push(
      "",
      `Asked about and absent from the profile: ${facts.absent.join(", ")}.`,
      "Do not claim these. Do not lead with them either — answer with the closest",
      "thing the candidate does have, and name the gap only where leaving it out",
      "would make the answer untrue.",
    );
  }

  return lines.join("\n");
}

/** The posting as the evidence index sees it: what it names and asks, none of what it says about the company. */
export function postingIndex(analysis: JobAnalysis): EvidenceIndex {
  return buildIndexFrom([
    analysis.title,
    analysis.domain,
    ...analysis.keywords,
    ...analysis.requirements.map((r) => r.text),
    ...analysis.responsibilities,
  ]);
}

/**
 * The derived skills this posting could actually use.
 *
 * Inference runs once per profile, not once per posting, so the list is the
 * whole of what can be deduced from the candidate's stack — 46 entries on a real
 * profile, every one of them a software skill. All 46 were being pasted into the
 * prompt for a groundskeeping vacancy, on the same page as a strategy whose
 * first instruction is "STRIP THE JARGON. Never list frameworks, languages or
 * tools": fifteen hundred tokens of context arguing with the instruction
 * directly below it.
 *
 * The prompt already said "ONLY where the posting asks for them". Doing it here
 * is the move `serializeVocabulary` made for keywords, for the same reason — a
 * judgement that can be computed should not be left to the model to lose.
 *
 * One filter for the two that need it: the prompt, which shows what is left, and
 * the route, which asks the person about it before the first CV.
 */
export function inferredForPosting(skills: InferredSkill[], analysis: JobAnalysis): InferredSkill[] {
  const posting = postingIndex(analysis);
  return skills.filter((s) => supports(posting, s.skill) || supports(posting, s.derivedFrom));
}

/**
 * What is still the person's to decide: the skills this posting asks for, that nothing in the profile states.
 * Vetoed ones are not here — the route drops them before it gets this far — and one the person said yes to is in the
 * profile now, so it stops being a question and becomes a fact.
 */
export function undecidedSkills(skills: InferredSkill[], analysis: JobAnalysis, profile: Profile): InferredSkill[] {
  if (skills.length === 0) return [];
  const stated = buildEvidenceIndex(profile);
  return inferredForPosting(skills, analysis).filter((s) => !supports(stated, s.skill));
}

export function serializeInferredSkills(skills: InferredSkill[]): string {
  if (!skills.length) return "None supplied.";
  return skills
    .map((s) => `- ${s.skill} (from "${s.derivedFrom}", confidence ${s.confidence}): ${s.rationale}`)
    .join("\n");
}
