import { expect, test } from "bun:test";
import { toHtml } from "../../src/panel/documents/markdown.ts";

test("renders headings, bullets, bold and paragraphs", () => {
  const html = toHtml("# Name\n\nHello **world**\nsecond line\n\n- one\n- two\n\n## Skills");
  expect(html).toBe("<h1>Name</h1>\n<p>Hello <strong>world</strong><br>second line</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<h2>Skills</h2>");
});

test("escapes html", () => {
  expect(toHtml("- <script>alert(1)</script> & \"q\"")).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
});
