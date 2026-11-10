import { Component, render } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { JobPosting } from "../types.ts";
import * as activeTab from "./activeTab.ts";
import * as aiContext from "./aiContext.ts";
import { ApplyTab } from "./applyTab.tsx";
import { Card, ErrorNote } from "./controls.tsx";
import { JobTab } from "./jobTab.tsx";
import { SettingsTab } from "./settingsTab.tsx";
import { TrackerTab } from "./trackerTab.tsx";
import { useStored } from "./useStored.ts";
import { WriteTab } from "./writeTab.tsx";

const tabNames = ["Job", "Apply", "Tracker", "Write", "Settings"] as const;
type TabName = (typeof tabNames)[number];

/** Keeps one failing tab from taking down the whole panel. */
class TabGuard extends Component<{ children: ComponentChildren }, { message: string }> {
  override state = { message: "" };
  override componentDidCatch(failure: unknown) {
    this.setState({ message: failure instanceof Error ? failure.message : String(failure) });
  }
  override render() {
    if (this.state.message) return <ErrorNote message={`Something went wrong: ${this.state.message}`} onRetry={() => this.setState({ message: "" })} />;
    return this.props.children;
  }
}

const statusLabel = { unknown: "AI provider not checked yet", ok: "AI provider reachable", error: "AI provider error" };

function Header({ host }: { host: string }) {
  const status = aiContext.useStatus();
  return (
    <header class="app-header">
      <h1>SmartJob</h1>
      <span class={`dot ${status}`} role="img" aria-label={statusLabel[status]} title={statusLabel[status]} />
      <span class="host" title={host}>
        {host}
      </span>
    </header>
  );
}

function Onboarding({ onSettings, isOnSettings }: { onSettings: () => void; isOnSettings: boolean }) {
  return (
    <Card title="Welcome to SmartJob">
      <p class="muted">
        Add your resume and choose an AI model to unlock match scores, autofill and writing tools.
        {!isOnSettings && (
          <>
            {" "}
            <button type="button" class="link" onClick={onSettings}>
              Go to Settings
            </button>
          </>
        )}
      </p>
    </Card>
  );
}

function App() {
  const resume = useStored("resume");
  const active = activeTab.use();
  const [tab, setTab] = useState<TabName>("Job");
  const [writeJobId, setWriteJobId] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<JobPosting | null>(null);
  const isResumeLoaded = resume !== undefined;
  const hasResume = !!resume;

  useEffect(() => void (isResumeLoaded && !hasResume && setTab("Settings")), [isResumeLoaded]);
  useEffect(() => void (active.job && setLastJob(active.job)), [active.job]);

  const writeFor = (jobId: string) => {
    setWriteJobId(jobId);
    setTab("Write");
  };
  const currentJob = active.job ?? lastJob;
  const panels: Record<TabName, ComponentChildren> = {
    Job: <JobTab active={active} hasResume={hasResume} onWrite={writeFor} />,
    Apply: <ApplyTab tabId={active.tabId} job={currentJob} />,
    Tracker: <TrackerTab />,
    Write: <WriteTab currentJob={currentJob} preferredJobId={writeJobId} />,
    Settings: <SettingsTab />,
  };

  return (
    <div class="app">
      <Header host={active.host} />
      <nav class="tabs" role="tablist">
        {tabNames.map((name) => (
          <button type="button" role="tab" aria-selected={tab === name} class={tab === name ? "active" : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      <main>
        {isResumeLoaded && !hasResume && <Onboarding onSettings={() => setTab("Settings")} isOnSettings={tab === "Settings"} />}
        {/* all tabs stay mounted so a running fill or draft survives tab switches */}
        {tabNames.map((name) => (
          <section hidden={tab !== name} role="tabpanel" aria-label={name}>
            <TabGuard>{panels[name]}</TabGuard>
          </section>
        ))}
      </main>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
