import * as llm from "../../ai/llm.ts";
import * as storage from "../../storage.ts";
import * as aiContext from "./aiContext.ts";

/** Like aiContext.run, but for tasks that work without a stored resume (LinkedIn import, role suggestions). */
export async function withClient<T>(task: (client: llm.LlmClient) => Promise<T>): Promise<T> {
  const settings = await storage.get("settings");
  try {
    const result = await task(llm.create(settings.provider));
    aiContext.report("ok");
    return result;
  } catch (failure) {
    aiContext.report("error");
    throw failure;
  }
}
