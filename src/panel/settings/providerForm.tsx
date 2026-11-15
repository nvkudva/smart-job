import { useEffect, useRef, useState } from "preact/hooks";
import * as llm from "../../ai/llm.ts";
import * as models from "../../ai/models.ts";
import * as openrouterAuth from "../../ai/openrouterAuth.ts";
import type { ProviderSettings } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Choice, ErrorNote, Field } from "../shared/controls.tsx";
import { Icon } from "../shared/icons.tsx";
import { useTask } from "../shared/useTask.ts";

const customPreset = "Custom";

function useModelIds(provider: ProviderSettings, onProvider: (patch: Partial<ProviderSettings>) => void): { ids: string[]; isLoading: boolean; refresh: () => void } {
  const [ids, setIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    let isAlive = true;
    setIsLoading(true);
    // debounced so typing a base URL does not fire a request per keystroke
    const timer = setTimeout(
      () =>
        void Promise.all([models.list(provider), models.active(provider)]).then(([found, running]) => {
          if (!isAlive) return;
          setIds(found);
          setIsLoading(false);
          // a local server has one model in memory; picking another would make it swap models on the first request
          if (running && running !== provider.model) onProvider({ model: running });
        }),
      600,
    );
    return () => {
      isAlive = false;
      clearTimeout(timer);
    };
  }, [provider.kind, provider.baseUrl, provider.apiKey, refreshCount]);
  return { ids, isLoading, refresh: () => setRefreshCount(refreshCount + 1) };
}

function ModelField({ provider, ids, onProvider }: { provider: ProviderSettings; ids: string[]; onProvider: (patch: Partial<ProviderSettings>) => void }) {
  // a datalist only shows ids matching the current text, so once the server lists its models use a plain dropdown
  if (ids.length > 0) {
    const options = ids.includes(provider.model) || !provider.model ? ids : [provider.model, ...ids];
    return <Choice label="Model" value={provider.model} options={options} onValue={(model) => onProvider({ model })} />;
  }
  return <Field label="Model" value={provider.model} onValue={(model) => onProvider({ model })} />;
}

interface ProviderFieldsProps {
  provider: ProviderSettings;
  onProvider: (patch: Partial<ProviderSettings>) => void;
}

/** Preset, API type, URL, key (with a link to the provider's key page), model (with discovered ids) and Test connection; shared by Settings and the setup wizard. */
export function ProviderFields({ provider, onProvider }: ProviderFieldsProps) {
  const [latency, setLatency] = useState<number | null>(null);
  const modelIds = useModelIds(provider, onProvider);
  const presetOptions: [string, string][] = Object.keys(llm.presets).map((name) => [name, llm.freeLimits[name] ? `${name} (${llm.freeLimits[name]})` : name]);
  const [presetName, setPresetName] = useState(llm.presetFor(provider) ?? customPreset);
  // each provider keeps its own edited URL, key and model while the user switches between them
  const rememberedByPreset = useRef<Record<string, ProviderSettings>>({});
  const keyPage = llm.keyPages[presetName];
  // pasting a key is the last step of the manual flow, so connect without another click
  const testedKey = useRef(provider.apiKey);

  const choosePreset = (name: string) => {
    rememberedByPreset.current[presetName] = provider;
    const next = rememberedByPreset.current[name] ?? llm.presets[name];
    setPresetName(name);
    if (next) {
      testedKey.current = next.apiKey;
      onProvider(next);
    }
  };
  const testConnection = useTask(async (target: ProviderSettings = provider) => {
    setLatency(null);
    const started = performance.now();
    try {
      await llm.create(target).chat({ system: "Reply with the single word OK.", user: "ping", maxTokens: 16 });
    } catch (failure) {
      aiContext.report("error");
      throw failure;
    }
    aiContext.report("ok");
    setLatency(Math.round(performance.now() - started));
  });
  const getFreeKey = useTask(async () => {
    const connected = await openrouterAuth.connect();
    if (!connected) return;
    rememberedByPreset.current.OpenRouter = connected;
    testedKey.current = connected.apiKey;
    setPresetName("OpenRouter");
    onProvider(connected);
    await testConnection.run(connected);
  });
  // OpenRouter can hand over a key by itself; every other provider only has a key page
  const getKey = () => (presetName === "OpenRouter" ? void getFreeKey.run() : void window.open(keyPage, "_blank"));
  useEffect(() => {
    if (provider.apiKey === testedKey.current || provider.apiKey.length < 20) return;
    const timer = setTimeout(() => {
      testedKey.current = provider.apiKey;
      void testConnection.run();
    }, 800);
    return () => clearTimeout(timer);
  }, [provider.apiKey]);

  return (
    <>
      <div class="stack tight">
        <div class="grid2">
          <Choice label="Provider" value={presetName} options={[...presetOptions, customPreset]} onValue={choosePreset} />
          <Choice label="API type" value={provider.kind} options={[["openai", "OpenAI-compatible"], ["anthropic", "Anthropic"]]} onValue={(kind) => onProvider({ kind: kind as ProviderSettings["kind"] })} />
        </div>
        <Field label="Base URL" value={provider.baseUrl} onValue={(baseUrl) => onProvider({ baseUrl })} />
        <div class="row">
          <Field label="API key" type="password" value={provider.apiKey} placeholder="Not needed for local models" onValue={(apiKey) => onProvider({ apiKey })} />
          {keyPage && (
            <Button isBusy={getFreeKey.isBusy} onClick={getKey}>
              Get key ↗
            </Button>
          )}
        </div>
        <ErrorNote message={getFreeKey.error} />
        <div class="row">
          <ModelField provider={provider} ids={modelIds.ids} onProvider={onProvider} />
          <Button isBusy={modelIds.isLoading} aria-label="Refresh models" title="Refresh models" onClick={modelIds.refresh}>
            {!modelIds.isLoading && <Icon name="Refresh" />}
          </Button>
        </div>
        <Button isBusy={testConnection.isBusy} onClick={() => void testConnection.run()}>
          Test connection
        </Button>
      </div>
      {latency !== null && <span class="ok-text">Connected in {latency} ms</span>}
      <ErrorNote message={testConnection.error} />
    </>
  );
}
