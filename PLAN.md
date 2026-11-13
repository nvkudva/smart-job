# SmartJob — Product Requirements & Implementation Plan

Privacy-first, unified job-hunting copilot as a Chrome (MV3) side panel. Works with a local LLM (Ollama / LM Studio) or a cloud API (OpenAI-compatible, Anthropic) chosen by the user.

## 1. Market research summary

| Product | Strength | Gap we exploit |
|---|---|---|
| Simplify Copilot | Free autofill on 100k+ sites, tracker | Paid tier billing complaints, cloud-only, AI output generic |
| SpeedyApply | Good Workday autofill, free tracker | No cover letters, no job match analysis |
| Teal | Best tracker + resume versions | Weekly billing, generic AI bullets, weak autofill |
| Huntr | Tracker + mobile apps | 100-job free cap, $40/mo |
| Jobscan | Resume ↔ JD keyword match score | 5 scans/mo free, opaque/inconsistent scores |
| LazyApply | Mass auto-apply | 2.1★, spam applications, wrong answers |
| Careerflow / JobRight | LinkedIn optimizer, AI match ranking | Subscription, cloud data, "organizer not apply engine" |
| Rezi / Kickresume | ATS resume builders | Template-bound, paywalled reports |
| Levels.fyi | Verified salary data | Not tied to the job being viewed |

Users currently stitch 3–4 tools (tracker + autofill + resume scorer + salary site), each holding their PII on a vendor server, each a subscription.

**SmartJob position:** one side panel, one local profile, one job record shared by match analysis, salary, shortlist, autofill and writing. Bring-your-own model (local = free and private). Autofill + human review; never auto-submit.

## 2. Product requirements

### P0 — must ship in v1
1. **Onboarding / Settings** (side panel tab)
   - AI provider: preset (Ollama, LM Studio, OpenAI, OpenRouter, Anthropic, custom OpenAI-compatible), base URL, API key, model, "Test connection".
   - Resume: upload PDF (parsed locally with pdf.js) or paste text. Original PDF kept for upload into application forms.
   - Profile auto-extracted from resume by the LLM into a structured profile, fully editable (contact, links, work authorization, sponsorship, experience, education, skills, salary expectation, notice period, relocation, EEO defaults with "decline" default).
   - Data export / import (JSON), clear all data.
2. **Job view** (side panel follows the active tab)
   - Detect a job posting on the current page: JSON-LD `JobPosting` first, then site extractors (LinkedIn, Indeed, Greenhouse, Lever, Workday, iCIMS, Ashby, SmartRecruiters), then generic main-content fallback. LinkedIn SPA navigation (`currentJobId`) re-triggers analysis.
   - AI analysis: 3–5 line summary, must-have vs nice-to-have requirements, match score 0–100 with an explainable breakdown (matched skills, gaps, experience fit), deterministic keyword overlap shown alongside the LLM score.
   - Salary insight: posted salary if present; else web search (DuckDuckGo HTML results → LLM extraction of ranges with sources); else nearest equivalent (same title at similar company / adjacent level at same company) clearly labelled "estimate". Links to Levels.fyi / Glassdoor search.
   - Shortlist (bookmark) button → tracker.
   - Analysis cached per job URL.
3. **Apply / Autofill** (the key feature)
   - Scan all frames of the tab (iCIMS uses iframes) for fields: input, textarea, select, radio/checkbox groups, ARIA comboboxes/listbox buttons (Workday), contenteditable, file inputs.
   - Deterministic mapping first (label / aria / name / id / placeholder / `data-automation-id` patterns → profile fields). LLM only for leftovers and free-text questions (why this company, etc.) using job + resume context.
   - Answer bank: answers the user accepts/edits are saved by normalized question and reused.
   - Fill with framework-safe setters (native value setter + input/change/blur events), custom dropdown click-and-pick, radio/checkbox by label, resume PDF attached to file inputs via `DataTransfer`.
   - Highlight filled fields (green = profile, blue = AI, amber = needs review). Panel shows a review list; user can edit a value and re-apply.
   - Multi-step wizards (Workday): "Fill this page" button + optional auto-fill when the page changes.
   - Never clicks submit.
4. **Tracker**: list of shortlisted / applied jobs with status (saved → applied → interview → offer / rejected), notes, match score, salary, link. Marking "applied" automatically when the user fills on that job's apply flow is a P1 nicety.

### P1 — writing tools
5. Cover letter generator (tone, length), copy / download.
6. Tailored resume: rewrite summary + bullets to match the JD **without inventing facts**, show the diff of changed bullets, export as printable HTML → PDF.
7. Short answer generator for any form question ("Why do you want to work here?") with the job context, saveable into the answer bank.

### P2 — later
- Encrypted sync, multiple resume versions, contact tracking, interview prep, salary negotiation helper, Firefox build.

### Non-functional
- All data in `chrome.storage.local` (`unlimitedStorage`); nothing leaves the machine except calls to the user-chosen AI endpoint and the salary web search.
- Works with small local models: every structured LLM call requests JSON, is parsed tolerantly, and has a fallback. Quality note: ≥4B models recommended.
- No auto-submit, no mass apply.

## 3. Architecture

```
┌─────────────── Side panel (extension page) ───────────────┐
│ Preact UI: Job | Apply | Tracker | Write | Settings        │
│ ai/*  : LLM client (OpenAI-compatible + Anthropic), prompts│
│ fill/session : scan → map → AI → fill orchestration       │
│ storage : chrome.storage.local                             │
└───────▲──────────────────────────────┬────────────────────┘
        │ chrome.tabs.sendMessage(tabId, msg, {frameId})
        │                              ▼
┌───────┴──── Content script (all_frames, <all_urls>) ───────┐
│ job extraction · field scanner · filler · highlights       │
└────────────────────────────────────────────────────────────┘
 background.ts: open panel on toolbar click (setPanelBehavior)
```

Decisions:
- **LLM calls only from the side panel** — extension pages with `host_permissions` bypass CORS (content scripts can't call Ollama), and the open panel avoids MV3 service-worker idle kills during slow local generation.
- Panel discovers frames via `chrome.webNavigation.getAllFrames` and messages each `frameId`; content script is injected in all frames (`all_frames`, `match_about_blank`).
- Site detection by DOM markers (`data-automation-id`, iCIMS classes, JSON-LD), not hostname only → fixtures testable on localhost.
- Stack: TypeScript, Preact, Bun bundler (`bun run build` → `dist/`), pdfjs-dist for PDFs, `bun test` unit tests, Playwright (bundled Chromium, `--load-extension`) end-to-end tests against HTML fixtures. Branded Chrome no longer honors `--load-extension`, hence Playwright Chromium.

Rejected:
- Background-SW LLM calls: SW idle termination during long local generations.
- Auto-submit / mass apply: reputation and account-ban risk, worst-rated competitor category.
- Paid salary APIs: none free; DuckDuckGo HTML + LLM extraction is good enough for v1.
- React: Preact is API-compatible at ~4 KB.

### Source layout
```
src/types.ts        shared domain types
src/messages.ts     panel ↔ content message contract
src/storage.ts      typed chrome.storage.local access
src/background.ts   panel behaviour
src/ai/             llm client + task prompts (analysis, salary, profile, answers, writing)
src/content/        content script: index (router), job extraction, form scan/fill
src/fill/           panel-side mapping + fill session
src/panel/          Preact UI
static/             manifest.json, sidepanel.html, css, icons
test/               fixtures (HTML), unit tests, e2e (Playwright)
```

## 4. Implementation plan

Phase 0 (supervisor): skeleton, contracts (types/messages/storage/llm), build, manifest, extension loads in Playwright.

Phase 1 (parallel sonnet workers, non-overlapping):
- W1 Form-fill engine (high): `src/content/form/*`, `src/fill/*`, form fixtures (Workday-like multi-step React inputs + custom dropdowns, iCIMS-like iframe, Greenhouse-like), unit tests for mapper.
- W2 Job extraction (medium): `src/content/job.ts`, job fixtures (LinkedIn-like, JSON-LD, generic), tests.
- W3 AI tasks (high): `src/ai/tasks.ts` + salary web search + PDF parsing/profile extraction; tests with mocked LLM; live check against LM Studio.
- W4 Side panel UI (high): `src/panel/*`, `static/panel.css`.
- W5 E2E harness (medium, after W1/W2): `test/e2e/*` Playwright: load extension, seed storage, drive panel page, assert fills on fixtures.

Phase 2 (supervisor): integration, e2e run, live LLM run against LM Studio, README "how to load & test".

## Revisions
- 2026-11-10: Salary search uses Bing HTML first, DuckDuckGo HTML second. Both (and levels.fyi/Glassdoor) captcha scripted fetches; results are filtered for salary terms and the AI estimate is the fallback. A real search API is the upgrade path.
- 2026-11-10: Local thinking models: `reasoning_effort` "none" (Ollama) / "low" (LM Studio) sent only to localhost endpoints. qwen3.5-4b is too slow for form answers (~5 min); recommend ≥7B non-thinking or MoE (qwen3.6-35b-a3b answered in ~15 s/call).
- 2026-11-10: Ollama 403s chrome-extension origins; background registers a DNR session rule removing `Origin` only for this extension's requests to :11434.
- 2026-11-10: Checkbox groups are one descriptor (value = option texts joined by " | "); comboboxes report no options until opened, so AI answers are matched against the opened menu.
- 2026-11-13: LinkedIn 2026 UI (/jobs/search-results/, /jobs/view/) has hashed class names and no JSON-LD; read via `#JobDetails_AboutTheJob_<id>`, `[aria-label^="Company, "]` and top-card text order. With a job id in the URL, only that job's block counts (else stale job mid-render).
- 2026-11-13: Profile extraction gets the full resume (20k chars), not the 6k analysis cut; PDF link annotations are appended as a "Links" section; re-extraction merges into the stored profile so typed fields survive.
- 2026-11-13: Job-site account (email + password) lives in Settings, local only. Password fields are scanned (value masked in scans), filled only from Settings, never sent to the AI or saved as answers. Honeypot fields ("for robots only", Workday `beecatcher`) are skipped. The extension still never clicks Create Account / Submit.
