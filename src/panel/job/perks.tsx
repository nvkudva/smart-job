import * as perksData from "../../ai/perks.ts";
import type { CompanyPerks } from "../../types.ts";
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
    <>
      {perksData.categories.map((category) => {
        const items = perks.items.filter((item) => item.category === category);
        if (items.length === 0) return null;
        return (
          <div class="block">
            <h4>{category}</h4>
            <ul class="checklist">
              {items.map((item) => (
                <li class="ok">
                  <span>✓</span> {item.text}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {perks.sources.length > 0 && (
        <div class="block">
          <h4>Sources</h4>
          <div class="chips">
            {perks.sources.map((source) => (
              <a class="chip site" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                {siteName(source.url)}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

interface PerksSectionProps {
  perks: CompanyPerks | null;
  isLoading: boolean;
  error: string;
  onFind: () => void;
}

export function PerksSection({ perks, isLoading, error, onFind }: PerksSectionProps) {
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
