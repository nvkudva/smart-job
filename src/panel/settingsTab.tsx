import { useState } from "preact/hooks";
import * as llm from "../ai/llm.ts";
import * as storage from "../storage.ts";
import type { ProviderSettings, Settings } from "../types.ts";
import * as aiContext from "./aiContext.ts";
import { Button, Card, Check, Choice, ErrorNote, Field } from "./controls.tsx";
import { DataSection } from "./dataSection.tsx";
import { ProfileEditor } from "./profileEditor.tsx";
import { ResumeSection } from "./resumeSection.tsx";
import { useStored } from "./useStored.ts";
import { useTask } from "./useTask.ts";

const customPreset = "Custom";

function ProviderForm({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState(initial);
  const [isSaved, setIsSaved] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const provider = draft.provider;
  const setProvider = (patch: Partial<ProviderSettings>) => {
    setDraft({ ...draft, provider: { ...provider, ...patch } });
    setIsSaved(false);
  };
  const setToggle = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setIsSaved(false);
  };
  const presetNames = Object.keys(llm.presets);
  const activePreset = presetNames.find((name) => llm.presets[name]!.baseUrl === provider.baseUrl && llm.presets[name]!.kind === provider.kind) ?? customPreset;

  const choosePreset = (name: string) => {
    const preset = llm.presets[name];
    if (preset) setProvider({ kind: preset.kind, baseUrl: preset.baseUrl, model: preset.model });
  };
  const testConnection = useTask(async () => {
    setLatency(null);
    const started = performance.now();
    try {
      await llm.create(provider).chat({ system: "Reply with the single word OK.", user: "ping", maxTokens: 16 });
    } catch (failure) {
      aiContext.report("error");
      throw failure;
    }
    aiContext.report("ok");
    setLatency(Math.round(performance.now() - started));
  });
  const save = async () => {
    await storage.set("settings", draft);
    setIsSaved(true);
  };

  return (
    <Card title="AI provider">
      <div class="stack tight">
        <Choice label="Provider" value={activePreset} options={[...presetNames, customPreset]} onValue={choosePreset} />
        <Choice label="API type" value={provider.kind} options={[["openai", "OpenAI-compatible"], ["anthropic", "Anthropic"]]} onValue={(kind) => setProvider({ kind: kind as ProviderSettings["kind"] })} />
        <Field label="Base URL" value={provider.baseUrl} onValue={(baseUrl) => setProvider({ baseUrl })} />
        <Field label="API key" type="password" value={provider.apiKey} placeholder="Not needed for local models" onValue={(apiKey) => setProvider({ apiKey })} />
        <Field label="Model" value={provider.model} onValue={(model) => setProvider({ model })} />
        <div class="row wrap">
          <Button isBusy={testConnection.isBusy} onClick={() => void testConnection.run()}>
            Test connection
          </Button>
          {latency !== null && <span class="ok-text">Connected in {latency} ms</span>}
        </div>
        <ErrorNote message={testConnection.error} />
        <Check label="Analyze jobs automatically" checked={draft.autoAnalyze} onChecked={(autoAnalyze) => setToggle({ autoAnalyze })} />
        <Check label="Re-fill automatically when the page changes" checked={draft.autoFillOnPageChange} onChecked={(autoFillOnPageChange) => setToggle({ autoFillOnPageChange })} />
        <Check label="Search the web for salary data" checked={draft.salarySearch} onChecked={(salarySearch) => setToggle({ salarySearch })} />
        <div class="row">
          <Button kind="primary" onClick={() => void save()}>
            Save settings
          </Button>
          {isSaved && <span class="ok-text">Saved</span>}
        </div>
      </div>
    </Card>
  );
}

export function SettingsTab() {
  const settings = useStored("settings");
  const profile = useStored("profile");
  return (
    <div class="stack">
      {settings && <ProviderForm initial={settings} />}
      <ResumeSection />
      {/* remount when the stored profile changes (extraction, import) so the draft resyncs */}
      {profile && <ProfileEditor key={JSON.stringify(profile)} initial={profile} />}
      <DataSection />
    </div>
  );
}
