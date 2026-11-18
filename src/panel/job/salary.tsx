import * as salaryData from "../../ai/salary.ts";
import type { SalaryComponents, SalaryEstimate, SalaryRange } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";
import * as format from "../shared/format.ts";

const basisLabel: Record<SalaryEstimate["basis"], string> = { posted: "Posted", web: "Web data", estimate: "Estimate" };
const periodLabel: Record<string, string> = { year: "/yr", month: "/mo", hour: "/hr", "": "" };

type Figure = Pick<SalaryEstimate, "min" | "max" | "currency" | "period">;

function rangeText(figure: Figure): string {
  if (figure.min === null && figure.max === null) return "";
  return `${format.moneyRange(figure.min, figure.max, figure.currency)}${periodLabel[figure.period] ?? ""}`;
}

/** The listing's own figure when it has one, else the estimate; what the tracker shows. */
export function formatSalary(salary: SalaryEstimate | null): string {
  return salary ? rangeText(salary.posted ?? salary) : "";
}

function headline(salary: SalaryEstimate): string {
  const range = rangeText(salary);
  return salary.components && range ? `Total ~${format.moneyRange(salary.components.total.min, salary.components.total.max, salary.currency)} / yr` : range;
}

function Breakdown({ components, currency }: { components: SalaryComponents; currency: string }) {
  const rows: [string, SalaryRange | null][] = [
    ["Base", components.base],
    ["Bonus", components.bonus],
    ["Stock (per yr)", components.stock],
    ["Total per year", components.total],
  ];
  return (
    <dl class="salary-breakdown">
      {rows.map(([label, range]) =>
        range ? (
          <div class={label === "Total per year" ? "salary-total" : undefined}>
            <dt>{label}</dt>
            <dd>{format.moneyRange(range.min, range.max, currency)}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

type Source = SalaryEstimate["sources"][number];

function siteName(source: Source): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.title;
  }
}

function SiteChips({ sources }: { sources: Source[] }) {
  const oneBySite = sources.filter((source, index) => sources.findIndex((other) => siteName(other) === siteName(source)) === index);
  return (
    <div class="chips">
      {oneBySite.map((source) => (
        <a class="chip site" href={source.url} target="_blank" rel="noreferrer" title={source.title.replace(salaryData.lookupPrefix, "")}>
          {siteName(source)} ↗
        </a>
      ))}
    </div>
  );
}

function SourceLinks({ title, sources }: { title: string; sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <div class="block">
      <h4>{title}</h4>
      <SiteChips sources={sources} />
    </div>
  );
}

interface SalarySectionProps {
  salary: SalaryEstimate | null;
  isLoading: boolean;
  error: string;
  onEstimate: () => void;
}

export function SalarySection({ salary, isLoading, error: rawError, onEstimate }: SalarySectionProps) {
  const error = aiContext.useCardError(rawError);
  const range = salary ? headline(salary) : "";
  const sources = (salary?.sources ?? []).filter((source) => !salaryData.isLookup(source));
  const isWebBased = salary?.basis === "web" && sources.length > 0;
  const lookups = (salary?.sources ?? []).filter(salaryData.isLookup);
  return (
    <Card title="Salary" actions={salary && !isLoading ? <Button onClick={onEstimate}>Refresh</Button> : undefined}>
      {isLoading && (
        <p class="muted">
          <Spinner /> Looking up salary data…
        </p>
      )}
      <ErrorNote message={error} onRetry={onEstimate} />
      {salary && !isLoading && (
        <div>
          <div class="salary-range">
            <strong>{range || "No figures found"}</strong>
            {isWebBased ? <SiteChips sources={sources} /> : <span class={`badge basis-${salary.basis}`}>{basisLabel[salary.basis]}</span>}
          </div>
          {salary.posted && rangeText(salary.posted) && rangeText(salary.posted) !== range && (
            <p class="muted">
              Listed in the job posting: <strong>{rangeText(salary.posted)}</strong>
            </p>
          )}
          {salary.components && <Breakdown components={salary.components} currency={salary.currency} />}
          {salary.note && <p class="muted">{salary.note}</p>}
          {!isWebBased && <SourceLinks title="Source" sources={sources} />}
          <SourceLinks title="Look up yourself" sources={lookups} />
        </div>
      )}
      {!salary && !isLoading && !error && <Button onClick={onEstimate}>Estimate salary</Button>}
    </Card>
  );
}
