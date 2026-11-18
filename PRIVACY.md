# SmartJob Privacy Policy

Last updated: 2026-11-17

SmartJob is a Chrome extension that helps you apply for jobs. It has no server and no account. The developer receives none of your data.

## What SmartJob stores
Stored only on your device, in `chrome.storage.local` and `chrome.storage.session`:
- Resume (PDF and text), profile details (name, contact, address, work history, education, skills, work authorization, salary expectation, optional equal-opportunity answers).
- Optional job-site account email and password, used only to fill sign-up and sign-in forms you open.
- AI provider settings, including an API key if you enter one.
- Saved jobs, analyses, cover letters, tailored resumes and saved form answers.

SmartJob does not sell, rent or share this data, and does not use it for advertising, credit or lending decisions, or anything unrelated to the features you use.

## What leaves your device
Data is sent only when you use a feature that needs it:
1. **AI provider you choose.** Job text, resume and profile text, and form questions are sent to the endpoint in Settings (a local model such as Ollama or LM Studio, or a cloud provider such as OpenAI, Anthropic, OpenRouter, Google Gemini, Groq or DeepSeek). Your API key is sent only to that provider. The provider's own privacy policy applies. With a local model, nothing goes to a cloud AI. Passwords are never sent to the AI.
2. **Job portals you import from.** Your LinkedIn profile page (`linkedin.com/in/me/`) is read if you choose Import from LinkedIn, and the job page you have open is read to show its match score. SmartJob reads those pages in your own browser session and sends nothing to the portal. A fuller job search across several portals is coming soon; it will send your search terms and location to those portals, and this policy will say so before it ships.
3. **Salary and perks lookups.** Role and company terms are sent to Bing or DuckDuckGo when web search is enabled. Links to Levels.fyi or Glassdoor open in a new tab when you click them.
4. **Office lookup.** A company name and city are sent to Brave Search, DuckDuckGo or Bing, and to OpenStreetMap Nominatim. If you allow location access, your coordinates are used in the browser to show distance and a Google Maps route.
5. **OpenRouter sign-in.** If you choose it, the sign-in uses Chrome's identity flow with openrouter.ai.

No analytics, telemetry or tracking is included.

## Website access
SmartJob runs on web pages so it can detect a job posting and fill application forms you open. It reads page content only to extract the job and to find form fields. It never submits an application for you.

## Your control
Settings has Export, Import and Clear all data. Exports leave out your API key and password. Uninstalling the extension removes its stored data.

## Remote code
SmartJob loads no remote code. All scripts ship inside the extension.

## Contact
Questions: open an issue in the project repository.
