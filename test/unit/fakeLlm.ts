import type { ChatRequest, LlmClient } from "../../src/ai/llm.ts";

/** Returns canned replies in order (last one repeats) and records requests. */
export class FakeLlm implements LlmClient {
  requests: ChatRequest[] = [];
  private index = 0;
  constructor(private replies: string[]) {}
  async chat(request: ChatRequest): Promise<string> {
    this.requests.push(request);
    const reply = this.replies[Math.min(this.index++, this.replies.length - 1)] ?? "";
    return reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
}
