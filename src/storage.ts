import * as llm from "./ai/llm.ts";
import type { AnswerBank, CompanyOffice, CompanyPerks, FillLogEntry, HomeLocation, JobAnalysis, JobSearch, Profile, Resume, SalaryEstimate, Settings, TailoredResume, TrackedJob } from "./types.ts";

export interface StoreShape {
  settings: Settings;
  profile: Profile;
  resume: Resume | null;
  /** keyed by JobPosting.id */
  jobs: Record<string, TrackedJob>;
  /** analysis cache for jobs not (yet) shortlisted, keyed by JobPosting.id */
  analyses: Record<string, JobAnalysis>;
  /** salary and perks that succeeded when the analysis itself failed, keyed by JobPosting.id */
  lookups: Record<string, { salary: SalaryEstimate | null; perks: CompanyPerks | null; office?: CompanyOffice | null }>;
  answers: AnswerBank;
  /** newest last, capped; what failed, was edited or was unknown on job forms */
  fillLog: FillLogEntry[];
  /** false shows the setup wizard; absent means "decide from existing data" (see isSetupComplete) */
  setupComplete: boolean;
  /** epoch ms of the last LinkedIn import, 0 = never */
  linkedinImportedAt: number;
  jobSearches: JobSearch[];
  /** Super Job searches, newest first, capped */
  recentSearches: { role: string; location: string }[];
  /** newest first */
  tailoredResumes: TailoredResume[];
  /** starting point for office distances; null = ask the user */
  homeLocation: HomeLocation | null;
}

export const defaultSettings: Settings = {
  provider: { kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen3.6-35b-a3b-splash" },
  autoFillOnPageChange: false,
  autoAnalyze: true,
  salarySearch: true,
  account: { email: "", password: "" },
};

export const emptyProfile: Profile = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  phone: "",
  otherPhones: [],
  phoneCountryCode: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  linkedin: "",
  github: "",
  portfolio: "",
  website: "",
  headline: "",
  summary: "",
  currentTitle: "",
  currentCompany: "",
  yearsExperience: 0,
  skills: [],
  experience: [],
  education: [],
  workAuthorized: "",
  requiresSponsorship: "",
  willingToRelocate: "",
  salaryExpectation: "",
  currentSalary: "",
  linkedinSummary: "",
  noticePeriod: "",
  gender: "",
  ethnicity: "",
  veteranStatus: "",
  disabilityStatus: "",
  pronouns: "",
};

const defaults: StoreShape = {
  settings: defaultSettings,
  profile: emptyProfile,
  resume: null,
  jobs: {},
  analyses: {},
  lookups: {},
  answers: {},
  fillLog: [],
  setupComplete: false,
  linkedinImportedAt: 0,
  jobSearches: [],
  recentSearches: [],
  tailoredResumes: [],
  homeLocation: null,
};

export async function get<K extends keyof StoreShape>(key: K): Promise<StoreShape[K]> {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key] as StoreShape[K] | undefined;
  if (value === undefined) return structuredClone(defaults[key]);
  if (key === "settings" || key === "profile") return { ...(defaults[key] as object), ...(value as object) } as StoreShape[K];
  return value;
}

export async function set<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

const pendingUpdates = new Map<string, Promise<unknown>>();

/** Updates to one key run one after another so two overlapping read-modify-writes cannot drop each other's change. */
export function update<K extends keyof StoreShape>(key: K, change: (current: StoreShape[K]) => StoreShape[K]): Promise<StoreShape[K]> {
  const run = async () => {
    const next = change(await get(key));
    await set(key, next);
    return next;
  };
  const queued = (pendingUpdates.get(key) ?? Promise.resolve()).then(run, run);
  pendingUpdates.set(key, queued.catch(() => undefined));
  return queued;
}

export function onChange(listener: (changedKeys: (keyof StoreShape)[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local") listener(Object.keys(changes) as (keyof StoreShape)[]);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

interface SetupEvidence {
  setupComplete?: boolean;
  settings?: unknown;
  profile?: Partial<Profile>;
}

/** Users who configured a provider and have a named profile from before the wizard existed count as done. */
export function isSetupComplete(stored: SetupEvidence): boolean {
  if (typeof stored.setupComplete === "boolean") return stored.setupComplete;
  return stored.settings !== undefined && !!stored.profile?.firstName;
}

export async function loadSetupComplete(): Promise<boolean> {
  const stored = (await chrome.storage.local.get(["setupComplete", "settings", "profile"])) as SetupEvidence;
  const isComplete = isSetupComplete(stored);
  // pinned so a profile filling in mid-wizard (or being cleared later) cannot flip the answer
  if (stored.setupComplete === undefined) await set("setupComplete", isComplete);
  return isComplete;
}

/** The API key and job-site password are left out because export files get attached to bug reports and synced to cloud folders. */
export async function exportAll(): Promise<string> {
  const everything = await chrome.storage.local.get(null);
  const settings = everything.settings as Settings | undefined;
  if (settings) everything.settings = { ...settings, provider: { ...settings.provider, apiKey: "" }, account: { ...settings.account, password: "" } };
  return JSON.stringify(everything, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The value must look like the key's default: object, array, boolean or number (resume may also be null). */
function hasExpectedShape(key: keyof StoreShape, value: unknown): boolean {
  const expected = defaults[key];
  if (expected === null) return value === null || isPlainObject(value);
  if (Array.isArray(expected)) return Array.isArray(value);
  if (typeof expected === "object") return isPlainObject(value);
  return typeof value === typeof expected;
}

/** A planted base URL would send the resume and key to someone else's server, so only known providers and local servers pass. */
function isTrustedProvider(settings: Record<string, unknown>): boolean {
  const provider = settings.provider;
  if (provider === undefined) return true;
  if (!isPlainObject(provider) || typeof provider.baseUrl !== "string" || typeof provider.kind !== "string") return false;
  return !!llm.presetFor(provider as unknown as Settings["provider"]) || llm.isLocalServer(provider.baseUrl);
}

/** Only known keys with the right basic shape are written, so a wrong or hand-edited file cannot plant stray data or crash the panel. */
export async function importAll(json: string): Promise<void> {
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) throw new Error("Not a SmartJob Assistant export file.");
  const known = Object.entries(parsed).filter(([key]) => key in defaults);
  if (known.length === 0) throw new Error("This file has no SmartJob Assistant data.");
  for (const [key, value] of known) {
    if (!hasExpectedShape(key as keyof StoreShape, value)) throw new Error(`The "${key}" data in this file has the wrong format.`);
  }
  const settings = parsed.settings;
  if (isPlainObject(settings) && !isTrustedProvider(settings)) throw new Error("This file points the AI provider at an unknown server. Edit the base URL to a known provider or a local server and try again.");
  const toWrite = Object.fromEntries(known);
  if (isPlainObject(settings)) toWrite.settings = await withKeptSecrets(settings as Partial<Settings>);
  await chrome.storage.local.set(toWrite);
}

/** Exports leave the API key and job-site password empty, so importing them back must not wipe the ones already saved. */
async function withKeptSecrets(incoming: Partial<Settings>): Promise<Partial<Settings>> {
  const current = await get("settings");
  const provider = incoming.provider && { ...incoming.provider, apiKey: incoming.provider.apiKey || current.provider.apiKey };
  const account = incoming.account && { ...incoming.account, password: incoming.account.password || current.account.password };
  return { ...incoming, ...(provider && { provider }), ...(account && { account }) };
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
