import { withCoveredGlyphs } from "@/lib/cv/fonts";
import {
  CV_LABEL_DEFAULTS,
  projectLinkLabel,
  type CVDocument as CVDocumentData,
  type CVEducationItem,
  type CVExperienceItem,
  type CVLink,
  type CVProjectItem,
} from "@/lib/schemas/cv";
import "./cv-document.css";

/**
 * Deterministic renderer for the CV template. The model supplies the data; this
 * file owns every layout decision, which is what keeps the format strict no
 * matter what the model returns.
 *
 * Empty strings and empty arrays are how the data says "omit this" — a job with
 * no bullets renders as a header alone, an education entry with no honors drops
 * the line, and a section absent from `sections` does not appear at all.
 */

function ContactLinks({ links }: { links: CVLink[] }) {
  return (
    <>
      {links.map((link, i) => (
        <span key={`${link.url}-${i}`}>
          {i > 0 ? " • " : null}
          <a href={link.url}>{link.label}</a>
        </span>
      ))}
    </>
  );
}

function ExperienceEntry({ item, onBulletClick }: { item: CVExperienceItem; onBulletClick?: (bulletIndex: number) => void }) {
  return (
    <div className="cv-entry">
      <div className="cv-entry-header">
        <div className="cv-entry-left">
          <p className="cv-org">{item.company}</p>
          {item.role ? <p className="cv-role">{item.role}</p> : null}
        </div>
        <div className="cv-entry-right">
          {item.location ? <p className="cv-location">{item.location}</p> : null}
          {item.dateRange ? <p className="cv-dates">{item.dateRange}</p> : null}
        </div>
      </div>
      {item.note ? <p className="cv-note">{item.note}</p> : null}
      {item.bullets.length > 0 ? (
        <ul className="cv-bullets">
          {item.bullets.map((bullet, i) =>
            onBulletClick ? (
              <li key={i}>
                <button type="button" className="cv-bullet-button" onClick={() => onBulletClick(i)}>
                  {bullet}
                </button>
              </li>
            ) : (
              <li key={i}>{bullet}</li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Bold name, then «: description» and the link — a project may have either, or neither. */
function ProjectEntry({ item }: { item: CVProjectItem }) {
  return (
    <p className="cv-project">
      <span className="cv-pair-label">{item.name}</span>
      {item.description ? `: ${item.description}` : null}
      {item.url ? (
        <>
          {item.description ? " • " : ": "}
          <a href={item.url}>{projectLinkLabel(item.url)}</a>
        </>
      ) : null}
    </p>
  );
}

function EducationEntry({
  item,
  honorsLabel,
}: {
  item: CVEducationItem;
  honorsLabel: string;
}) {
  return (
    <div className="cv-entry">
      <div className="cv-entry-header">
        <div className="cv-entry-left">
          <p className="cv-org">{item.institution}</p>
          {item.degree ? <p className="cv-role">{item.degree}</p> : null}
          {item.honors ? (
            <p className="cv-honors">
              <span className="cv-honors-label">{honorsLabel}: </span>
              {item.honors}
            </p>
          ) : null}
        </div>
        <div className="cv-entry-right">
          {item.location ? <p className="cv-location">{item.location}</p> : null}
          {item.date ? <p className="cv-dates">{item.date}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function CVDocument({
  data: source,
  onExperienceBulletClick,
}: {
  data: CVDocumentData;
  /**
   * Called with a line's position in the "experience" section — item index,
   * then bullet index — when it is clicked. Omitted everywhere but the
   * onboarding's own interactive preview: every other renderer (print, the
   * downloads, `/postular`'s preview) leaves this out and gets the exact same
   * plain `<li>` it always has.
   */
  onExperienceBulletClick?: (itemIndex: number, bulletIndex: number) => void;
}) {
  // Set in the glyphs the typography has, so the preview and the PDF agree and
  // the PDF's font check has nothing to refuse (see `withCoveredGlyphs`).
  const data = withCoveredGlyphs(source);
  const { header } = data;
  const contactParts = [header.location, header.phone, header.email].filter(Boolean);
  // Applications saved before `labels` existed come back from localStorage
  // unvalidated, so the schema's default cannot be relied on here.
  const honorsLabel = data.labels?.honors || CV_LABEL_DEFAULTS.honors;

  return (
    <article className="cv-document" lang={data.language}>
      <h1 className="cv-name">{header.fullName}</h1>

      <div className="cv-contact">
        <p className="cv-contact-line">
          {contactParts.map((part, i) => (
            <span key={i}>
              {i > 0 ? " • " : null}
              {part === header.email ? <a href={`mailto:${part}`}>{part}</a> : part}
            </span>
          ))}
        </p>
        {header.links.length > 0 ? (
          <p className="cv-contact-line">
            <ContactLinks links={header.links} />
          </p>
        ) : null}
      </div>

      {data.summary ? <p className="cv-summary">{data.summary}</p> : null}

      {data.sections.map((section, index) => (
        <section className="cv-section" key={`${section.kind}-${index}`}>
          <h2 className="cv-section-heading">{section.title}</h2>

          {section.kind === "experience"
            ? section.items.map((item, i) => (
                <ExperienceEntry
                  key={`${item.company}-${i}`}
                  item={item}
                  onBulletClick={onExperienceBulletClick ? (bulletIndex) => onExperienceBulletClick(i, bulletIndex) : undefined}
                />
              ))
            : null}

          {section.kind === "education"
            ? section.items.map((item, i) => (
                <EducationEntry
                  key={`${item.institution}-${i}`}
                  item={item}
                  honorsLabel={honorsLabel}
                />
              ))
            : null}

          {section.kind === "bullets" ? (
            <ul className="cv-bullets cv-section-bullets">
              {section.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          ) : null}

          {section.kind === "activities" ? (
            <ul className="cv-bullets cv-section-bullets">
              {section.items.map((item, i) => (
                <li key={i}>{item.text}</li>
              ))}
            </ul>
          ) : null}

          {section.kind === "pairs"
            ? section.items.map((item, i) => (
                <p className="cv-pair" key={`${item.label}-${i}`}>
                  <span className="cv-pair-label">{item.label}</span>
                  {item.value ? `: ${item.value}` : null}
                </p>
              ))
            : null}

          {section.kind === "projects"
            ? section.items.map((item, i) => <ProjectEntry key={`${item.name}-${i}`} item={item} />)
            : null}
        </section>
      ))}
    </article>
  );
}
