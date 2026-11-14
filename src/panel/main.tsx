import { Component, render } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { JobPosting } from "../types.ts";
import * as activeTab from "./job/activeTab.ts";
import * as aiContext from "./shared/aiContext.ts";
import { ApplyTab } from "./apply/applyTab.tsx";
import { Card, ErrorNote } from "./shared/controls.tsx";
import { Icon } from "./shared/icons.tsx";
import { AnalysisTab } from "./job/analysisTab.tsx";
import { SetupWizard, useSetupComplete } from "./settings/onboarding.tsx";
import { ProfileTab } from "./settings/profileTab.tsx";
import { SettingsTab } from "./settings/settingsTab.tsx";
import { TrackerTab } from "./tracker/trackerTab.tsx";
import { useStored } from "./shared/useStored.ts";

const tabNames = ["Analysis", "Apply", "Track", "Profile", "Settings"] as const;
type TabName = (typeof tabNames)[number];

/** Keeps one failing tab from taking down the whole panel. */
class TabGuard extends Component<{ children: ComponentChildren }, { message: string }> {
  override state = { message: "" };
  override componentDidCatch(failure: unknown) {
    console.error("[SmartJob] tab crashed", failure);
    this.setState({ message: failure instanceof Error ? failure.message : String(failure) });
  }
  override render() {
    if (this.state.message) return <ErrorNote message={`Something went wrong: ${this.state.message}`} onRetry={() => this.setState({ message: "" })} />;
    return this.props.children;
  }
}

const statusLabel = { unknown: "AI not checked yet", ok: "AI reachable", error: "AI error" };

/** The side panel already shows the extension name, so health lives as a dot on the Settings tab instead of a header row. */
function AiDot() {
  const status = aiContext.useStatus();
  return <span class={`dot ${status}`} role="img" aria-label={statusLabel[status]} title={statusLabel[status]} />;
}

/** Shown when the AI provider reports a rate limit, with a shortcut to Settings where another endpoint can be picked. */
function RateLimitToast({ onSwitch }: { onSwitch: () => void }) {
  const [isRateLimited, dismiss] = aiContext.useRateLimited();
  useEffect(() => {
    if (!isRateLimited) return;
    const timer = setTimeout(dismiss, 20000);
    return () => clearTimeout(timer);
  }, [isRateLimited]);
  if (!isRateLimited) return null;
  return (
    <div class="toast" role="alert">
      <span>The AI provider is rate limited. Switch to another endpoint?</span>
      <button
        type="button"
        class="btn primary"
        onClick={() => {
          dismiss();
          onSwitch();
        }}
      >
        Switch
      </button>
      <button type="button" class="btn ghost" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <Icon name="Close" />
      </button>
    </div>
  );
}

function Onboarding({ onProfile, isOnProfile }: { onProfile: () => void; isOnProfile: boolean }) {
  return (
    <Card title="Welcome to SmartJob">
      <p class="muted">
        Add your resume and choose an AI model to unlock match scores, autofill and writing tools.
        {!isOnProfile && (
          <>
            {" "}
            <button type="button" class="link" onClick={onProfile}>
              Go to Profile
            </button>
          </>
        )}
      </p>
    </Card>
  );
}

function App() {
  const resume = useStored("resume");
  const isSetupComplete = useSetupComplete();
  const active = activeTab.use();
  const [tab, setTab] = useState<TabName>("Analysis");
  const [lastJob, setLastJob] = useState<JobPosting | null>(null);
  const isResumeLoaded = resume !== undefined;
  const hasResume = !!resume;

  useEffect(() => void (isResumeLoaded && !hasResume && setTab("Profile")), [isResumeLoaded]);
  useEffect(() => void (active.job && setLastJob(active.job)), [active.job]);

  if (isSetupComplete === undefined) return null;
  if (!isSetupComplete) {
    return (
      <div class="app">
        <main>
          <TabGuard>
            <SetupWizard />
          </TabGuard>
        </main>
      </div>
    );
  }
  const currentJob = active.job ?? lastJob;
  const panels: Record<TabName, ComponentChildren> = {
    Analysis: <AnalysisTab active={active} hasResume={hasResume} onApply={() => setTab("Apply")} />,
    Apply: <ApplyTab tabId={active.tabId} tabUrl={active.url} job={currentJob} />,
    Track: <TrackerTab />,
    Profile: <ProfileTab />,
    Settings: <SettingsTab />,
  };

  return (
    <div class="app">
      <nav class="tabs" role="tablist">
        {tabNames.map((name) => (
          <button type="button" role="tab" aria-selected={tab === name} class={tab === name ? "active" : ""} onClick={() => setTab(name)}>
            <Icon name={name} />
            <span>{name}</span>
            {name === "Settings" && <AiDot />}
          </button>
        ))}
      </nav>
      <main>
        {isResumeLoaded && !hasResume && <Onboarding onProfile={() => setTab("Profile")} isOnProfile={tab === "Profile"} />}
        {/* all tabs stay mounted so a running fill or draft survives tab switches */}
        {tabNames.map((name) => (
          <section hidden={tab !== name} role="tabpanel" aria-label={name}>
            <TabGuard>{panels[name]}</TabGuard>
          </section>
        ))}
      </main>
      <RateLimitToast onSwitch={() => setTab("Settings")} />
    </div>
  );
}

render(<App />, document.getElementById("root")!);
