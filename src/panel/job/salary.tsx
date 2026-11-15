import { useRef, useState } from "preact/hooks";
import * as salaryData from "../../ai/salary.ts";
import type { SalaryComponents, SalaryEstimate, SalaryRange } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";
import * as format from "../shared/format.ts";
import { Icon } from "../shared/icons.tsx";

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

// the sites' own scripts keep running, but they cannot navigate the panel itself
const viewerSandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

function SourceViewer({ source, onClose }: { source: Source; onClose: () => void }) {
  // the frame is cross-origin, so its history is unreadable; the panel's own history records the frame's navigations, and every load is one step
  const [depth, setDepth] = useState(0);
  const isGoingBack = useRef(false);
  const onLoad = () => {
    setDepth((current) => current + (isGoingBack.current ? -1 : 1));
    isGoingBack.current = false;
  };
  const goBack = () => {
    isGoingBack.current = true;
    history.back();
  };
  return (
    <div class="source-viewer" role="dialog" aria-label={source.title}>
      <div class="viewer-bar">
        <Button disabled={depth < 2} onClick={goBack} aria-label="Back" title="Back">
          <Icon name="Back" />
        </Button>
        <strong class="viewer-title" title={source.url}>
          {source.title.replace(salaryData.lookupPrefix, "")}
        </strong>
        <a class="btn primary" href={source.url} target="_blank" rel="noreferrer">
          Open in tab ↗
        </a>
        <Button onClick={onClose} aria-label="Close" title="Close">
          <Icon name="Close" />
        </Button>
      </div>
      <iframe class="viewer-frame" src={source.url} sandbox={viewerSandbox} referrerpolicy="no-referrer" title={source.title} onLoad={onLoad} />
    </div>
  );
}

function siteName(source: Source): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.title;
  }
}

function SiteChips({ sources, onOpen }: { sources: Source[]; onOpen: (source: Source) => void }) {
  const oneBySite = sources.filter((source, index) => sources.findIndex((other) => siteName(other) === siteName(source)) === index);
  return (
    <div class="chips">
      {oneBySite.map((source) => (
        <button type="button" class="chip site" title={source.title.replace(salaryData.lookupPrefix, "")} onClick={() => onOpen(source)}>
          {siteName(source)}
        </button>
      ))}
    </div>
  );
}

function SourceLinks({ title, sources, onOpen }: { title: string; sources: Source[]; onOpen: (source: Source) => void }) {
  if (sources.length === 0) return null;
  return (
    <div class="block">
      <h4>{title}</h4>
      <SiteChips sources={sources} onOpen={onOpen} />
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
  const [viewing, setViewing] = useState<Source | null>(null);
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
            {isWebBased ? <SiteChips sources={sources} onOpen={setViewing} /> : <span class={`badge basis-${salary.basis}`}>{basisLabel[salary.basis]}</span>}
          </div>
          {salary.posted && rangeText(salary.posted) && (
            <p class="muted">
              Listed in the job posting: <strong>{rangeText(salary.posted)}</strong>
            </p>
          )}
          {salary.components && <Breakdown components={salary.components} currency={salary.currency} />}
          {salary.note && <p class="muted">{salary.note}</p>}
          {!isWebBased && <SourceLinks title="Source" sources={sources} onOpen={setViewing} />}
          <SourceLinks title="Look up yourself" sources={lookups} onOpen={setViewing} />
        </div>
      )}
      {viewing && <SourceViewer source={viewing} onClose={() => setViewing(null)} />}
      {!salary && !isLoading && !error && <Button onClick={onEstimate}>Estimate salary</Button>}
    </Card>
  );
}
