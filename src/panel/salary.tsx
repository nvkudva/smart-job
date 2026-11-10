import type { SalaryEstimate } from "../types.ts";
import { Button, Card, ErrorNote, Spinner } from "./controls.tsx";

const basisLabel: Record<SalaryEstimate["basis"], string> = { posted: "Posted", web: "Web data", estimate: "Estimate" };
const periodLabel: Record<string, string> = { year: "/yr", month: "/mo", hour: "/hr", "": "" };

export function formatSalary(salary: SalaryEstimate | null): string {
  if (!salary || (salary.min === null && salary.max === null)) return "";
  const format = (amount: number) => amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const range = salary.min !== null && salary.max !== null && salary.min !== salary.max ? `${format(salary.min)} – ${format(salary.max)}` : format((salary.min ?? salary.max)!);
  return `${salary.currency} ${range}${periodLabel[salary.period] ?? ""}`.trim();
}

interface SalarySectionProps {
  salary: SalaryEstimate | null;
  isLoading: boolean;
  error: string;
  onEstimate: () => void;
}

export function SalarySection({ salary, isLoading, error, onEstimate }: SalarySectionProps) {
  const range = formatSalary(salary);
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
            <span class={`badge basis-${salary.basis}`}>{basisLabel[salary.basis]}</span>
          </div>
          {salary.note && <p class="muted">{salary.note}</p>}
          <div class="links">
            {salary.sources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>
            ))}
          </div>
        </div>
      )}
      {!salary && !isLoading && !error && <Button onClick={onEstimate}>Estimate salary</Button>}
    </Card>
  );
}
