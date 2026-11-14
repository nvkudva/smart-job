import { useEffect, useRef, useState } from "preact/hooks";
import * as llm from "../../ai/llm.ts";
import * as models from "../../ai/models.ts";
import type { ProviderSettings } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Choice, ErrorNote, Field } from "../shared/controls.tsx";
import { useTask } from "../shared/useTask.ts";

const customPreset = "Custom";
const modelListId = "provider-models";

function useModelIds(provider: ProviderSettings): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let isAlive = true;
    // debounced so typing a base URL does not fire a request per keystroke
    const timer = setTimeout(() => void models.list(provider).then((found) => isAlive && setIds(found)), 600);
    return () => {
      isAlive = false;
      clearTimeout(timer);
    };
  }, [provider.kind, provider.baseUrl, provider.apiKey]);
  return ids;
}

function ModelField({ provider, ids, onProvider }: { provider: ProviderSettings; ids: string[]; onProvider: (patch: Partial<ProviderSettings>) => void }) {
  return (
    <>
      <label class="field">
        <input list={modelListId} placeholder=" " value={provider.model} onInput={(event) => onProvider({ model: event.currentTarget.value })} />
        <span>Model</span>
      </label>
      <datalist id={modelListId}>
        {ids.map((id) => (
          <option value={id} />
        ))}
      </datalist>
      {ids.length > 0 && <span class="muted small">{ids.length} models available on this server; pick one or type a name.</span>}
    </>
  );
}

interface ProviderFieldsProps {
  provider: ProviderSettings;
  onProvider: (patch: Partial<ProviderSettings>) => void;
}

/** Preset, API type, URL, key (with a link to the provider's key page), model (with discovered ids) and Test connection; shared by Settings and the setup wizard. */
export function ProviderFields({ provider, onProvider }: ProviderFieldsProps) {
  const [latency, setLatency] = useState<number | null>(null);
  const modelIds = useModelIds(provider);
  const presetNames = Object.keys(llm.presets);
  const [presetName, setPresetName] = useState(llm.presetFor(provider) ?? customPreset);
  // each provider keeps its own edited URL, key and model while the user switches between them
  const rememberedByPreset = useRef<Record<string, ProviderSettings>>({});
  const keyPage = llm.keyPages[presetName];

  const choosePreset = (name: string) => {
    rememberedByPreset.current[presetName] = provider;
    const next = rememberedByPreset.current[name] ?? llm.presets[name];
    setPresetName(name);
    if (next) onProvider(next);
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

  return (
    <>
      <div class="grid2">
        <Choice label="Provider" value={presetName} options={[...presetNames, customPreset]} onValue={choosePreset} />
        <Choice label="API type" value={provider.kind} options={[["openai", "OpenAI-compatible"], ["anthropic", "Anthropic"]]} onValue={(kind) => onProvider({ kind: kind as ProviderSettings["kind"] })} />
      </div>
      <Field label="Base URL" value={provider.baseUrl} onValue={(baseUrl) => onProvider({ baseUrl })} />
      <Field label="API key" type="password" value={provider.apiKey} placeholder="Not needed for local models" onValue={(apiKey) => onProvider({ apiKey })} />
      {keyPage && (
        <a class="link small" href={keyPage} target="_blank" rel="noreferrer">
          Get {presetName} API key ↗
        </a>
      )}
      <ModelField provider={provider} ids={modelIds} onProvider={onProvider} />
      <div class="row wrap">
        <Button isBusy={testConnection.isBusy} onClick={() => void testConnection.run()}>
          Test connection
        </Button>
        {latency !== null && <span class="ok-text">Connected in {latency} ms</span>}
      </div>
      <ErrorNote message={testConnection.error} />
    </>
  );
}
