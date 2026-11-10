// Manual: bun test/live/ai.live.ts  (needs LM Studio at localhost:1234 with qwen3.5-4b-mlx)
import * as llm from "../../src/ai/llm.ts";
import * as tasks from "../../src/ai/tasks.ts";
import type { FieldDescriptor, JobPosting } from "../../src/types.ts";

const client = llm.create({ kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen3.5-4b-mlx" });

const resumeText = `Priya Sharma
priya.sharma@example.com | +91 98765 43210 | Bengaluru, Karnataka, India
linkedin.com/in/priyasharma | github.com/priyasharma

SUMMARY
Backend engineer with 6 years of experience building payment and data platforms.

EXPERIENCE
Senior Software Engineer, Razorpay, Bengaluru (Jun 2021 - Present)
- Designed Python/FastAPI services processing 2M transactions/day on AWS (ECS, RDS PostgreSQL).
- Led migration of cron jobs to Airflow, cutting failures by 40%.
- Mentored 4 junior engineers; ran stakeholder reviews with product and finance.

Software Engineer, Infosys, Pune (Jul 2018 - May 2021)
- Built Java Spring Boot REST APIs for a retail client; wrote JUnit tests; used Jenkins CI/CD.

EDUCATION
B.E. Computer Science, Pune Institute of Technology (2014 - 2018), GPA 8.4

SKILLS
Python, Java, FastAPI, Spring Boot, PostgreSQL, Airflow, AWS, Docker, Kafka, Redis`;

const job: JobPosting = {
  id: "live-1", url: "https://example.com/jobs/1", title: "Senior Backend Engineer", company: "Stripe", location: "Bengaluru, India",
  salaryText: "", employmentType: "Full-time", source: "generic",
  description: `Stripe is hiring a Senior Backend Engineer for our payments platform in Bengaluru.
You will design reliable distributed services, own on-call, and mentor engineers.
Must have: 5+ years backend experience, strong Python or Java, SQL and PostgreSQL, experience with AWS, REST APIs, and distributed systems.
Nice to have: Kubernetes, Terraform, Kafka, Go, experience in fintech.`,
};

const field = (id: string, patch: Partial<FieldDescriptor>): FieldDescriptor => ({ id, frameId: 0, kind: "text", label: id, name: "", placeholder: "", automationId: "", required: false, options: [], currentValue: "", section: "", ...patch });
const fields = [
  field("f1", { kind: "radio", label: "Are you legally authorized to work in India?", options: ["Yes", "No"] }),
  field("f2", { kind: "select", label: "Gender", section: "Voluntary self-identification", options: ["Male", "Female", "Non-binary", "I don't wish to answer"] }),
  field("f3", { kind: "textarea", label: "Why do you want to work at Stripe?", required: true }),
  field("f4", { kind: "text", label: "How many years of Python experience do you have?" }),
];

const timed = async <T>(name: string, run: () => Promise<T>): Promise<void> => {
  const start = performance.now();
  try {
    const result = await run();
    console.log(`\n== ${name}: OK ${((performance.now() - start) / 1000).toFixed(1)}s\n${JSON.stringify(result, null, 1).slice(0, 1500)}`);
  } catch (error) {
    console.log(`\n== ${name}: FAIL ${((performance.now() - start) / 1000).toFixed(1)}s\n${error instanceof Error ? error.message : error}`);
  }
};

// optional filter: bun test/live/ai.live.ts profile salary
const only = process.argv.slice(2);
const wanted = (name: string) => only.length === 0 || only.some((item) => name.toLowerCase().includes(item));
const { emptyProfile } = await import("../../src/storage.ts");
let candidate: tasks.CandidateContext = { profile: emptyProfile, resumeText };

if (wanted("extractProfile") || wanted("profile")) {
  await timed("extractProfile", async () => {
    const profile = await tasks.extractProfile(client, resumeText);
    candidate = { profile, resumeText };
    return profile;
  });
}
if (wanted("analyzeJob")) await timed("analyzeJob", () => tasks.analyzeJob(client, job, candidate));
if (wanted("salary")) await timed("estimateSalary(web)", () => tasks.estimateSalary(client, job, { webSearch: true }));
if (wanted("answerFields")) await timed("answerFields", () => tasks.answerFields(client, fields, candidate, job));
if (wanted("coverLetter")) await timed("writeCoverLetter", () => tasks.writeCoverLetter(client, job, candidate, { tone: "professional", words: 150 }));
