import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "./render.mjs";

const options = {
  link: (target) => target,
  image: () => ({ src: "data:image/png;base64,AA==", mobile: true }),
};

test("renders accessible headings, lists, tables, links and fenced code", () => {
  const { html, headings } = renderMarkdown(
    "# Guide\n\n## 1. Start\n\nText **strong** and `code` with [help](./help.md).\n\n- One\n- Two\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| x | y |\n\n```text\nvalue < 2\n```\n",
    options,
  );
  assert.deepEqual(
    headings.map(({ id }) => id),
    ["guide", "1-start"],
  );
  for (const fragment of [
    'id="1-start"',
    "<strong>strong</strong>",
    "<code>code</code>",
    'href="./help.md"',
    "<ul>",
    "<ol>",
    "<thead>",
    "<tbody>",
    "value &lt; 2",
  ]) {
    assert.ok(html.includes(fragment), fragment);
  }
});

test("escapes raw markup, inline values, code and link attributes", () => {
  const { html } = renderMarkdown(
    '# Guide\n\n<script>alert("x")</script> **<b>** `<i>` [x](./a"b.md)\n',
    options,
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>&lt;b&gt;</strong>"));
  assert.ok(html.includes("<code>&lt;i&gt;</code>"));
  assert.ok(html.includes('href="./a&quot;b.md"'));
});

test("renders an embedded mobile image with alt text and visible caption", () => {
  const { html } = renderMarkdown(
    "# Guide\n\n![Example screen](./image.png)\n",
    options,
  );
  assert.ok(html.includes('class="phone"'));
  assert.ok(html.includes('alt="Example screen"'));
  assert.ok(html.includes("<figcaption>Example screen</figcaption>"));
  assert.ok(html.includes('src="data:image/png;base64,AA=="'));
});

test("rejects duplicate headings, missing titles and malformed authored blocks", () => {
  assert.throws(
    () => renderMarkdown("# Guide\n\n## Same\n\n## Same", options),
    /Duplicate heading/,
  );
  assert.throws(
    () => renderMarkdown("## Not a title", options),
    /begin with a title/,
  );
  assert.throws(
    () => renderMarkdown("# Guide\n\n```\nmissing", options),
    /Unclosed code fence/,
  );
  assert.throws(
    () => renderMarkdown("# Guide\n\n| A |", options),
    /Missing table separator/,
  );
  assert.throws(
    () => renderMarkdown("# Guide\n\n![Broken](./x.png) trailing", options),
    /Unsupported Markdown/,
  );
});
