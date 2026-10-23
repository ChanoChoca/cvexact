import { READ } from "@/lib/legal/data-flow";
import type { ProviderEntry } from "@/lib/storage/local";

/**
 * What Google says of the free tier of its Gemini API, and what this product says of it before someone turns it on (e5, O6).
 *
 * The product teaches how to get a Google key — the free one, in two minutes, with no card — and for most people that key is the AI. Its
 * terms say three things that nobody who is about to paste it has been told: what is sent to the free tier is used by Google to improve its
 * products and can be read by people there; Google asks that nothing sensitive, confidential or personal be sent to it; and the API is for
 * people of 18 or older. A person who finds that out afterwards has been led to it by us, so they are said here, before the key is made,
 * with the way out of each: a key of the paid tier, another provider, or going on without a model.
 *
 * Each sentence the screens say is kept beside the sentence of the terms it is said from, in Google's own words: this file is what to
 * check against the page when the terms change (`GOOGLE_TERMS_URL`), and `tests/google-terms.test.ts` holds the screens to it. Read
 * on 2026-10-07 at https://ai.google.dev/gemini-api/terms (in force from 23 March 2026) and at
 * https://ai.google.dev/gemini-api/docs/billing for the way to the paid tier. None of it is legal advice, and none of it says what the
 * law says: it says what Google says it does, and where to read it.
 *
 * The policy says the same sentences, because it renders them (`app/legales/privacidad/page.tsx`, clause 5): changing one here changes the
 * policy, and a change of what the policy says is a change that may ask for a new version (`docs/legal/versiones.md`).
 */

export const GOOGLE_TERMS_URL = "https://ai.google.dev/gemini-api/terms";
export const GOOGLE_BILLING_URL = "https://ai.google.dev/gemini-api/docs/billing";

/** From when the terms that were read are in force, as the page says it, and the day they were read. */
export const GOOGLE_TERMS_IN_FORCE = "23 de marzo de 2026";
export const GOOGLE_TERMS_READ_ON = "2026-10-07";
/** The same day, as the policy says it. */
export const GOOGLE_TERMS_READ_ON_TEXT = "7 de octubre de 2026";

/** What the free tier is, in the terms' words. */
export const GOOGLE_UNPAID_DEFINITION =
  "Any Services that are offered free of charge like direct interactions with Google AI Studio or unpaid quota in Gemini API are unpaid Services (the \"Unpaid Services\").";

/**
 * What the screens say of the free tier, each with the sentence it comes from. The order is the order they are read in.
 */
export const GOOGLE_FREE_FACTS = [
  {
    id: "used",
    says: "Lo que le mandás, Google lo usa para mejorar sus productos.",
    from: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies, including Google's enterprise features, products, and services.",
  },
  {
    id: "read",
    says: "Personas de Google pueden leerlo.",
    from: "To help with quality and improve our products, human reviewers may read, annotate, and process your API input and output.",
  },
  {
    id: "personal",
    says: "Google pide no mandar ahí información sensible, confidencial ni personal.",
    from: "Do not submit sensitive, confidential, or personal information to the Unpaid Services.",
  },
  {
    id: "adults",
    says: "Para usar su API hay que tener 18 años o más.",
    from: "You must be 18 years of age or older to use the APIs.",
  },
] as const;

/** What follows from the last of them, for whoever is not yet of age: that nothing here needs the key. */
export const UNDER_EIGHTEEN = "Si todavía no los tenés, no actives esta key: tu perfil y tu CV base funcionan sin IA.";

/** What the paid tier changes, and where the terms say it. */
export const GOOGLE_PAID_FACTS = [
  {
    id: "not-used",
    says: "Google dice que no usa lo que mandás para mejorar sus productos.",
    from: "Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products.",
  },
  {
    id: "logged",
    says: "Guarda lo que le mandás un tiempo limitado, solo para detectar usos prohibidos.",
    from: "Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy.",
  },
] as const;

/** Said in a line of its own, because it is true of those who live there and not of everyone. */
export const GOOGLE_EUROPE = {
  says: "Si estás en el Espacio Económico Europeo, Suiza o el Reino Unido, Google trata también al nivel gratuito como al pago.",
  from: "If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under \"How Google uses Your Data\" in \"Paid Services\" apply to all Services, including Google AI Studio and unpaid quota in the Gemini API, even though they are offered free of charge.",
} as const;

/**
 * How a free project of Google AI Studio becomes a paid one, as its documentation says. The sentence that goes in front of the steps is
 * not Google's: that it asks for a card is, and that it is paid by use.
 */
export const GOOGLE_PAID_STEPS = [
  { title: "Abrí Google AI Studio", body: "Entrás con tu cuenta de Google." },
  { title: "Tocá «Set up billing»", body: "Está en la página de las keys, en el proyecto de tu key, bajo el nivel. Elegís o creás una cuenta de facturación y cargás un medio de pago: pide una tarjeta, y Google cobra por lo que usás." },
  { title: "Copiá la key de ese proyecto", body: "Es la misma que ya tenés, o una nueva: lo que cambia es el nivel del proyecto." },
] as const;

/** What the product does before it sends a text to be read, and what it cannot: said with the facts above, because it is what the facts are about. */
export const WHAT_WE_DO = {
  /** The sentence the data-flow facts say of a reading (`lib/legal/data-flow.ts`), so that the notice and the policy are one. */
  masked: READ.masked,
  travels: "Lo que contás de tu experiencia sí viaja —es lo que se lee—, y una foto de un CV va entera, con todo lo que se ve.",
} as const;

/** What works with no model at all. */
export const WITHOUT_AI = {
  works: "Sin IA podés armar tu perfil, contestar las preguntas y bajar tu CV base en Word y en PDF.",
  needs: "Adaptar el CV a un aviso, las respuestas del formulario, el email de presentación, la preparación de la entrevista y el guion del video necesitan IA.",
} as const;

/** Whether one of the keys the person has is Google's. The tier of a key cannot be known from here: it is the person who knows which they made. */
export const hasGoogleKey = (entries: ReadonlyArray<Pick<ProviderEntry, "provider" | "apiKey">>): boolean =>
  entries.some((entry) => entry.provider === "google" && entry.apiKey.trim() !== "");
