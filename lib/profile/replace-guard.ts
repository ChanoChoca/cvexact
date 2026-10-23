import { isMeaningfulExperience, type StoredProfile } from "@/lib/schemas/profile-v2";
import { describeJoin, type JoinCounts } from "./join";

/**
 * What to say before a profile is replaced by another.
 *
 * Four actions put one profile in the place of another with a single tap: «Recuperar una copia» reads a file —of the profile, or
 * the complete one— over what is here, "Subir" sends this browser's over the account's, and "Traerlo" does the
 * opposite. Each took the tap as the whole decision, and a wrong file or a forgotten device was a profile gone — with
 * nothing to get it back from, since the one that was replaced had never been written down anywhere. The first-run
 * screen already asked before uploading over a fuller account profile; these say the same, with numbers a person can
 * compare, and the copy of what is about to be replaced is taken before it is.
 *
 * Pure, so the words are tested; the screens do the asking and the downloading.
 */

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "5 puestos y 2 estudios, 1 proyecto": a profile as a person counts it, not as the schema lists it. */
export function describeProfile(profile: StoredProfile): string {
  const jobs = profile.experience.filter(isMeaningfulExperience).length;
  const studies = profile.education.filter((entry) => entry.institution.value.trim() || entry.degree.value.trim()).length;
  const projects = profile.projects.filter((project) => project.name.value.trim()).length;
  const parts = [
    jobs > 0 ? plural(jobs, "puesto", "puestos") : "",
    studies > 0 ? plural(studies, "estudio", "estudios") : "",
    projects > 0 ? plural(projects, "proyecto", "proyectos") : "",
  ].filter(Boolean);
  if (parts.length === 0) return "casi vacío";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Whether there is anything in a profile worth a copy before it goes: a profile with nothing in it replaces without asking. */
export function hasSubstance(profile: StoredProfile): boolean {
  return describeProfile(profile) !== "casi vacío" || profile.notes.length > 0 || profile.skills.length > 0;
}

/** «Recuperar una copia» of the profile: a file over the profile in this browser. */
export function importProfilePrompt(current: StoredProfile, incoming: StoredProfile): string {
  return (
    `Vas a reemplazar tu perfil actual (${describeProfile(current)}) por el del archivo (${describeProfile(incoming)}). ` +
    "Antes te bajamos una copia del actual, para que puedas recuperarlo con «Recuperar una copia». ¿Seguimos?"
  );
}

/** "Subir": this browser's profile over the one the account has. */
export function uploadReplacesPrompt(account: StoredProfile, local: StoredProfile): string {
  return (
    `Tu cuenta ya tiene un perfil guardado (${describeProfile(account)}). Subir el de este navegador (${describeProfile(local)}) lo reemplaza por completo. ` +
    "Antes te bajamos una copia del de tu cuenta, para que no se pierda. ¿Seguimos?"
  );
}

/** "Traerlo": the account's profile over the one in this browser. The same kind of tap, and the same words. */
export function pullReplacesPrompt(local: StoredProfile, account: StoredProfile): string {
  return (
    `Vas a reemplazar el perfil de este navegador (${describeProfile(local)}) por el de tu cuenta (${describeProfile(account)}). ` +
    "Antes te bajamos una copia del de este navegador, para que no se pierda. ¿Seguimos?"
  );
}

/**
 * «Juntar los dos»: what the account has from another device, added to what this browser has. Nothing is replaced here, but
 * the account's own is, by the upload that follows — which is why its copy is taken first, as in «Subir».
 */
export function joinPrompt(local: StoredProfile, account: StoredProfile, added: JoinCounts): string {
  const adds = describeJoin(added);
  return (
    `Tu cuenta tiene cambios hechos desde otro celular o computadora (${describeProfile(account)}) y este navegador tiene los suyos (${describeProfile(local)}). ` +
    (adds ? `Juntarlos agrega a este perfil lo que le falta de tu cuenta: ${adds}. ` : "Juntarlos no agrega nada: tu cuenta no tiene nada que a este navegador le falte. ") +
    "Si los dos cambiaron lo mismo, queda lo de este navegador, y lo que quitaste acá no vuelve. " +
    "Después subimos el resultado a tu cuenta, y antes te bajamos una copia del perfil que tiene, para que no se pierda. ¿Seguimos?"
  );
}

/** What this browser holds, or what an account does, as the two sides of a «Bajar de mi cuenta». The account may have no profile: only postings. */
export type Holdings = { profile: StoredProfile; applications: number };

/**
 * «Bajar de mi cuenta»: the account's postings in the place of this browser's, and its profile in the place of this browser's when it has one.
 * Said with both sides in numbers, as the other taps that replace one thing by another say them, because it replaced both with no copy of
 * what went — and said that it did.
 */
export function pullAccountPrompt(here: Holdings, account: { profile: StoredProfile | null; applications: number }): string {
  const apps = (count: number) => (count === 0 ? "sin postulaciones" : plural(count, "postulación", "postulaciones"));
  const copy =
    "Antes te bajamos una copia completa de lo actual, para que puedas recuperarlo con «Recuperar una copia». " +
    "Después te bajamos también un archivo con todo lo que tenemos tuyo. ¿Seguimos?";
  if (!account.profile) {
    return (
      `Vas a reemplazar las postulaciones de este navegador (${apps(here.applications)}) por las de tu cuenta (${apps(account.applications)}). ` +
      `Tu perfil (${describeProfile(here.profile)}) se queda como está: tu cuenta no tiene uno. ${copy}`
    );
  }
  return (
    `Vas a reemplazar todo lo de este navegador —tu perfil (${describeProfile(here.profile)}) y ${apps(here.applications)}— ` +
    `por lo que tiene tu cuenta: un perfil con ${describeProfile(account.profile)} y ${apps(account.applications)}. ${copy}`
  );
}

/** «Bajar de mi cuenta» into a browser with nothing in it: there is nothing to replace, and the question is only whether to bring it. */
export const PULL_ACCOUNT_INTO_NOTHING =
  "Esto trae a este navegador el perfil y las postulaciones de tu cuenta, y descarga un archivo con todo lo que tenemos tuyo. ¿Seguimos?";

/** «Recuperar una copia» of the whole thing: a copy over the profile and the applications in this browser. */
export function restoreBackupPrompt(here: { profile: StoredProfile; applications: number }, file: { profile: StoredProfile; applications: number }): string {
  const apps = (count: number) => (count === 0 ? "sin postulaciones" : plural(count, "postulación", "postulaciones"));
  return (
    `Vas a reemplazar todo lo de este navegador —tu perfil (${describeProfile(here.profile)}) y ${apps(here.applications)}— ` +
    `por lo que dice el archivo: un perfil con ${describeProfile(file.profile)} y ${apps(file.applications)}. ` +
    "Antes te bajamos una copia completa de lo actual, para que puedas recuperarlo con «Recuperar una copia». ¿Seguimos?"
  );
}
