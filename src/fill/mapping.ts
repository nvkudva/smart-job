// Pure, deterministic field -> profile mapping. Also imported by the content-script filler for option matching.
import type { AccountLogin, AnswerBank, Education, Experience, FieldDescriptor, FieldFill, FieldKind, Profile, Resume } from "../types.ts";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\(\s*required\s*\)|\*|\brequired\s*$/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- option matching (shared with the filler) ----------

const US_STATES =
  "AL:Alabama,AK:Alaska,AZ:Arizona,AR:Arkansas,CA:California,CO:Colorado,CT:Connecticut,DE:Delaware,DC:District of Columbia,FL:Florida,GA:Georgia,HI:Hawaii,ID:Idaho,IL:Illinois,IN:Indiana,IA:Iowa,KS:Kansas,KY:Kentucky,LA:Louisiana,ME:Maine,MD:Maryland,MA:Massachusetts,MI:Michigan,MN:Minnesota,MS:Mississippi,MO:Missouri,MT:Montana,NE:Nebraska,NV:Nevada,NH:New Hampshire,NJ:New Jersey,NM:New Mexico,NY:New York,NC:North Carolina,ND:North Dakota,OH:Ohio,OK:Oklahoma,OR:Oregon,PA:Pennsylvania,RI:Rhode Island,SC:South Carolina,SD:South Dakota,TN:Tennessee,TX:Texas,UT:Utah,VT:Vermont,VA:Virginia,WA:Washington,WV:West Virginia,WI:Wisconsin,WY:Wyoming";

const SYNONYM_GROUPS: string[][] = [
  ["yes", "y", "true", "i do", "i am"],
  ["no", "n", "false", "i do not", "i am not"],
  ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
  ["united kingdom", "uk", "u k", "great britain", "gb"],
  ["male", "man"],
  ["female", "woman"],
  ["non binary", "nonbinary"],
  ...US_STATES.split(",").map((pair) => pair.split(":").map(normalize)),
];

const DECLINE_PHRASES = ["decline", "prefer not", "dont wish", "do not wish", "choose not", "rather not", "not wish", "not disclose", "not to say", "do not want", "dont want"];

const DEGREE_LEVELS: [string, RegExp][] = [
  ["bachelor", /\b(bachelor|b\.?sc?|b\.?a|b\.?e|b\.?tech)(?![a-z])/i],
  ["master", /\b(master|m\.?sc?|m\.?a|mba|m\.?eng|m\.?tech)(?![a-z])/i],
  ["doctor", /\b(ph\.?d|doctor)/i],
  ["associate", /\bassociate/i],
  ["high school", /high school|\bged\b/i],
];

function stem(text: string): string {
  return normalize(text)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join(" ");
}

// School names are written many ways; these cover the abbreviations that show up in long university pick-lists.
const SCHOOL_ALIASES: [RegExp, string][] = [
  [/^(uc|u c) /, "university of california "],
  [/^ucla$/, "university of california los angeles"],
  [/^ucsd$/, "university of california san diego"],
  [/^ucsb$/, "university of california santa barbara"],
  [/^ucsc$/, "university of california santa cruz"],
  [/^uci$/, "university of california irvine"],
  [/^ucd$/, "university of california davis"],
  [/^mit$/, "massachusetts institute of technology"],
  [/^cmu$/, "carnegie mellon university"],
  [/^nyu$/, "new york university"],
  [/^caltech$/, "california institute of technology"],
  [/^georgia tech$/, "georgia institute of technology"],
  [/^uiuc$/, "university of illinois urbana champaign"],
  [/^(ut|u t) /, "university of texas "],
  [/^(umich|u mich)$/, "university of michigan"],
  [/^the /, ""],
];

function schoolAliases(value: string): string[] {
  const normalized = normalize(value);
  return SCHOOL_ALIASES.filter(([pattern]) => pattern.test(normalized)).map(([pattern, full]) => stem(normalized.replace(pattern, full)));
}

function expand(value: string): string[] {
  const base = stem(value);
  const wanted = [base, ...schoolAliases(value)];
  if (DECLINE_PHRASES.some((phrase) => normalize(value).includes(phrase))) wanted.push(...DECLINE_PHRASES.map(stem));
  for (const group of SYNONYM_GROUPS) if (group.includes(normalize(value))) wanted.push(...group.map(stem));
  for (const [level, pattern] of DEGREE_LEVELS) if (pattern.test(value)) wanted.push(level);
  return [...new Set(wanted)];
}

function isPlaceholderOption(option: string): boolean {
  return !option.trim() || /^(select|choose|please|pick|-+|—)/i.test(option.trim());
}

function tokenOverlap(left: string, right: string): number {
  const a = left.split(" ");
  const b = new Set(right.split(" "));
  const shared = a.filter((word) => b.has(word)).length;
  return shared / Math.min(a.length, b.size);
}

/** Best option for a wanted value: exact -> prefix -> contains -> value-starts-with-option -> token overlap. */
export function matchOption(options: string[], value: string): string | undefined {
  if (!value.trim()) return undefined;
  const choices = options.filter((option) => !isPlaceholderOption(option)).map((option) => ({ option, key: stem(option) }));
  const wanted = expand(value);
  const tiers: ((key: string, want: string) => boolean)[] = [
    (key, want) => key === want,
    (key, want) => key.startsWith(`${want} `),
    (key, want) => ` ${key} `.includes(` ${want} `),
    (key, want) => want.startsWith(`${key} `),
    (key, want) => tokenOverlap(key, want) >= 0.6,
  ];
  for (const [index, tier] of tiers.entries()) {
    // fuzzy overlap only for the caller's own wording, never for expanded synonyms
    for (const want of index === tiers.length - 1 ? wanted.slice(0, 1) : wanted) {
      const hit = choices.find((choice) => choice.key && tier(choice.key, want));
      if (hit) return hit.option;
    }
  }
  return undefined;
}

function pickYearsRange(options: string[], years: number): string | undefined {
  for (const option of options) {
    const range = option.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
    const open = option.match(/(\d+)\s*\+|(?:more than|over)\s*(\d+)/i);
    if (range && years >= Number(range[1]) && years <= Number(range[2])) return option;
    if (open && years >= Number(open[1] ?? open[2])) return option;
  }
  return undefined;
}

/** Joins fallback values for comboboxes whose options are only known once opened. */
export const ALTERNATIVES_SEPARATOR = " | ";

// ---------- rule engine ----------

interface Context {
  field: FieldDescriptor;
  profile: Profile;
  experience: Experience | undefined;
  education: Education | undefined;
  hasPhoneCodeField: boolean;
}

type Rule = [pattern: RegExp, value: (context: Context) => string | undefined, kinds?: FieldKind[]];

const yesNo = (answer: string) => (answer === "yes" ? "Yes" : answer === "no" ? "No" : undefined);
const none = () => undefined;

function monthYear(yearMonth: string, field: FieldDescriptor): string | undefined {
  if (!yearMonth) return undefined;
  if (field.kind === "date") return yearMonth;
  const [year, month] = yearMonth.split("-");
  if (/\byear\b/i.test(field.label) && !/date/i.test(field.label)) return year;
  return month ? `${month}/${year}` : year;
}

function localPhone({ profile, hasPhoneCodeField }: Context): string | undefined {
  const phone = profile.phone.trim();
  if (!phone) return undefined;
  const code = profile.phoneCountryCode.replace(/\D/g, "");
  const isInternational = phone.startsWith("+");
  if (!hasPhoneCodeField) return isInternational || !code ? phone : `+${code} ${phone}`;
  const digits = phone.replace(/[^\d+]/g, "");
  return isInternational && code && digits.startsWith(`+${code}`) ? digits.slice(code.length + 1) : phone;
}

function phoneCode({ profile, field }: Context): string | undefined {
  if (!profile.phoneCountryCode) return undefined;
  const isChoice = field.kind === "select" || field.kind === "combobox";
  return isChoice && profile.country ? `${profile.country} ${profile.phoneCountryCode}` : profile.phoneCountryCode;
}

function eeo(value: string): string {
  return value || "Decline to self-identify";
}

function hearAbout({ field }: Context): string | undefined {
  if (field.kind === "text" || field.kind === "textarea") return "LinkedIn";
  // options unknown (dropdown not opened yet): the combobox filler tries each alternative in order
  if (!field.options.length) return ["LinkedIn", "Job Board", "Job Site", "Online", "Other"].join(ALTERNATIVES_SEPARATOR);
  const preferred = ["LinkedIn", "Job Board", "Job Site", "Online", "Other"];
  return preferred.find((choice) => matchOption(field.options, choice));
}

function yearsExperience({ profile, field }: Context): string | undefined {
  if (profile.yearsExperience <= 0) return undefined;
  return pickYearsRange(field.options, profile.yearsExperience) ?? String(profile.yearsExperience);
}

/** On a career break the latest role has no employer; forms asking "current company" want the most recent one. */
function currentCompany({ profile }: Context): string | undefined {
  return profile.currentCompany || profile.experience.find((job) => job.company)?.company || undefined;
}

/** "15 days" / "2 weeks" / "1 month"; number inputs labelled "(in days)" get the day count. */
function noticePeriod({ profile, field }: Context): string | undefined {
  if (field.kind === "date" || !profile.noticePeriod) return undefined;
  if (field.kind !== "number") return profile.noticePeriod;
  const amount = Number(profile.noticePeriod.match(/\d+(?:\.\d+)?/)?.[0] ?? (/immediate/i.test(profile.noticePeriod) ? 0 : NaN));
  if (Number.isNaN(amount)) return undefined;
  const daysPerUnit = /month/i.test(profile.noticePeriod) ? 30 : /week/i.test(profile.noticePeriod) ? 7 : 1;
  return String(/\bdays?\b/i.test(field.label) ? amount * daysPerUnit : amount);
}

/** Profile salaries are stored grouped ("1,200,000"); number inputs on job sites reject the commas. */
function salary(amount: string, { field }: Context): string | undefined {
  if (!amount) return undefined;
  return field.kind === "number" ? amount.replace(/,/g, "") : amount;
}

function cityState({ profile }: Context): string | undefined {
  return [profile.city, profile.state].filter(Boolean).join(", ") || undefined;
}

const questionRules: Rule[] = [
  [
    /authori[sz]ed to work.*(sponsor|visa)|(sponsor|visa).*authori[sz]ed to work/,
    ({ profile }) => (profile.workAuthorized && profile.requiresSponsorship ? yesNo(profile.workAuthorized === "yes" && profile.requiresSponsorship === "no" ? "yes" : "no") : undefined),
  ],
  [/sponsor|visa/, ({ profile }) => yesNo(profile.requiresSponsorship)],
  [/(legally |currently )?(authori[sz]ed|eligible|permitted|right) to work|work authori[sz]ation|authori[sz]ed to work/, ({ profile }) => yesNo(profile.workAuthorized)],
  [/relocat/, ({ profile }) => yesNo(profile.willingToRelocate), ["radio", "select", "combobox", "checkbox"]],
  [/\bgender\b|\bsex\b/, ({ profile }) => eeo(profile.gender)],
  [/\brace\b|ethnic|hispanic|latino/, ({ profile }) => eeo(profile.ethnicity)],
  [/veteran|military/, ({ profile }) => eeo(profile.veteranStatus)],
  [/disabilit/, ({ profile }) => eeo(profile.disabilityStatus)],
  [/pronoun/, ({ profile }) => profile.pronouns || undefined],
  [/how did you hear|hear(d)? about|where did you (hear|find|learn)|referral source|source of (application|referral)/, hearAbout],
  [/(current|present|last|existing)( \S+){0,2} (ctc|salary|compensation|pay|package)/, (context) => salary(context.profile.currentSalary, context)],
  [/salary|compensation|desired pay|pay expectation|expected pay|\bctc\b/, (context) => salary(context.profile.salaryExpectation, context)],
  [/notice period|how soon|when (can|could|would) you (start|join)|available to start|earliest (start|available)|availability|start date/, noticePeriod],
  [/years? of (relevant |professional |work |total )?experience|total experience|how many years/, yearsExperience],
];

const contactRules: Rule[] = [
  [/e ?mail/, ({ profile }) => profile.email || undefined],
  [/phone (device )?type|device type/, () => "Mobile"],
  [/country (phone )?code|phone code|dial/, phoneCode],
  [/extension|emergency/, none],
  [/(alternat|secondary|additional|other|second|home)\S* (phone|mobile|telephone|contact|number)/, ({ profile }) => profile.otherPhones[0] || undefined],
  [/phone|mobile|telephone|\bcell\b|contact (number|no)\b/, localPhone],
  [/preferred (first )?name|nick ?name|goes by/, ({ profile }) => profile.firstName || undefined],
  [/middle (initial|i\b)/, ({ profile }) => profile.middleName.slice(0, 1) || undefined],
  [/middle/, ({ profile }) => profile.middleName || undefined],
  [/suffix|prefix/, none],
  [/first name|given name|forename/, ({ profile }) => profile.firstName || undefined],
  [/last name|family name|surname/, ({ profile }) => profile.lastName || undefined],
  [/linkedin/, ({ profile }) => (/linkedin\.com\/./i.test(profile.linkedin) ? profile.linkedin : undefined)],
  [/github/, ({ profile }) => (/github\.com\/./i.test(profile.github) ? profile.github : undefined)],
  [/(company|employer|organi[sz]ation) (website|url|size|address|phone)/, none],
  [/portfolio/, ({ profile }) => profile.portfolio || profile.website || undefined],
  [/website|web site|personal (site|page)|homepage|\burl\b/, ({ profile }) => profile.website || profile.portfolio || undefined],
];

const educationRules: Rule[] = [
  [/school|university|college|institution/, ({ education }) => education?.school || undefined],
  [/\bdegree\b|qualification/, ({ education }) => education?.degree || undefined],
  [/field of study|major|discipline|area of study|specializ/, ({ education }) => education?.field || undefined],
  [/\bgpa\b|grade point/, ({ education }) => education?.gpa || undefined],
];

const educationDateRules: Rule[] = [
  [/graduat|\bto\b|\bend\b|completion|through/, ({ education, field }) => monthYear(education?.end ?? "", field)],
  [/\bfrom\b|start|begin/, ({ education, field }) => monthYear(education?.start ?? "", field)],
];

const experienceRules: Rule[] = [
  [/currently|current(ly)? work|present/, ({ experience }) => (experience ? String(experience.current) : undefined), ["checkbox"]],
  [/job title|title|position|role\b/, ({ experience }) => experience?.title || undefined],
  [/company|employer|organi[sz]ation/, ({ experience }) => experience?.company || undefined],
  [/location/, ({ experience }) => experience?.location || undefined],
  [/description|responsibilit|duties|summary/, ({ experience }) => experience?.description || undefined],
  [/\bfrom\b|start|begin/, ({ experience, field }) => monthYear(experience?.start ?? "", field)],
  [/\bto\b|\bend\b|through|until/, ({ experience, field }) => (experience?.current ? undefined : monthYear(experience?.end ?? "", field))],
];

const generalRules: Rule[] = [
  // short labels only: "...with your current employer or a past employer?" is a question, not the employer field
  [/^(\S+ ){0,3}(company|employer|organi[sz]ation)( \S+){0,2}$|^org$/, currentCompany],
  [/current (job )?title|current position|current role|job title|position title|\btitle\b/, ({ profile }) => profile.currentTitle || undefined, ["text", "combobox", "textarea"]],
  [/address line 2|address 2|\bapt\b|suite|unit number|street 2/, none],
  [/address line 1|address 1|street|address/, ({ profile }) => profile.address || undefined],
  [/\bcity\b|\btown\b/, ({ profile }) => profile.city || undefined],
  [/\bstate\b|province|region/, ({ profile }) => profile.state || undefined],
  [/postal|\bzip\b|post ?code/, ({ profile }) => profile.postalCode || undefined],
  [/citizen|nationality/, none],
  [/country/, ({ profile }) => profile.country || undefined],
  [/^location|current location|where are you (based|located)|current residence|city and state/, cityState],
  [/professional summary|about yourself|about you\b/, ({ profile }) => profile.summary || undefined],
];

// ---------- orchestration ----------

function sectionIndex(section: string): number {
  const number = section.match(/\d+/)?.[0];
  return number ? Math.max(0, Number(number) - 1) : 0;
}

function fieldTexts(field: FieldDescriptor): string[] {
  const parts = [field.name, field.automationId, field.placeholder];
  const split = parts.map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2"));
  return [normalize(field.label), normalize([field.label, ...parts, ...split].join(" "))];
}

function isExactName(field: FieldDescriptor): boolean {
  return [field.label, field.name, field.automationId].some((part) => /^(full |your |legal |candidate |applicant )?name$/.test(normalize(part.replace(/([a-z])([A-Z])/g, "$1 $2"))));
}

const LONG_LABEL_WORDS = 14;

function ruleSets(field: FieldDescriptor): Rule[][] {
  // a long label is a question, not a field name: "...list references with name, title..." must not hit the title rule
  if (field.label.split(/\s+/).length > LONG_LABEL_WORDS) return field.kind === "text" || field.kind === "url" ? [questionRules, contactRules, educationRules] : [questionRules, educationRules];
  const sets: Rule[][] = [];
  if (/experience|employment history|work history|previous employ/i.test(field.section)) sets.push(experienceRules);
  if (/education|academic|school/i.test(field.section)) sets.push(educationDateRules);
  sets.push(questionRules, contactRules, educationRules);
  if (/graduat/i.test(field.label)) sets.push(educationDateRules);
  sets.push(generalRules);
  return sets;
}

function lookup(field: FieldDescriptor, context: Context): string | undefined {
  if (isExactName(field)) return [context.profile.firstName, context.profile.lastName].filter(Boolean).join(" ") || undefined;
  const sets = ruleSets(field);
  for (const text of fieldTexts(field)) {
    for (const set of sets) {
      for (const [pattern, value, kinds] of set) {
        if (!pattern.test(text) || (kinds && !kinds.includes(field.kind))) continue;
        return value(context);
      }
    }
  }
  return undefined;
}

const isChoice = (field: FieldDescriptor) => field.options.length > 0 && field.kind !== "text" && field.kind !== "textarea";

/** Snap a wanted value to a real option text; undefined when a choice field has no matching option. */
function resolveChoice(field: FieldDescriptor, value: string): string | undefined {
  if (field.kind === "checkbox" && field.options.length <= 1) return value;
  if (!isChoice(field)) return value;
  if (field.kind === "checkbox") return resolveEach(field.options, value);
  return matchOption(field.options, value);
}

/** Checkbox groups take several options: snap each ` | `-joined part and keep the ones that exist. */
function resolveEach(options: string[], value: string): string | undefined {
  const matched = value.split(ALTERNATIVES_SEPARATOR).flatMap((part) => matchOption(options, part) ?? []);
  return matched.length ? [...new Set(matched)].join(ALTERNATIVES_SEPARATOR) : undefined;
}

/** Questions like `select "Other (School Not Listed)" if yours is missing` name the fallback option themselves. */
function namedOtherOption(field: FieldDescriptor): string | undefined {
  return /\bother\b/i.test(field.label) ? field.options.find((option) => /^other\b/i.test(option.trim())) : undefined;
}

function hasFilledValue(field: FieldDescriptor): boolean {
  const value = field.currentValue.trim();
  return value !== "" && !(field.kind === "checkbox" && value === "false");
}

function fileFill(field: FieldDescriptor, resume: Resume | null | undefined): Pick<FieldFill, "value" | "source"> | undefined {
  const text = normalize(`${field.label} ${field.name} ${field.automationId}`);
  if (/cover letter|coverletter|transcript|portfolio|writing sample|photo|picture|reference|certificate/.test(text) || !resume?.fileBase64) return undefined;
  return { value: "resume", source: "resume" };
}

/** Sign-in / create-account pages: passwords from settings, and the account email for the email / username field. */
function accountFill(field: FieldDescriptor, account: AccountLogin | undefined): Pick<FieldFill, "value" | "source"> | undefined {
  if (field.kind === "password") return account?.password ? { value: account.password, source: "profile" } : undefined;
  const text = normalize(`${field.label} ${field.name} ${field.automationId} ${field.placeholder}`);
  const isLogin = field.kind === "email" || /e ?mail|user ?name|user ?id|login/.test(text);
  return isLogin && account?.email ? { value: account.email, source: "profile" } : undefined;
}

export function map(fields: FieldDescriptor[], profile: Profile, answers: AnswerBank, resume?: Resume | null, account?: AccountLogin): FieldFill[] {
  const hasPhoneCodeField = fields.some((field) => /country (phone )?code|phone code/.test(normalize(field.label)));
  const isAccountForm = fields.some((field) => field.kind === "password");
  const fills: FieldFill[] = [];
  for (const field of fields) {
    if (hasFilledValue(field)) continue;
    const fromAccount = isAccountForm ? accountFill(field, account) : undefined;
    const fill = fromAccount ?? (field.kind === "file" ? fileFill(field, resume) : field.kind === "password" ? undefined : fromBankOrProfile(field, profile, answers, hasPhoneCodeField));
    if (fill) fills.push({ id: field.id, frameId: field.frameId, ...fill });
  }
  return fills;
}

function fromBankOrProfile(
  field: FieldDescriptor,
  profile: Profile,
  answers: AnswerBank,
  hasPhoneCodeField: boolean,
): Pick<FieldFill, "value" | "source"> | undefined {
  const banked = answers[normalize(field.label)]?.answer;
  const bankedValue = banked ? resolveChoice(field, banked) : undefined;
  if (bankedValue) return { value: bankedValue, source: "answers" };

  const context: Context = {
    field,
    profile,
    experience: profile.experience[sectionIndex(field.section)],
    education: profile.education[sectionIndex(field.section)],
    hasPhoneCodeField,
  };
  const looked = lookup(field, context);
  const wanted = field.kind === "number" && looked ? looked.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] : looked;
  const value = wanted ? (resolveChoice(field, wanted) ?? namedOtherOption(field)) : undefined;
  return value ? { value, source: "profile" } : undefined;
}
