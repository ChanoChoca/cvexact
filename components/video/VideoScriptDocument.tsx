import {
  VIDEO_SCRIPT_LABEL_DEFAULTS,
  type VideoScript,
} from "@/lib/schemas/outputs";
import { formatClock, startTimes } from "@/lib/video/timeline";
import "./video-document.css";
// The script sheet reuses the CV's self-hosted @font-face declarations.
import "@/components/cv/cv-document.css";

export function VideoScriptDocument({ data }: { data: VideoScript }) {
  // Every fixed word on this sheet comes from the model, in the sheet's own
  // language. Scripts generated before that was true have no `labels`, and they
  // are read back from localStorage without revalidation, so each one falls
  // back to the Spanish the panel uses.
  const labels = { ...VIDEO_SCRIPT_LABEL_DEFAULTS, ...data.labels };
  const starts = startTimes(data.blocks);

  return (
    <article className="video-document" lang={data.language}>
      <h1 className="video-title">{data.jobTitle}</h1>
      {data.company ? <p className="video-subtitle">{data.company}</p> : null}
      <p className="video-meta">
        <span className="video-duration">
          {labels.duration}: {formatClock(data.totalSeconds)}
        </span>
        {labels.intro}
      </p>

      {data.blocks.map((block, index) => {
        // Not `!== "verbatim"`: scripts saved before outline blocks existed
        // come back from localStorage with no `mode`, and they are all
        // verbatim.
        const outline = block.mode === "outline";

        return (
          <section className="video-block" key={index}>
            <h2 className="video-block-heading">
              <span className="video-clock">
                {formatClock(starts[index] ?? 0)}–
                {formatClock((starts[index] ?? 0) + block.seconds)}
              </span>
              {block.topic}
            </h2>

            {outline ? <p className="video-label">{labels.outline}</p> : null}
            <p className={outline ? "video-outline" : "video-script"}>{block.script}</p>

            {block.keyPoints.length > 0 ? (
              <div className={outline ? "video-keypoints is-content" : "video-keypoints"}>
                <p className="video-label">{labels.keyPoints}</p>
                <ul>
                  {block.keyPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}

      {data.tips.length > 0 ? (
        <section className="video-block">
          <h2 className="video-block-heading">{labels.tips}</h2>
          <ul className="video-tips">
            {data.tips.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
