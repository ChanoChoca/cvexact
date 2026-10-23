import type { EvidenceKind } from "@/lib/profile/evidence";

/**
 * The official registers where a person can look themselves up (e5, O14): the one for university degrees, the one for health professionals and the
 * lists that each gas distributor keeps of the installers it has registered. The app opens the register's own page in another tab and nothing else:
 * no address of ours goes with it, nothing of the profile is put in it, and nothing is asked of the register. The person looks, comes back, and says
 * what they saw — and that, with the day, is what is kept (`type: "registry"`, `lib/profile/evidence.ts`).
 *
 * The addresses change — it is the part of this that costs, and the one the report (E2, «las URL cambian») warns of — so each says the day it was last
 * opened and read (`verifiedOn`), and `docs/registros-oficiales.md` says how to read them again. A register that cannot be checked is not here: a link
 * to a page nobody has seen would be a promise nobody kept.
 */

export type RegistryId =
  | "graduados"
  | "refeps"
  | "gas-camuzzi"
  | "gas-metrogas"
  | "gas-naturgy-ban"
  | "gas-naturgy-noa"
  | "gas-litoral"
  | "gas-ecogas";

export type RegistryGroup = "estudios" | "salud" | "gas";

export type Registry = {
  id: RegistryId;
  name: string;
  group: RegistryGroup;
  /** Which things it can show: a study, or a certification. */
  shows: readonly EvidenceKind[];
  /** The page it opens at: `https`, with nothing after the path, so that nothing of ours goes with it. */
  url: string;
  /** What the person does there, in a sentence. */
  how: string;
  /** Who it covers — said so that not being in it is not read as not being true. */
  covers: string;
  /** For the register of degrees: the first year of the diplomas it holds. A study that ended before is not in it, and that says nothing. */
  fromYear?: number;
  /** The day the page was opened and read, as `YYYY-MM-DD`. */
  verifiedOn: string;
};

const VERIFIED = "2026-10-07";

export const REGISTRIES: readonly Registry[] = [
  {
    id: "graduados",
    name: "Registro Público de Graduados Universitarios",
    group: "estudios",
    shows: ["education"],
    url: "https://registrograduados.siu.edu.ar/",
    how: "Buscá por tipo y número de documento, o por apellido y nombre.",
    covers: "Diplomas intervenidos desde 2012 y títulos extranjeros convalidados desde 2010: uno anterior no figura, y eso no dice nada de él.",
    fromYear: 2012,
    verifiedOn: VERIFIED,
  },
  {
    id: "refeps",
    name: "REFEPS, Red Federal de Registros de Profesionales de la Salud",
    group: "salud",
    shows: ["certification"],
    url: "https://sisa.msal.gov.ar/",
    how: "Entrá a «Buscador de Establecimientos y profesionales», elegí la pestaña REFEPS y buscá por documento, matrícula o apellido y nombre.",
    covers: "Lo que informa cada jurisdicción: si no aparecés, no quiere decir que no tengas la matrícula.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-camuzzi",
    name: "Camuzzi Gas Pampeana y Camuzzi Gas del Sur",
    group: "gas",
    shows: ["certification"],
    url: "https://www.camuzzigas.com/guia-de-tramites/gasistas-matriculados/",
    how: "Elegí la provincia, la localidad y la categoría.",
    covers: "Gran parte de Buenos Aires, La Pampa, Neuquén, Río Negro, Chubut, Santa Cruz y Tierra del Fuego. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-metrogas",
    name: "MetroGAS",
    group: "gas",
    shows: ["certification"],
    url: "https://www.metrogas.com.ar/colaboradores/listado-de-gasistas-con-matricula/",
    how: "Usá el buscador «Buscá tu gasista con matrícula».",
    covers: "La Ciudad de Buenos Aires y parte del Gran Buenos Aires. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-naturgy-ban",
    name: "Naturgy BAN",
    group: "gas",
    shows: ["certification"],
    url: "https://apps.naturgy.com.ar/Matriculados/Jsp/Nomina.jsp",
    how: "Elegí el partido en «Seleccione el Partido a consultar».",
    covers: "La zona de Buenos Aires que atiende Naturgy BAN. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-naturgy-noa",
    name: "Naturgy NOA",
    group: "gas",
    shows: ["certification"],
    url: "https://www.naturgynoa.com.ar/instaladores",
    how: "Filtrá por provincia, localidad y categoría.",
    covers: "Jujuy, Salta, Santiago del Estero y Tucumán. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-litoral",
    name: "Litoral Gas",
    group: "gas",
    shows: ["certification"],
    url: "https://www.litoralgas.com.ar/site/hogares-y-comercios/info-y-tramites/listado-de-gasistas-y-profesionales/",
    how: "Elegí la localidad y la categoría (M1, M2 o M3).",
    covers: "Santa Fe y el norte de la provincia de Buenos Aires. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
  {
    id: "gas-ecogas",
    name: "Ecogas",
    group: "gas",
    shows: ["certification"],
    url: "https://www.ecogas.com.ar/hogares-comercios/tramites-y-servicios/listado-de-gasistas-matriculados",
    how: "Elegí la provincia, la ciudad y la categoría, o buscá por nombre.",
    covers: "Córdoba, La Rioja, Catamarca, Mendoza, San Juan y San Luis. Cada distribuidora tiene su propia lista.",
    verifiedOn: VERIFIED,
  },
];

/** The words for each group, wherever the registers are listed. */
export const REGISTRY_GROUP_LABEL: Record<RegistryGroup, string> = {
  estudios: "Estudios",
  salud: "Salud",
  gas: "Gas: la lista de tu distribuidora",
};

export const registryById = (id: string | undefined): Registry | undefined => REGISTRIES.find((registry) => registry.id === id);

/** The registers that can show a kind of thing, in the order they are listed. */
export const registriesFor = (kind: EvidenceKind): Registry[] => REGISTRIES.filter((registry) => registry.shows.includes(kind));

/**
 * Whether a study can be in the register of degrees: not one that ended before the first year it holds. `undefined` when it cannot be said — a study
 * with no year is not one the register is known to lack.
 */
export function mayBeIn(registry: Registry, endedIn: number | undefined): boolean | undefined {
  if (registry.fromYear === undefined || endedIn === undefined) return undefined;
  return endedIn >= registry.fromYear;
}
