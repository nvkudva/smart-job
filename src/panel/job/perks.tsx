import type { CompanyPerks } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PerksList({ perks }: { perks: CompanyPerks }) {
  if (perks.items.length === 0) return <p class="muted">No perks stated in the posting or found on the web.</p>;
  return (
    <div class="chips">
      {perks.items.map((item) => (
        <span class="chip">{item.text}</span>
      ))}
      {perks.sources.map((source) => (
        <a class="chip site" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
          {siteName(source.url)}
        </a>
      ))}
    </div>
  );
}

interface PerksSectionProps {
  perks: CompanyPerks | null;
  isLoading: boolean;
  error: string;
  onFind: () => void;
}

export function PerksSection({ perks, isLoading, error: rawError, onFind }: PerksSectionProps) {
  const error = aiContext.useCardError(rawError);
  return (
    <Card title="Perks" actions={perks && !isLoading ? <Button onClick={onFind}>Refresh</Button> : undefined}>
      {isLoading && (
        <p class="muted">
          <Spinner /> Looking up perks and benefits…
        </p>
      )}
      <ErrorNote message={error} onRetry={onFind} />
      {perks && !isLoading && <PerksList perks={perks} />}
      {!perks && !isLoading && !error && <Button onClick={onFind}>Find perks</Button>}
    </Card>
  );
}
