import type { JobAnalysis, MustHaveMet } from "../../types.ts";
import { Card } from "../shared/controls.tsx";

function scoreTone(score: number): string {
  return score >= 70 ? "good" : score >= 45 ? "mid" : "bad";
}

function ScoreRing({ score }: { score: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <svg class={`ring ${scoreTone(clamped)}`} viewBox="0 0 80 80" role="img" aria-label={`Match score ${clamped} of 100`}>
      <circle cx="40" cy="40" r={radius} class="ring-track" />
      <circle cx="40" cy="40" r={radius} class="ring-value" stroke-dasharray={`${(circumference * clamped) / 100} ${circumference}`} transform="rotate(-90 40 40)" />
      <text x="40" y="46" text-anchor="middle" class="ring-text">
        {clamped}
      </text>
    </svg>
  );
}

const metMark: Record<MustHaveMet, string> = { yes: "✓", partial: "◐", no: "✗" };
const metLabel: Record<MustHaveMet, string> = { yes: "covered", partial: "partly covered", no: "not matched" };
const metClass: Record<MustHaveMet, string> = { yes: "ok", partial: "partial", no: "no" };

function isCovered(requirement: string, matchedSkills: string[]): boolean {
  const text = requirement.toLowerCase();
  return matchedSkills.some((skill) => text.includes(skill.toLowerCase()));
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div class="block">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function MarkList({ title, items, verdictOf }: { title: string; items: string[]; verdictOf: (item: string, index: number) => MustHaveMet }) {
  if (!items.length) return null;
  return (
    <div class="block">
      <h4>{title}</h4>
      <ul class="checklist">
        {items.map((item, index) => {
          const met = verdictOf(item, index);
          return (
            <li class={metClass[met]}>
              <span aria-label={metLabel[met]}>{metMark[met]}</span> {item}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SkillsRow({ title, skills }: { title: string; skills: string[] }) {
  if (!skills.length) return null;
  return (
    <div class="block">
      <h4>{title}</h4>
      <p>{skills.join(", ")}</p>
    </div>
  );
}

export function AnalysisView({ analysis }: { analysis: JobAnalysis }) {
  const matched = analysis.matchedSkills ?? [];
  return (
    <Card title="Match">
      <div class="score-row">
        <ScoreRing score={analysis.matchScore} />
        <div>
          <div class="verdict">{analysis.verdict}</div>
          <div class="muted">
            AI {analysis.matchScore} · Keywords {analysis.keywordScore}
          </div>
          <div class="bar">
            <span class={scoreTone(analysis.keywordScore)} style={{ width: `${analysis.keywordScore}%` }} />
          </div>
        </div>
      </div>
      {analysis.highlights ? <BulletList title="Highlights" items={analysis.highlights} /> : <p>{analysis.summary}</p>}
      <MarkList title="Must have" items={analysis.mustHave} verdictOf={(item, index) => analysis.mustHaveMet?.[index] ?? (isCovered(item, matched) ? "yes" : "no")} />
      <MarkList title="Nice to have" items={analysis.niceToHave} verdictOf={(item) => (isCovered(item, matched) ? "yes" : "no")} />
      <MarkList title="Strengths" items={analysis.strengths} verdictOf={() => "yes"} />
      <MarkList title="Gaps" items={analysis.gaps} verdictOf={() => "no"} />
      <SkillsRow title="Matching skills" skills={matched} />
      <SkillsRow title="Missing skills" skills={analysis.missingSkills ?? []} />
    </Card>
  );
}
