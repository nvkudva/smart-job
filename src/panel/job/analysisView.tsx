import type { ComponentChildren } from "preact";
import type { JobAnalysis, MustHaveMet, Seniority } from "../../types.ts";
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

function BulletList({ title, items }: { title?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div class="block">
      {title && <h4>{title}</h4>}
      <ul>
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function MarkList({ title, items, verdictOf, extraClass = "" }: { title?: string; items: string[]; verdictOf: (item: string, index: number) => MustHaveMet; extraClass?: string }) {
  if (!items.length) return null;
  return (
    <div class={`block ${extraClass}`}>
      {title && <h4>{title}</h4>}
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

const seniorityNote: Record<Seniority, string> = { under: "level: below the role", match: "level: fits", over: "level: above the role" };

function evidenceLine(analysis: JobAnalysis): string {
  const met = analysis.mustHaveMet ?? [];
  if (!met.length) return "";
  const covered = met.filter((value) => value === "yes").length;
  const partly = met.filter((value) => value === "partial").length;
  return [`${covered} of ${met.length} must-haves${partly ? ` (+${partly} partly)` : ""}`, analysis.seniority && seniorityNote[analysis.seniority]].filter(Boolean).join(" · ");
}

function Fold({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <details class="fold">
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function Overview({ analysis }: { analysis: JobAnalysis }) {
  if (analysis.overview) {
    return (
      <>
        <BulletList title="Company" items={analysis.overview.company} />
        <BulletList title="Position" items={analysis.overview.position} />
      </>
    );
  }
  if (analysis.highlights) return <BulletList title="Highlights" items={analysis.highlights} />;
  return analysis.summary ? <p>{analysis.summary}</p> : null;
}

export function AnalysisView({ analysis }: { analysis: JobAnalysis }) {
  const matched = analysis.matchedSkills ?? [];
  const missing = analysis.missingSkills ?? [];
  const evidence = evidenceLine(analysis);
  const blockers = analysis.blockers ?? [];
  return (
    <Card title="Match">
      <div class="score-row">
        <ScoreRing score={analysis.matchScore} />
        <div>
          <div class="verdict">{analysis.verdict}</div>
          {analysis.reason && <div>{analysis.reason}</div>}
          {evidence && <div class="muted small">{evidence}</div>}
        </div>
      </div>
      <MarkList title="Dealbreakers" items={blockers} verdictOf={() => "no"} extraClass="blockers" />
      <BulletList title="Why apply" items={analysis.strengths} />
      <BulletList title="Watch out" items={analysis.gaps} />
      {analysis.mustHaveMet ? <MarkList title="Must have" items={analysis.mustHave} verdictOf={(_, index) => analysis.mustHaveMet?.[index] ?? "partial"} /> : <BulletList title="Must have" items={analysis.mustHave} />}
      <Fold title="Nice to have">
        {analysis.niceToHaveMet ? <MarkList items={analysis.niceToHave} verdictOf={(_, index) => analysis.niceToHaveMet?.[index] ?? "partial"} /> : <BulletList items={analysis.niceToHave} />}
      </Fold>
      <Fold title="About the role">
        <Overview analysis={analysis} />
      </Fold>
      <Fold title="Skills">
        <SkillsRow title="Matching" skills={matched} />
        <SkillsRow title="Missing" skills={missing} />
      </Fold>
    </Card>
  );
}
