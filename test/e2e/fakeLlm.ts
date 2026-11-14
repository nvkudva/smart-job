/** Fake OpenAI-compatible server: canned replies picked by keywords in the system prompt. */
const analysis = {
  mustHave: [{ requirement: "TypeScript experience", met: "yes" }, { requirement: "Testing with Playwright", met: "partial" }],
  niceToHave: [{ requirement: "Preact", met: "yes" }],
  seniority: "match",
  blockers: [],
  strengths: ["Strong TypeScript background"],
  gaps: ["No Playwright on resume"],
  reason: "Core stack matches; Playwright is the only gap",
  overview: { company: [], position: ["You get to build browser extensions with TypeScript"] },
};
const salary = { min: 120000, max: 150000, currency: "USD", period: "year", note: "Fake estimate" };
const profile = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  skills: ["TypeScript", "Preact"],
  experience: [{ title: "Engineer", company: "Analytical Engines", location: "", start: "2020-01", end: "", current: true, description: "Built things" }],
  education: [],
};
const tailored = {
  markdown: "# Ada Lovelace\n\n## Summary\nTypeScript **engineer**.\n\n- Built things <b>safely</b>",
  changes: [{ before: "Built things", after: "Built things safely", reason: "Match the job wording" }],
};

function reply(system: string): string {
  const prompt = system.toLowerCase();
  if (prompt.includes("recruiter assessing")) return JSON.stringify(analysis);
  if (prompt.includes("structured profile")) return JSON.stringify(profile);
  if (prompt.includes("tailor a resume")) return JSON.stringify(tailored);
  if (prompt.includes("cover letters")) return "Dear Hiring Team,\n\nFake cover letter for Globex.\n\nAda Lovelace";
  if (prompt.includes("application question")) return "Fake answer to your question.";
  if (prompt.includes("salary")) return JSON.stringify(salary);
  if (prompt.includes("form fields")) return JSON.stringify({ answers: {} });
  return "OK";
}

export interface FakeLlm {
  /** value for ProviderSettings.baseUrl */
  baseUrl: string;
  /** system prompts received, in order */
  requests: string[];
  stop(): void;
}

export function start(): FakeLlm {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      requests.push(system);
      return Response.json({ choices: [{ message: { content: reply(system) } }] });
    },
  });
  return { baseUrl: `http://localhost:${server.port}/v1`, requests, stop: () => server.stop(true) };
}
