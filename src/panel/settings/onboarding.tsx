import { useEffect, useState } from "preact/hooks";
import * as roles from "../../ai/roles.ts";
import * as storage from "../../storage.ts";
import type { Profile, ProviderSettings, Settings, YesNo } from "../../types.ts";
import * as aiClient from "../shared/aiClient.ts";
import * as format from "../shared/format.ts";
import { Button, Card, Check, Choice, ErrorNote, Field } from "../shared/controls.tsx";
import { JobSearchLinks } from "../job/jobSearchLinks.tsx";
import { runImport } from "./linkedinButton.tsx";
import { ProviderFields } from "./providerForm.tsx";
import { ResumeSection, saveExtractedProfile } from "./resumeSection.tsx";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

const stepTitles = ["AI provider", "Your profile", "Review", "Job searches"];
const yesNoOptions = [["", "Not set"], ["yes", "Yes"], ["no", "No"]] as const;

/** undefined until storage answers, so the panel does not flash the wizard for finished users. */
export function useSetupComplete(): boolean | undefined {
  const [isComplete, setIsComplete] = useState<boolean>();
  useEffect(() => {
    const load = () => void storage.loadSetupComplete().then(setIsComplete);
    load();
    return storage.onChange((keys) => keys.includes("setupComplete") && load());
  }, []);
  return isComplete;
}

function ProviderStep({ initial, onNext }: { initial: Settings; onNext: () => void }) {
  const [provider, setProvider] = useState(initial.provider);
  const save = async () => {
    await storage.update("settings", (current) => ({ ...current, provider }));
    onNext();
  };
  return (
    <Card title="1. AI provider">
      <div class="stack tight">
        <p class="muted small">Pick where the AI runs. A local model (Ollama, LM Studio) keeps everything on this machine.</p>
        <ProviderFields provider={provider} onProvider={(patch: Partial<ProviderSettings>) => setProvider({ ...provider, ...patch })} />
        <Button kind="primary" onClick={() => void save()}>
          Save and continue
        </Button>
      </div>
    </Card>
  );
}

function ProfileStep({ onNext }: { onNext: () => void }) {
  const [isLinkedin, setIsLinkedin] = useState(false);
  const [isResumeRead, setIsResumeRead] = useState(false);
  const [status, setStatus] = useState("");
  const build = useTask(async () => {
    const resume = await storage.get("resume");
    const resumeText = resume?.text.trim() ?? "";
    if (!resumeText && !isLinkedin) throw new Error("Add your resume above, or tick Import from LinkedIn.");
    if (resumeText && !isResumeRead) {
      setStatus("Reading your resume with AI…");
      await saveExtractedProfile(resumeText);
      setIsResumeRead(true);
    }
    // a LinkedIn failure stops here with the resume already merged; retry or "Continue without" keeps that work
    if (isLinkedin) await runImport(setStatus);
    onNext();
  });

  return (
    <div class="stack">
      <ResumeSection isOnboarding />
      <Card title="LinkedIn (optional)">
        <Check label="Import from LinkedIn (needs to be logged in; opens a background tab)" checked={isLinkedin} onChecked={setIsLinkedin} />
      </Card>
      <div class="row wrap">
        <Button kind="primary" isBusy={build.isBusy} onClick={() => void build.run()}>
          Build my profile
        </Button>
        {build.isBusy && status && <span class="muted small">{status}</span>}
        <Button onClick={onNext}>Continue without</Button>
      </div>
      <ErrorNote message={build.error} />
    </div>
  );
}

function ReviewForm({ initial, onNext }: { initial: Profile; onNext: () => void }) {
  const [draft, setDraft] = useState(initial);
  const change = (patch: Partial<Profile>) => setDraft({ ...draft, ...patch });
  const yesNo = (label: string, key: "workAuthorized" | "requiresSponsorship" | "willingToRelocate") => (
    <Choice label={label} value={draft[key]} options={[...yesNoOptions]} onValue={(value) => change({ [key]: value as YesNo })} />
  );
  const save = async () => {
    await storage.set("profile", draft);
    onNext();
  };
  return (
    <Card title="3. Review your details">
      <div class="stack tight">
        <p class="muted small">Check what was found and fill the blanks a resume cannot give. You can change everything later in Settings.</p>
        <div class="grid2">
          <Field label="First name" value={draft.firstName} onValue={(firstName) => change({ firstName })} />
          <Field label="Last name" value={draft.lastName} onValue={(lastName) => change({ lastName })} />
        </div>
        <div class="grid2">
          <Field label="Email" type="email" value={draft.email} onValue={(email) => change({ email })} />
          <Field label="Phone" type="tel" value={draft.phone} onValue={(phone) => change({ phone })} />
        </div>
        <div class="grid2">
          <Field label="City" value={draft.city} onValue={(city) => change({ city })} />
          <Field label="State / region" value={draft.state} onValue={(state) => change({ state })} />
        </div>
        <div class="grid2">
          <Field label="Country" value={draft.country} onValue={(country) => change({ country })} />
          <Field label="Years of experience" type="number" value={String(draft.yearsExperience)} onValue={(value) => change({ yearsExperience: Number(value) || 0 })} />
        </div>
        <Field label="Current or last title" value={draft.currentTitle} onValue={(currentTitle) => change({ currentTitle })} />
        <div class="grid2">
          {yesNo("Authorized to work", "workAuthorized")}
          {yesNo("Requires sponsorship", "requiresSponsorship")}
        </div>
        <div class="grid2">
          {yesNo("Willing to relocate", "willingToRelocate")}
          <Field label="Notice period" value={draft.noticePeriod} onValue={(noticePeriod) => change({ noticePeriod })} />
        </div>
        <div class="grid2">
          <Field label="Current salary / CTC" value={draft.currentSalary} onValue={(currentSalary) => change({ currentSalary: format.groupDigits(currentSalary, format.localeForCountry(draft.country)) })} />
          <Field label="Salary expectation" value={draft.salaryExpectation} onValue={(salaryExpectation) => change({ salaryExpectation: format.groupDigits(salaryExpectation, format.localeForCountry(draft.country)) })} />
        </div>
        <Button kind="primary" onClick={() => void save()}>
          Save and continue
        </Button>
      </div>
    </Card>
  );
}

function SearchForm({ profile }: { profile: Profile }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [location, setLocation] = useState(profile.city);
  const [isRemote, setIsRemote] = useState(false);
  const suggest = useTask(async () => {
    try {
      const found = await aiClient.withClient((client) => roles.suggest(client, profile));
      setSuggestions(found);
      setSelected(found.slice(0, 3));
    } catch (failure) {
      const fallback = roles.fallback(profile);
      setSuggestions(fallback);
      setSelected(fallback);
      throw failure;
    }
  });
  useEffect(() => void suggest.run(), []);

  const toggle = (role: string) => setSelected(selected.includes(role) ? selected.filter((item) => item !== role) : [...selected, role]);
  const addCustom = () => {
    const role = custom.trim();
    if (!role) return;
    if (!suggestions.includes(role)) setSuggestions([...suggestions, role]);
    if (!selected.includes(role)) setSelected([...selected, role]);
    setCustom("");
  };
  const searches = roles.buildSearches(selected, location, isRemote);
  const finish = async () => {
    await storage.set("jobSearches", searches);
    await storage.set("setupComplete", true);
  };

  return (
    <Card title="4. Job searches">
      <div class="stack tight">
        <p class="muted small">Roles to look for, based on your profile. Pick the ones you want; each becomes a LinkedIn search you can reopen from the Job tab.</p>
        {suggest.isBusy && <span class="muted small">Suggesting roles…</span>}
        <ErrorNote message={suggest.error} onRetry={() => void suggest.run()} />
        <div class="chips">
          {suggestions.map((role) => (
            <button type="button" class={`chip role ${selected.includes(role) ? "selected" : ""}`} aria-pressed={selected.includes(role)} onClick={() => toggle(role)}>
              {role}
            </button>
          ))}
        </div>
        <div class="grid2">
          <Field label="Location" value={location} onValue={setLocation} />
          <Field label="Add a role" value={custom} onValue={setCustom} />
        </div>
        <div class="row between">
          <Check label="Remote" checked={isRemote} onChecked={setIsRemote} />
          <Button onClick={addCustom}>Add role</Button>
        </div>
        <JobSearchLinks searches={searches} />
        <Button kind="primary" onClick={() => void finish()}>
          Finish
        </Button>
      </div>
    </Card>
  );
}

function StepHeader({ step }: { step: number }) {
  const skip = () => void storage.set("setupComplete", true);
  return (
    <Card
      title="Set up SmartJob"
      actions={
        <button type="button" class="link" onClick={skip}>
          Skip
        </button>
      }
    >
      <ol class="wizard-steps">
        {stepTitles.map((title, index) => (
          <li class={index === step ? "active" : index < step ? "done" : ""}>{title}</li>
        ))}
      </ol>
    </Card>
  );
}

export function SetupWizard() {
  const settings = useStored("settings");
  const profile = useStored("profile");
  const [step, setStep] = useState(0);
  const next = () => setStep(step + 1);
  return (
    <div class="stack">
      <StepHeader step={step} />
      {step === 0 && settings && <ProviderStep initial={settings} onNext={next} />}
      {step === 1 && <ProfileStep onNext={next} />}
      {/* keyed so a profile that lands just after the step starts still reaches the draft */}
      {step === 2 && profile && <ReviewForm key={JSON.stringify(profile)} initial={profile} onNext={next} />}
      {step === 3 && profile && <SearchForm key={JSON.stringify(profile)} profile={profile} />}
    </div>
  );
}
