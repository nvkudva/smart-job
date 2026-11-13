import type { AnswerBank, JobAnalysis, Profile, Resume, Settings, TrackedJob } from "./types.ts";

export interface StoreShape {
  settings: Settings;
  profile: Profile;
  resume: Resume | null;
  /** keyed by JobPosting.id */
  jobs: Record<string, TrackedJob>;
  /** analysis cache for jobs not (yet) shortlisted, keyed by JobPosting.id */
  analyses: Record<string, JobAnalysis>;
  answers: AnswerBank;
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
  lastName: "",
  email: "",
  phone: "",
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
  answers: {},
};

export async function get<K extends keyof StoreShape>(key: K): Promise<StoreShape[K]> {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key] as StoreShape[K] | undefined;
  if (value === undefined) return structuredClone(defaults[key]);
  if (key === "settings" || key === "profile") return { ...defaults[key], ...value } as StoreShape[K];
  return value;
}

export async function set<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function update<K extends keyof StoreShape>(
  key: K,
  change: (current: StoreShape[K]) => StoreShape[K],
): Promise<StoreShape[K]> {
  const next = change(await get(key));
  await set(key, next);
  return next;
}

export function onChange(listener: (changedKeys: (keyof StoreShape)[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local") listener(Object.keys(changes) as (keyof StoreShape)[]);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export async function exportAll(): Promise<string> {
  return JSON.stringify(await chrome.storage.local.get(null), null, 2);
}

export async function importAll(json: string): Promise<void> {
  await chrome.storage.local.set(JSON.parse(json));
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
