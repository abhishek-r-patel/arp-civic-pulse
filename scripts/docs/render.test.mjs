// Regression checks for safe offline and public guide rendering.
import assert from "node:assert/strict";
import { test } from "node:test";
import { guideDocument, guideLink, renderMarkdown } from "./render.mjs";

const options = {
  link: (target) => target,
  image: () => ({ src: "data:image/png;base64,AA==", mobile: true }),
};

test("web guide shares the app favicon without adding network dependencies to offline editions", () => {
  const rendered = renderMarkdown("# Guide\n", options);
  const icon = '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">';
  assert.ok(guideDocument(rendered, true).includes(icon));
  assert.ok(!guideDocument(rendered).includes('href="/icon.svg"'));
});

test("web guide links retain contents and HTTPS but do not expose repository documents", () => {
  assert.equal(guideLink("./USER_GUIDE.md#1-start", true), "/user-guide.html#1-start");
  assert.equal(guideLink("./USER_GUIDE.html", true), "/user-guide.html");
  assert.equal(guideLink("#1-start", true), "#1-start");
  assert.equal(guideLink("https://example.test/help", true), "https://example.test/help");
  for (const target of ["./TECHNICAL_GUIDE.md", "./LAUNCH_AUDIT.md", "../src/app/page.tsx", "javascript:alert"]) {
    assert.equal(guideLink(target, true), null);
  }
  assert.equal(guideLink("./TECHNICAL_GUIDE.md#stack"), "./TECHNICAL_GUIDE.html#stack");
  const { html } = renderMarkdown("# Guide\n\n[Technical guide](./TECHNICAL_GUIDE.md) and [Contents](#start).", { ...options, link: (target) => guideLink(target, true) });
  assert.ok(html.includes("Technical guide and"));
  assert.ok(!html.includes('href="./TECHNICAL_GUIDE'));
  assert.ok(html.includes('href="#start"'));
});

test("public screenshots can defer loading without changing offline screenshots", () => {
  const source = "# Guide\n\n![Example screen](./image.png)\n";
  const { html } = renderMarkdown(source, { ...options, image: () => ({ ...options.image(), lazy: true }) });
  assert.ok(html.includes('loading="lazy" decoding="async"'));
  assert.ok(!renderMarkdown(source, options).html.includes('loading="lazy"'));
});

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

test("contents nests task subsections under each top-level section", () => {
  const rendered = renderMarkdown(
    "# Guide\n\n## Resident Persona\n\n### Find votes\n\n### Submit ballot\n\n## RWA Admin Persona\n\n### Review accounts\n",
    options,
  );
  const document = guideDocument(rendered);
  assert.ok(
    document.includes(
      '<li><a href="#resident-persona">Resident Persona</a><ol><li><a href="#find-votes">Find votes</a></li><li><a href="#submit-ballot">Submit ballot</a></li></ol></li>',
    ),
  );
  assert.ok(
    document.includes(
      '<li><a href="#rwa-admin-persona">RWA Admin Persona</a><ol><li><a href="#review-accounts">Review accounts</a></li></ol></li>',
    ),
  );
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
