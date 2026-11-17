# Chrome Web Store listing notes

## Single purpose
Help a job seeker evaluate and apply to jobs: analyse a posting against their resume, track it, and fill the application form for them to review and submit.

## Name / summary (manifest)
SmartJob – AI Job Application Assistant (summary max 132 chars, in `static/manifest.json`)

## Detailed description (paste)
SmartJob is a side-panel assistant for job applications. Open a job posting and it shows a match score against your resume, salary insight, office location and a shortlist button. On application forms it fills your details for you to review. You always click Submit yourself.
- Match score with a requirement-by-requirement breakdown
- Pay and perks estimate with sources
- Autofill for common application systems (works with Workday, iCIMS, Greenhouse, Lever, Ashby and LinkedIn Easy Apply forms)
- Cover letters and tailored resumes that keep your PDF's look
- Job tracker and a multi-portal search page
- Bring your own AI: a local model (free, private) or your own cloud API key
SmartJob is not affiliated with or endorsed by any job site or employer named above. All product names are trademarks of their owners.
Your data is stored on your device. See the privacy policy.

## Permission justifications (dashboard)
- `host_permissions` / content script on all sites: job postings and employer application forms live on any domain; the script detects the posting and fills form fields in all frames (iCIMS uses iframes). It runs only to extract the job and fill the form on user action.
- `sidePanel`: the whole UI is the side panel.
- `storage`: profile, settings, saved jobs, answers, cached analyses.
- `unlimitedStorage`: stores resume PDFs and tailored resume files.
- `webNavigation`: `getAllFrames` to reach application forms inside iframes.
- `scripting`: inject the content script into tabs opened before install, and read results from the job-portal and LinkedIn tabs the user searches.
- `declarativeNetRequestWithHostAccess`: (1) remove the `Origin` header on this extension's requests to localhost/private-network AI servers, which reject chrome-extension origins; (2) remove frame-blocking headers on this extension's own frames, only for levels.fyi, glassdoor and the supported job portals.
- `identity`: OpenRouter OAuth sign-in (`launchWebAuthFlow`) so the user need not copy an API key.

## Privacy tab
- Data collected: personally identifiable information, authentication information (optional job-site password and API key), website content, location (optional).
- Not sold or transferred except to the user-chosen AI provider and portals as described; not used for unrelated purposes; not used for creditworthiness.
- Privacy policy URL: host `PRIVACY.md` (e.g. GitHub Pages or the raw repo page) and paste the link.

## Reviewer test notes
Load the extension, open Settings and pick a provider (a local model is not needed to review: the match tab works without AI using keyword scoring). Open any public job posting, for example a Greenhouse board job, then open the side panel. Demo video: `marketing/smartjob-launch-16x9.mp4`.

## Images
Icons in `static/icons`. Screenshots 1280x800 and promo tiles 440x280 / 1400x560 in `store/`.
