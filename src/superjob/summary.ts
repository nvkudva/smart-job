import * as llm from "../ai/llm.ts";
import * as normalize from "../ai/normalize.ts";
import type { FoundJob } from "./jobSources.ts";

const maxBullets = 5;
const maxDescriptionChars = 6000;

const summarySystem = `You summarise a job posting for a job seeker. Reply with JSON: {"bullets":[string]}
Rules: 3 to 5 short bullets, plain language, in this order: what the role is, the key requirements, then anything notable (salary, remote or hybrid, seniority, visa, deadlines).
Use only what the posting says. Do not invent details. No markdown inside the bullets.`;

export function parseBullets(raw: unknown): string[] {
  return normalize.asStringList(normalize.asRecord(raw).bullets, maxBullets);
}

export async function summarize(client: llm.LlmClient, job: FoundJob, description: string): Promise<string[]> {
  const header = [`Title: ${job.title}`, `Company: ${job.company}`, `Location: ${job.location}`, `Salary: ${job.salary}`].join("\n");
  const user = `${header}\n\nPosting:\n${normalize.truncate(normalize.compact(description), maxDescriptionChars)}`;
  const raw = await llm.chatJson<unknown>(client, { system: summarySystem, user, maxTokens: normalize.tokenBudget });
  return parseBullets(raw);
}
