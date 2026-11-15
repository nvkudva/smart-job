import { useEffect, useRef, useState } from "preact/hooks";
import * as storage from "../../storage.ts";
import type { ProviderSettings, Settings } from "../../types.ts";
import { Button, Card, Check, Field } from "../shared/controls.tsx";
import { DataSection } from "./dataSection.tsx";
import { ProviderFields } from "./providerForm.tsx";
import * as aiContext from "../shared/aiContext.ts";
import { useStored } from "../shared/useStored.ts";

function AiStatus() {
  const status = aiContext.useStatus();
  return (
    <p class="muted small ai-status">
      <span class={`dot status-${status}`} /> {aiContext.statusLabel[status]}
    </p>
  );
}

const AUTOSAVE_DELAY_MS = 300;

/** Every edit is written after a short pause, so the provider the user touched last is always the stored main one. */
function AiSection({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState(initial);
  const [isSaved, setIsSaved] = useState(false);
  const lastSaved = useRef(JSON.stringify(initial));
  const change = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const setProvider = (patch: Partial<ProviderSettings>) => change({ provider: { ...draft.provider, ...patch } });

  useEffect(() => {
    const serialized = JSON.stringify(draft);
    if (serialized === lastSaved.current) return;
    setIsSaved(false);
    const timer = setTimeout(async () => {
      await storage.set("settings", draft);
      lastSaved.current = serialized;
      setIsSaved(true);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <div class="stack">
      <Card title="AI provider" actions={<span class="ok-text">{isSaved ? "Saved" : ""}</span>}>
        <AiStatus />
        <ProviderFields provider={draft.provider} onProvider={setProvider} />
      </Card>
      <Card title="Automation">
        <div class="stack tight">
          <Check label="Analyze jobs automatically" checked={draft.autoAnalyze} onChecked={(autoAnalyze) => change({ autoAnalyze })} />
          <Check label="Re-fill automatically when the page changes" checked={draft.autoFillOnPageChange} onChecked={(autoFillOnPageChange) => change({ autoFillOnPageChange })} />
          <Check label="Search the web for salary and perks data" checked={draft.salarySearch} onChecked={(salarySearch) => change({ salarySearch })} />
        </div>
      </Card>
      <Card title="Job-site account">
        <div class="stack tight">
          <p class="muted small">Used on sign-up / sign-in pages. Stored on this device only, never sent to the AI.</p>
          <div class="grid2">
            <Field label="Email" type="email" value={draft.account.email} onValue={(email) => change({ account: { ...draft.account, email } })} />
            <Field label="Password" type="password" value={draft.account.password} onValue={(password) => change({ account: { ...draft.account, password } })} />
          </div>
        </div>
      </Card>
    </div>
  );
}

export function SettingsTab() {
  const settings = useStored("settings");
  return (
    <div class="stack">
      {settings && <AiSection initial={settings} />}
      <h2 class="section-title">Data</h2>
      <DataTab />
    </div>
  );
}

function DataTab() {
  return (
    <div class="stack">
      <Card title="Setup">
        <div class="row between">
          <span class="muted">Walks through provider, profile and job searches. Existing data is kept.</span>
          <Button onClick={() => void storage.set("setupComplete", false)}>Run setup again</Button>
        </div>
      </Card>
      <DataSection />
    </div>
  );
}
