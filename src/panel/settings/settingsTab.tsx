import { useState } from "preact/hooks";
import * as storage from "../../storage.ts";
import type { ProviderSettings, Settings } from "../../types.ts";
import { Button, Card, Check, Field, SaveBar } from "../shared/controls.tsx";
import { DataSection } from "./dataSection.tsx";
import { ProviderFields } from "./providerForm.tsx";
import { useStored } from "../shared/useStored.ts";

function AiSection({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState(initial);
  const [isSaved, setIsSaved] = useState(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const change = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setIsSaved(false);
  };
  const setProvider = (patch: Partial<ProviderSettings>) => change({ provider: { ...draft.provider, ...patch } });
  const save = async () => {
    await storage.set("settings", draft);
    setIsSaved(true);
  };

  return (
    <div class="stack">
      <Card title="AI provider">
        <ProviderFields provider={draft.provider} onProvider={setProvider} />
      </Card>
      <Card title="Automation">
        <div class="stack tight">
          <Check label="Analyze jobs automatically" checked={draft.autoAnalyze} onChecked={(autoAnalyze) => change({ autoAnalyze })} />
          <Check label="Re-fill automatically when the page changes" checked={draft.autoFillOnPageChange} onChecked={(autoFillOnPageChange) => change({ autoFillOnPageChange })} />
          <Check label="Search the web for salary data" checked={draft.salarySearch} onChecked={(salarySearch) => change({ salarySearch })} />
        </div>
      </Card>
      <Card title="Job-site account">
        <div class="stack tight">
          <Field label="Email" type="email" value={draft.account.email} placeholder="Used on sign-up / sign-in pages" onValue={(email) => change({ account: { ...draft.account, email } })} />
          <Field label="Password" type="password" value={draft.account.password} placeholder="Stored on this device only, never sent to the AI" onValue={(password) => change({ account: { ...draft.account, password } })} />
        </div>
      </Card>
      <SaveBar isDirty={isDirty} isSaved={isSaved} label="Save settings" onSave={() => void save()} />
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
        <div class="actions">
          <Button onClick={() => void storage.set("setupComplete", false)}>Run setup again</Button>
          <span class="muted small">Walks through provider, profile and job searches. Existing data is kept.</span>
        </div>
      </Card>
      <DataSection />
    </div>
  );
}
