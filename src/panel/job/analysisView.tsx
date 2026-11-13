import type { JobAnalysis, MustHaveMet } from "../../types.ts";
import { Card, Chips } from "../shared/controls.tsx";

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
      <p>{analysis.summary}</p>
      {analysis.mustHave.length > 0 && (
        <div class="block">
          <h4>Must have</h4>
          <ul class="checklist">
            {analysis.mustHave.map((item, index) => {
              const met = analysis.mustHaveMet?.[index] ?? (isCovered(item, matched) ? "yes" : "no");
              return (
                <li class={metClass[met]}>
                  <span aria-label={metLabel[met]}>{metMark[met]}</span> {item}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <BulletList title="Nice to have" items={analysis.niceToHave} />
      <BulletList title="Strengths" items={analysis.strengths} />
      <BulletList title="Gaps" items={analysis.gaps} />
      {(analysis.missingSkills ?? []).length > 0 && (
        <div class="block">
          <h4>Missing skills</h4>
          <Chips items={analysis.missingSkills} kind="warn" />
        </div>
      )}
    </Card>
  );
}
