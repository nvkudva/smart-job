import { describe, expect, test } from "bun:test";
import * as tasks from "../../src/ai/tasks.ts";
import * as layout from "../../src/resume/layout.ts";
import * as preview from "../../src/resume/preview.ts";
import * as rewrite from "../../src/resume/rewrite.ts";
import { emptyProfile } from "../../src/storage.ts";
import type { JobPosting } from "../../src/types.ts";
import { FakeLlm } from "./fakeLlm.ts";

const regular: layout.FontFace = { family: "sans", isBold: false, isItalic: false };
const bold: layout.FontFace = { ...regular, isBold: true };
const charWidth = 4.5;

function item(str: string, x: number, y: number, face = regular, fontSize = 9): layout.RawItem {
  return { str, x, y, width: str.length * charWidth, fontSize, face };
}

const measurer: rewrite.Measurer = {
  width: (text, _face, size) => text.length * size * 0.5,
  canEncode: (char) => char.charCodeAt(0) < 256,
};

const longText = "Led a team of platform engineers building payments infrastructure used across several business lines";
const wrapped = "and regions while mentoring managers";

/** header, a one-line bullet, a two-line bullet and a dated heading, all in a 500pt wide column */
function sampleItems(): layout.RawItem[] {
  return [
    item("Jane Doe jane@x.com +1 650 772 1555 and more words in the contact line here", 40, 780),
    item("Acme Corp (Jan 2018 – Present · 7 Years) heading with enough words to look like prose", 40, 740, bold),
    item("•", 45, 700),
    item(longText, 54, 700),
    item("•", 45, 686),
    item("Cut cloud spend by 30% across 12 services.", 54, 686),
    item("•", 45, 672),
    item(longText.padEnd(111, "x"), 54, 672),
    item(wrapped, 54, 658),
  ];
}

describe("layout", () => {
  const lines = layout.buildLines(sampleItems());
  const blocks = layout.buildBlocks(lines, 1);

  test("bullets with wrapped lines become one block; headings and contact lines are skipped", () => {
    expect(blocks.map((block) => block.lines.length)).toEqual([1, 1, 2]);
    expect(blocks[2]!.text).toContain(wrapped);
    expect(blocks.some((block) => block.text.includes("Acme Corp") || block.text.includes("jane@x.com"))).toBe(false);
  });

  test("the bullet glyph stays outside the editable text", () => {
    expect(blocks[0]!.left).toBe(54);
    expect(blocks[0]!.lines[0]!.hasMarker).toBe(true);
    expect(blocks[0]!.text.startsWith("Led a team")).toBe(true);
  });

  test("a wide gap splits one baseline into separate lines", () => {
    const row = layout.buildLines([item("Left title", 40, 500), item("Dates", 500, 500)]);
    expect(row.map(layout.lineText)).toEqual(["Left title", "Dates"]);
  });

  test("bold words inside a regular block are remembered for redrawing", () => {
    const mixed = layout.buildBlocks(layout.buildLines([item("•", 45, 600), item("Cut spend by", 54, 600), item("30%", 100, 600, bold), item("across twelve services", 120, 600)]), 1);
    expect(mixed[0]!.boldWords).toEqual(["30"]);
  });

  test("blocks over link annotations are left alone", () => {
    const linked = layout.withoutLinked(blocks, [[100, 695, 140, 712]]);
    expect(linked).toHaveLength(2);
    expect(linked.map((block) => block.id)).not.toContain(blocks[0]!.id);
  });

  test("faceFromName reads weight, slant and family from the PDF font name", () => {
    expect(layout.faceFromName("ABCDEF+DMSans-BoldItalic", false, false)).toEqual({ family: "sans", isBold: true, isItalic: true });
    expect(layout.faceFromName("TimesNewRomanPSMT", false, false).family).toBe("serif");
    expect(layout.faceFromName("Consolas", false, false).family).toBe("mono");
    expect(layout.faceFromName("", true, false).family).toBe("serif");
  });

  test("inkColor averages the darkest pixels and ignores white", () => {
    const pixels = new Uint8ClampedArray(40 * 4);
    for (let index = 0; index < 40; index++) pixels.set(index < 20 ? [67, 67, 67, 255] : [255, 255, 255, 255], index * 4);
    const color = layout.inkColor([pixels])!;
    expect(Math.round(color.r * 255)).toBe(67);
    expect(layout.inkColor([new Uint8ClampedArray(16).fill(255)])).toBeNull();
  });
});

describe("rewrite", () => {
  const resume: layout.Layout = (() => {
    const lines = layout.buildLines(sampleItems());
    return { pages: [{ page: 1, lines, blocks: layout.buildBlocks(lines, 1) }] };
  })();
  const [oneLine, secondBullet, twoLines] = resume.pages[0]!.blocks as [layout.Block, layout.Block, layout.Block];

  test("describe tags editable blocks with id, lines and a character budget", () => {
    const text = rewrite.describe(resume);
    expect(text).toContain(`[${oneLine.id} | 1 line |`);
    expect(text).toContain(`[${twoLines.id} | 2 lines |`);
    expect(text).toContain("Acme Corp");
  });

  test("parse keeps well-formed rewrites only", () => {
    const raw = { rewrites: [{ id: "b1", newText: "x", reason: "r" }, { id: "", newText: "y" }, "junk", { id: "b2", text: "alt key" }] };
    expect(rewrite.parse(raw).map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(rewrite.parse(null)).toEqual([]);
  });

  test("clean maps symbols, strips markdown and bullets, drops unencodable characters", () => {
    expect(rewrite.clean("• **Cut** cost → 30% ≥ goal 🚀", measurer)).toBe("Cut cost -> 30% >= goal");
  });

  test("wrap breaks greedily and refuses a word wider than the line", () => {
    const widthOf = (text: string) => text.length * 10;
    expect(rewrite.wrap(["aaa", "bbb", "ccc"], 70, widthOf)).toEqual(["aaa bbb", "ccc"]);
    expect(rewrite.wrap(["aaaaaaaaaa"], 50, widthOf)).toBeNull();
  });

  test("a fitting rewrite is placed on the original lines", () => {
    const text = "Led platform engineers building payments infrastructure across business lines";
    const { placements, overlong } = rewrite.validate([{ id: oneLine.id, newText: text, reason: "keywords" }], resume, measurer);
    expect(overlong).toEqual([]);
    expect(placements[0]!.lines).toEqual([text]);
  });

  test("a rewrite longer than the original line count is reported as overlong", () => {
    const text = `${longText} ${longText} ${longText} ${longText} ${longText}`;
    const { placements, overlong } = rewrite.validate([{ id: oneLine.id, newText: text, reason: "" }], resume, measurer);
    expect(placements).toEqual([]);
    expect(overlong[0]!.maxChars).toBeGreaterThan(50);
  });

  test("unchanged text, invented numbers, unrelated text, unknown ids and duplicates are rejected", () => {
    const attempts = [
      { id: secondBullet.id, newText: secondBullet.text, reason: "" },
      { id: secondBullet.id, newText: "Cut cloud spend by 45% across 12 services.", reason: "" },
      { id: secondBullet.id, newText: "Organized quarterly offsites for remote colleagues", reason: "" },
      { id: "nope", newText: "Cut cloud spend by 30% across services", reason: "" },
    ];
    expect(rewrite.validate(attempts, resume, measurer).placements).toEqual([]);
    const good = { id: secondBullet.id, newText: "Reduced cloud spend by 30% across 12 platform services.", reason: "" };
    expect(rewrite.validate([good, good], resume, measurer).placements).toHaveLength(1);
  });

  test("preview changes carry highlight rectangles on the original lines", () => {
    const text = "Led platform engineers building payments infrastructure across business lines";
    const { placements } = rewrite.validate([{ id: oneLine.id, newText: text, reason: "keywords" }], resume, measurer);
    const [change] = preview.changesOf(placements);
    expect(change).toMatchObject({ before: oneLine.text, after: text, page: 1, reason: "keywords" });
    expect(change!.rects[0]!.x).toBe(54);
    expect(preview.toPercent({ x: 0, y: 0, width: 298, height: 421 }, [0, 0, 596, 842])).toEqual({ left: "0%", top: "50%", width: "50%", height: "50%" });
  });
});

describe("tailorPdf", () => {
  const job: JobPosting = { id: "1", url: "https://x.test/1", title: "Platform Engineer", company: "Globex", location: "", description: "Build payments platform with Kubernetes.", salaryText: "", employmentType: "", source: "generic" };
  const candidate = { profile: { ...emptyProfile, skills: ["Kubernetes"] }, resumeText: "" };
  const lines = layout.buildLines(sampleItems());
  const resume: layout.Layout = { pages: [{ page: 1, lines, blocks: layout.buildBlocks(lines, 1) }] };
  const first = resume.pages[0]!.blocks[0]!;
  const tooLong = `${longText} ${longText} ${longText} ${longText} ${longText}`;

  test("overlong rewrites get one shortening retry, the rest are dropped", async () => {
    const fake = new FakeLlm([
      JSON.stringify({ rewrites: [{ id: first.id, newText: tooLong, reason: "kw" }] }),
      JSON.stringify({ rewrites: [{ id: first.id, newText: "Led platform engineers building payments infrastructure", reason: "kw" }] }),
    ]);
    const placements = await tasks.tailorPdf(fake, job, candidate, resume, measurer);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]!.user).toContain(`[${first.id} |`);
    expect(placements.map((placement) => placement.lines.join(" "))).toEqual(["Led platform engineers building payments infrastructure"]);
  });

  test("a rewrite that names a skill the candidate never mentions is dropped", async () => {
    const fake = new FakeLlm([JSON.stringify({ rewrites: [{ id: first.id, newText: "Led platform work on Kubernetes and Terraform", reason: "kw" }] })]);
    expect(await tasks.tailorPdf(fake, { ...job, description: "Kubernetes and Terraform" }, candidate, resume, measurer)).toEqual([]);
  });

  test("a failing retry drops the overlong rewrite instead of throwing", async () => {
    const fake = new FakeLlm([JSON.stringify({ rewrites: [{ id: first.id, newText: tooLong, reason: "kw" }] }), "not json", "still not json"]);
    expect(await tasks.tailorPdf(fake, job, candidate, resume, measurer)).toEqual([]);
  });
});
