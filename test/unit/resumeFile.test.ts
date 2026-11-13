import { expect, test } from "bun:test";
import * as resumeFile from "../../src/profile/resumeFile.ts";

test("link annotations missing from the text are appended under Links", () => {
  const text = "Jane Doe  Linkedin GitHub\nhttps://jane.dev";
  expect(resumeFile.withLinks(text, ["https://www.linkedin.com/in/jane/", "https://jane.dev"])).toBe(`${text}\n\nLinks\nhttps://www.linkedin.com/in/jane/`);
  expect(resumeFile.withLinks(text, [])).toBe(text);
});
