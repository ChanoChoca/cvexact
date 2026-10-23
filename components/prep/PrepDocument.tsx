import { INTERVIEW_LABEL_DEFAULTS, type InterviewPrep } from "@/lib/schemas/outputs";
import "./prep-document.css";
// The prep sheet reuses the CV's self-hosted @font-face declarations.
import "@/components/cv/cv-document.css";

export function PrepDocument({ data }: { data: InterviewPrep }) {
  // Every fixed word on this sheet comes from the model, in the sheet's own
  // language. Sheets generated before that was true have no `labels`, and they
  // are read back from localStorage without revalidation, so each one falls
  // back to the Spanish it used to be hardcoded as.
  const labels = { ...INTERVIEW_LABEL_DEFAULTS, ...data.labels };

  return (
    <article className="prep-document" lang={data.language}>
      <h1 className="prep-title">{data.jobTitle}</h1>
      {data.company ? <p className="prep-subtitle">{data.company}</p> : null}
      <p className="prep-meta">{labels.intro}</p>

      {data.sections.map((section, sectionIndex) => (
        <section className="prep-section" key={`${section.category}-${sectionIndex}`}>
          <h2 className="prep-section-heading">{section.category}</h2>

          {section.questions.map((entry, index) => (
            <div className="prep-qa" key={index}>
              <p className="prep-question">{entry.question}</p>
              <p className="prep-answer">{entry.answer}</p>

              {entry.keyPoints.length > 0 ? (
                <div className="prep-keypoints">
                  <p className="prep-label">{labels.keyPoints}</p>
                  <ul>
                    {entry.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.followUps.length > 0 ? (
                <div className="prep-followups">
                  <p className="prep-label">{labels.followUps}</p>
                  <ul>
                    {entry.followUps.map((followUp, i) => (
                      <li key={i}>{followUp}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ))}

      {data.questionsToAsk.length > 0 ? (
        <section className="prep-section">
          <h2 className="prep-section-heading">{labels.questionsToAsk}</h2>
          <ul className="prep-ask">
            {data.questionsToAsk.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
