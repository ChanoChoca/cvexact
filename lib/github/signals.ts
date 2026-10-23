import { fold } from "@/lib/parse/dictionaries";
import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";

/**
 * Whether the profile says its person works with code (e5 UX, U42): the one reason to put «Traer mis proyectos de GitHub» in front of someone. It was a button in the projects of
 * everybody, and to a woman in charge of a warehouse it said that something was missing from her profile — P14: a GitHub nobody has is not a hole, and having one is no reproach.
 * Where nothing in the profile speaks of code, the way to GitHub is a line inside «Agregar proyecto», for whoever has one.
 *
 * Only what the person wrote and only the names that mean code and nothing else: a language, a framework, a tool of the trade, a way of naming the work. «Software», «sistema» or
 * «API» alone are not in it — a person who manages a stock says «el software de stock» — and neither is a spreadsheet, which is a tool and not code. A guess, and a cheap one to be
 * wrong about: it decides whether a button is the first thing in the projects or a line under the form, and nothing else.
 */

const TERMS = [
  // Languages and what they run on. Words that are also words are left out: «angular» is a profile of steel, «swift» is a bank, «express» is a courier.
  "javascript", "typescript", "python", "java", "kotlin", "rust", "php", "ruby on rails", "golang", "c#", "c\\+\\+", "asp\\.net", "\\.net core", "node\\.js", "nodejs", "next\\.js", "nextjs",
  "react", "react native", "vue\\.js", "vuejs", "angularjs", "svelte", "django", "flask", "fastapi", "laravel", "spring boot", "flutter", "nestjs", "html", "css", "sql", "postgresql", "mysql", "mongodb",
  // Tools of the trade.
  "git", "github", "gitlab", "docker", "kubernetes", "terraform", "linux", "aws", "azure", "devops", "ci/cd", "graphql", "tensorflow", "pytorch", "pandas", "numpy",
  // The ways of naming the work, with what they are the work of: «desarrollador inmobiliario» and «programador de CNC» are not in it.
  "desarrollador de software", "desarrolladora de software", "desarrollador web", "desarrolladora web", "desarrollador full stack", "desarrolladora full stack", "desarrollador frontend", "desarrollador backend",
  "desarrollador mobile", "desarrollador de aplicaciones", "programador web", "programadora web", "programador de software", "programadora de software", "software developer", "web developer",
  "full stack developer", "frontend developer", "backend developer", "mobile developer", "ingeniero de software", "ingeniera de software", "desarrollo de software", "desarrollo web", "analista programador",
  "analista de sistemas", "ingenieria en sistemas", "ingenieria en informatica", "licenciatura en sistemas", "licenciatura en informatica", "tecnicatura en programacion", "tecnicatura en informatica",
  "ciencias de la computacion", "front-end", "frontend", "back-end", "backend", "fullstack", "full stack", "full-stack", "data engineer", "data scientist", "machine learning", "qa automation",
];

const WORD = new RegExp(`(?<![\\p{L}\\p{N}+#.])(?:${TERMS.join("|")})(?![\\p{L}\\p{N}+#])`, "u");

const speaksOfCode = (text: string): boolean => text.trim() !== "" && WORD.test(fold(text));

/** Whether anything the person wrote —their skills, their jobs and what they did in them, their studies, their projects, what they look for— speaks of code. */
export function hasTechnicalSignals(profile: StoredProfile): boolean {
  if (profile.skills.some((skill) => speaksOfCode(skill.name.value))) return true;
  if (profile.experience.filter(isMeaningfulExperience).some((job) => speaksOfCode(job.role.value) || job.facts.some((fact) => speaksOfCode(fact.text)))) return true;
  if (profile.education.some((study) => speaksOfCode(study.degree.value))) return true;
  if (profile.projects.some((project) => speaksOfCode(project.name.value) || speaksOfCode(project.description.value) || project.tags.value.some(speaksOfCode))) return true;
  return speaksOfCode(profile.objective.value);
}
