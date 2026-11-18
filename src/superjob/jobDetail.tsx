import { useMemo } from "preact/hooks";
import * as skills from "../ai/skills.ts";
import * as tasks from "../ai/tasks.ts";
import { ScoreRing } from "../panel/job/analysisView.tsx";
import { useStored } from "../panel/shared/useStored.ts";
import type { JobPosting, Profile } from "../types.ts";
import * as format from "./descriptionFormat.ts";
import { Logo, PortalIcon, StarIcon, scoreFor } from "./jobList.tsx";
import type { FoundJob } from "./jobSources.ts";
import * as posting from "./posting.ts";
import * as facts from "./postingFacts.ts";

interface SkillMatch {
  matched: string[];
  missing: string[];
  terms: format.Term[];
}

/** Keyword overlap with the profile; null without any profile skills or resume, since then everything would read as missing. */
function skillMatch(description: string, profile: Profile | undefined, resumeText: string): SkillMatch | null {
  if (!profile || (!profile.skills.length && !resumeText.trim())) return null;
  const result = tasks.keywordMatch(description, { profile, resumeText });
  // bare acronyms (CTC, PF, WFH) are too noisy to call missing; only dictionary skills are
  const missing = result.missing.filter(skills.isKnown);
  const terms: format.Term[] = [
    ...result.matched.map((name) => ({ pattern: skills.finder(name), tone: "match" as const })),
    ...missing.map((name) => ({ pattern: skills.finder(name), tone: "miss" as const })),
  ];
  return { matched: result.matched, missing, terms };
}

function Rich({ text, terms }: { text: string; terms: format.Term[] }) {
  return (
    <>
      {format.highlight(text, terms).map((segment) => (segment.tone ? <strong class={`sj-hl ${segment.tone}`}>{segment.text}</strong> : segment.text))}
    </>
  );
}

/** "Databases: PostgreSQL, MySQL" reads better with the label in bold. */
function BulletItem({ text, terms }: { text: string; terms: format.Term[] }) {
  const lead = /^([^:]{2,40}):\s+(.+)$/.exec(text);
  if (!lead) return <Rich text={text} terms={terms} />;
  return (
    <>
      <strong>{lead[1]}:</strong> <Rich text={lead[2]!} terms={terms} />
    </>
  );
}

function Description({ text, terms }: { text: string; terms: format.Term[] }) {
  const blocks = useMemo(() => format.blocks(text), [text]);
  return (
    <div class="sj-desc">
      {blocks.map((block) => {
        if (block.kind === "heading") return <h3>{block.text}</h3>;
        if (block.kind === "field") {
          return (
            <p class="sj-desc-field">
              <span>{block.label}:</span> <Rich text={block.text} terms={terms} />
            </p>
          );
        }
        if (block.kind === "tags") {
          return (
            <ul class="sj-tags">
              {block.items.map((item) => {
                const tone = terms.find((term) => format.highlight(item, [term]).some((segment) => segment.tone))?.tone;
                return <li class={tone ?? ""}>{item}</li>;
              })}
            </ul>
          );
        }
        if (block.kind === "bullets") {
          return (
            <ul class="sj-bullets">
              {block.items.map((item) => (
                <li>
                  <BulletItem text={item} terms={terms} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p>
            <Rich text={block.text} terms={terms} />
          </p>
        );
      })}
    </div>
  );
}

const fitNote: Record<facts.Fit, (years: number) => string> = {
  fits: (years) => `✓ fits your ${years} yrs`,
  under: (years) => `you have ${years}`,
  over: (years) => `you have ${years}`,
  "": () => "",
};

function HeaderFacts({ job, loaded, description, profile }: { job: FoundJob; loaded?: JobPosting; description: string; profile: Profile | undefined }) {
  const location = loaded?.location || job.location;
  const years = (job.experience && facts.parseYears(job.experience)) || facts.yearsFromDescription(description);
  const candidateYears = profile?.yearsExperience ?? 0;
  const fit = years ? facts.fit(years, candidateYears) : "";
  return (
    <ul class="sj-facts sj-facts-head" aria-label="Location and experience">
      {location && <li>{location}</li>}
      {years && (
        <li class={`sj-fact-years fit-${fit || "none"}`} title={job.experience ? "Experience on the listing" : "Experience read from the description"}>
          {facts.formatYears(years)}
          {fit && <span class="sj-fit"> · {fitNote[fit](candidateYears)}</span>}
        </li>
      )}
    </ul>
  );
}

function Facts({ job, loaded, description }: { job: FoundJob; loaded?: JobPosting; description: string }) {
  const location = loaded?.location || job.location;
  const salary = loaded?.salaryText || job.salary;
  const types = facts.jobTypes(`${job.title} ${location} ${loaded?.employmentType ?? ""}`, description);
  return (
    <ul class="sj-facts" aria-label="Job facts">
      {types.map((type) => (
        <li class={`sj-type type-${type.toLowerCase()}`}>{type}</li>
      ))}
      {salary && <li class="sj-fact-salary">{salary}</li>}
      {job.posted && <li class={`sj-fact-posted fresh-${facts.freshness(job.posted) || "none"}`}>Posted {job.posted}</li>}
    </ul>
  );
}

export function JobDetail({ job, loaded }: { job: FoundJob; loaded?: JobPosting }) {
  const profile = useStored("profile");
  const resume = useStored("resume");
  const analyses = useStored("analyses");
  const tracked = useStored("jobs");
  const description = loaded?.description || job.snippet;
  const match = useMemo(() => skillMatch(description, profile, resume?.text ?? ""), [description, profile, resume]);
  const id = loaded?.id ?? posting.idFor(job);
  const stored = { analyses: analyses ?? {}, tracked: tracked ?? {} };
  const score = scoreFor(id, stored);
  return (
    <article class="sj-detail-pane">
      <div class="sj-detail-head">
        <Logo job={job} size="detail" />
        <div class="sj-detail-title">
          <span class="sj-source">
            <PortalIcon name={job.source} />
            {job.source}
          </span>
          <h2>{loaded?.title || job.title}</h2>
          <p class="sj-detail-company">
            {job.company}
            {id in stored.tracked && (
              <span class="sj-saved-tag">
                <StarIcon /> Saved
              </span>
            )}
          </p>
          <HeaderFacts job={job} loaded={loaded} description={description} profile={profile} />
        </div>
        <div class="sj-detail-actions">
          {score !== null && <ScoreRing score={score} />}
          <a class="btn primary" href={job.url} target="_blank" rel="noreferrer">
            Open listing ↗
          </a>
        </div>
      </div>
      <div class="sj-detail-body">
        <Facts job={job} loaded={loaded} description={description} />
        {description ? <Description text={description} terms={loaded ? (match?.terms ?? []) : []} /> : <p class="muted">Loading full job description…</p>}
        {!loaded && description && <p class="muted small sj-loading-note">Loading the full description…</p>}
      </div>
    </article>
  );
}
