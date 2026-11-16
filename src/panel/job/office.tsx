import type { CompanyOffice } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function OfficeList({ office, company }: { office: CompanyOffice; company: string }) {
  if (office.addresses.length === 0) {
    return <p class="muted">No office address found{office.city ? ` for ${office.city}` : ""} on the web. Check that “Search the web for salary and perks data” is on in Settings.</p>;
  }
  return (
    <div class="stack tight">
      <p class="muted small">
        {office.match === "likely"
          ? `No ${company} office found${office.city ? ` in ${office.city}` : ""} — most probable office:`
          : `${company} office${office.addresses.length > 1 ? "s" : ""}${office.city ? ` in ${office.city}` : ""}:`}
      </p>
      {office.addresses.map((address) => (
        <p key={address}>{address}</p>
      ))}
      {!!office.sources.length && (
        <div class="chips">
          {office.sources.map((source) => (
            <a class="chip site" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
              {siteName(source.url)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface OfficeSectionProps {
  office: CompanyOffice | null;
  company: string;
  isLoading: boolean;
  error: string;
  onFind: () => void;
}

export function OfficeSection({ office, company, isLoading, error: rawError, onFind }: OfficeSectionProps) {
  const error = aiContext.useCardError(rawError);
  return (
    <Card title="Office" actions={office && !isLoading ? <Button onClick={onFind}>Refresh</Button> : undefined}>
      {isLoading && (
        <p class="muted">
          <Spinner /> Looking up the office for this job's city…
        </p>
      )}
      <ErrorNote message={error} onRetry={onFind} />
      {office && !isLoading && <OfficeList office={office} company={company} />}
      {!office && !isLoading && !error && <Button onClick={onFind}>Find office</Button>}
    </Card>
  );
}
