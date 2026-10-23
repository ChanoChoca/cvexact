/**
 * What every question about the profile says, on the page of an application (U14): that it is about the profile and not about this CV, and what becomes of
 * the answer. The rounds are not one thing to look at —the job that may have ended, the line of the offer, the number the CV lacks—, and each draws its own
 * card; what they have in common is that none of them changes the CV in front of the person, and all of them are kept for the next one.
 *
 * It sits above the card and is not a frame around it: the cards have their own border, and a box in a box is two things to read.
 */
export const PROFILE_ASKS_SAVED = "Lo que contestes queda en tu perfil y sirve para las próximas postulaciones.";

export function ProfileAskHeading({ about }: { about?: string | undefined }) {
  return (
    <div className="space-y-1" data-profile-asks>
      <p className="font-solar text-[12.5px] font-bold tracking-[0.18em] text-oro uppercase">Para tu perfil</p>
      <p className="text-xs text-ink-3">{about ?? PROFILE_ASKS_SAVED}</p>
    </div>
  );
}
