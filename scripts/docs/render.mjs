import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const guides = ["TECHNICAL_GUIDE", "USER_GUIDE"];

function escape(value) {
  return value.replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character];
  });
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function contained(directory, path) {
  const child = relative(directory, path);
  return (
    child !== ".." &&
    !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(child)
  );
}

// This is a renderer for our two authored guides, not a general Markdown engine.
export function renderMarkdown(source, { link, image }) {
  function inline(value) {
    const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    let rendered = "";
    let start = 0;
    for (const match of value.matchAll(tokens)) {
      rendered += escape(value.slice(start, match.index));
      const token = match[0];
      if (token.startsWith("`")) {
        rendered += `<code>${escape(token.slice(1, -1))}</code>`;
      } else if (token.startsWith("**")) {
        rendered += `<strong>${escape(token.slice(2, -2))}</strong>`;
      } else {
        const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        rendered += `<a href="${escape(link(parts[2]))}">${escape(parts[1])}</a>`;
      }
      start = match.index + token.length;
    }
    return rendered + escape(value.slice(start));
  }

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const headings = [];
  const ids = new Set();
  const startsBlock = (line) => /^(#{1,3} |```|!\[|\||- |\d+\. )/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = slug(heading[2]);
      if (ids.has(id)) throw new Error(`Duplicate heading: ${id}`);
      ids.add(id);
      headings.push({ level, id, title: heading[2] });
      blocks.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (line.startsWith("```")) {
      const code = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```"))
        code.push(lines[index++]);
      if (index === lines.length) throw new Error("Unclosed code fence");
      blocks.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      index++;
      continue;
    }
    const picture = /^!\[([^\]]+)\]\(([^)]+)\)$/.exec(line);
    if (picture) {
      const asset = image(picture[2]);
      blocks.push(
        `<figure class="${asset.mobile ? "phone" : "wide"}"><img src="${escape(asset.src)}" alt="${escape(picture[1])}"><figcaption>${escape(picture[1])}</figcaption></figure>`,
      );
      index++;
      continue;
    }
    if (line.startsWith("|")) {
      if (!/^\|[ :|-]+\|$/.test(lines[index + 1] ?? ""))
        throw new Error("Missing table separator");
      const cells = (row, tag) =>
        row
          .slice(1, -1)
          .split("|")
          .map((cell) => `<${tag}>${inline(cell.trim())}</${tag}>`)
          .join("");
      const header = `<thead><tr>${cells(line, "th")}</tr></thead>`;
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|"))
        rows.push(`<tr>${cells(lines[index++], "td")}</tr>`);
      blocks.push(
        `<div class="table-scroll"><table>${header}<tbody>${rows.join("")}</tbody></table></div>`,
      );
      continue;
    }
    const list = /^(-|\d+\.) (.+)$/.exec(line);
    if (list) {
      const tag = list[1] === "-" ? "ul" : "ol";
      const pattern = tag === "ul" ? /^- (.+)$/ : /^\d+\. (.+)$/;
      const items = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        items.push(`<li>${inline(item[1])}</li>`);
        index++;
      }
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    if (startsBlock(line))
      throw new Error(`Unsupported Markdown block: ${line}`);
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines[index])
    )
      paragraph.push(lines[index++]);
    blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  if (headings[0]?.level !== 1)
    throw new Error("Guide must begin with a title");
  return { html: blocks.join("\n"), headings };
}

const css = `
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #12253b; background: #f3f6f8; line-height: 1.65; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 1080px; margin: 24px auto; padding: 40px; background: white; }
h1, h2, h3 { line-height: 1.25; scroll-margin-top: 20px; }
h1 { font-size: 2.1rem; } h2 { margin-top: 2.5rem; border-bottom: 2px solid #dce7ec; padding-bottom: .5rem; }
a { color: #086b70; text-underline-offset: .16em; overflow-wrap: anywhere; }
a:focus-visible { outline: 3px solid #147c81; outline-offset: 3px; }
p, li, td, th, code, figcaption { overflow-wrap: anywhere; }
li { margin: .45rem 0; }
code { background: #eef3f6; border-radius: 3px; padding: .1em .25em; }
pre { background: #eef3f6; padding: 16px; white-space: pre-wrap; font-size: .85rem; }
pre code { padding: 0; }
nav { border: 1px solid #cbd8df; background: #f7fafb; padding: 20px; }
nav ol { padding-left: 1.5rem; }
figure { margin: 24px auto 32px; border: 1px solid #d2dce2; padding: 12px; background: #fafcfd; }
figure.phone { max-width: 414px; }
figure img { display: block; max-width: 100%; height: auto; margin: auto; }
figcaption { font-size: .85rem; line-height: 1.4; margin-top: 12px; color: #3e5365; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .92rem; }
th, td { text-align: left; vertical-align: top; border: 1px solid #cbd8df; padding: 10px; }
th { background: #edf4f5; }
.notice { border-left: 4px solid #147c81; background: #edf6f6; padding: 12px 16px; }
@media (max-width: 600px) {
  main { margin: 0; padding: 20px; }
  h1 { font-size: 1.7rem; } h2 { font-size: 1.35rem; }
  th, td { padding: 6px; font-size: .8rem; }
  figure { padding: 6px; }
}
@page { size: A4; margin: 16mm; }
@media print {
  :root { font-size: 10pt; background: white; }
  main { max-width: none; padding: 0; margin: 0; }
  h1, h2, h3 { break-after: avoid; }
  h2 { margin-top: 1.5rem; }
  p, li { orphans: 3; widows: 3; }
  figure { break-inside: avoid; margin: 12pt auto; padding: 6pt; }
  figure img { max-height: 225mm; max-width: 100%; object-fit: contain; }
  figure.phone { max-width: 90mm; }
  figcaption { font-size: 8pt; }
  th, td { padding: 6pt; font-size: 8pt; }
  thead { display: table-header-group; }
  tr, pre { break-inside: avoid; }
  a { color: inherit; }
  nav { break-after: page; }
  .notice { font-size: 9pt; }
}
`;

export async function renderGuide(name) {
  if (!guides.includes(name)) throw new Error("Unknown guide");
  const directory = resolve(root, "docs");
  const source = await readFile(resolve(directory, `${name}.md`), "utf8");
  const assets = new Map();
  const localLinks = new Set();
  for (const match of source.matchAll(/(!?)\[[^\]]+\]\(([^)]+)\)/g)) {
    const [, isImage, target] = match;
    if (/^https:\/\//.test(target) && !isImage) continue;
    if (target.startsWith("#") && !isImage) continue;
    if (!target.startsWith("./") && !target.startsWith("../"))
      throw new Error(`Unsupported local link: ${target}`);
    const localTarget = target.split("#")[0];
    const generatedGuide = /^\.\/(TECHNICAL_GUIDE|USER_GUIDE)\.html$/.test(
      localTarget,
    );
    const path = resolve(
      directory,
      generatedGuide ? localTarget.replace(/\.html$/, ".md") : localTarget,
    );
    if (!contained(root, path))
      throw new Error(`Link escapes repository: ${target}`);
    await stat(path);
    if (!isImage) {
      localLinks.add(target);
      continue;
    }
    if (!contained(resolve(directory, "images", "user-guide"), path))
      throw new Error(`Image outside guide directory: ${target}`);
    const mime = { ".png": "image/png", ".svg": "image/svg+xml" }[
      extname(path)
    ];
    if (!mime) throw new Error(`Unsupported image type: ${target}`);
    const bytes = await readFile(path);
    assets.set(target, {
      src: `data:${mime};base64,${bytes.toString("base64")}`,
      mobile: extname(path) === ".png" && bytes.readUInt32BE(16) <= 480,
    });
  }
  const { html, headings } = renderMarkdown(source, {
    link: (target) =>
      target.replace(
        /^\.\/(USER_GUIDE|TECHNICAL_GUIDE)\.md(?=#|$)/,
        "./$1.html",
      ),
    image: (target) => {
      const asset = assets.get(target);
      if (!asset) throw new Error(`Image not loaded: ${target}`);
      return asset;
    },
  });
  const toc = headings
    .filter(({ level }) => level === 2)
    .map(({ id, title }) => `<li><a href="#${id}">${escape(title)}</a></li>`)
    .join("");
  const document = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(headings[0].title)}</title><style>${css}</style></head>
<body><main>
<p class="notice">Offline / print edition. Images are embedded; no internet or JavaScript is required. Use your browser's Print / Save as PDF. Source-code and supporting-document links require the original repository layout.</p>
<nav aria-label="Contents"><strong>Contents</strong><ol>${toc}</ol></nav>
${html}
</main></body></html>
`;
  const output = resolve(directory, `${name}.html`);
  await writeFile(
    output,
    await format(document, {
      ...(await resolveConfig(output)),
      filepath: output,
    }),
  );
  console.log(
    `${name}: ${headings.length} headings, ${assets.size} images, ${localLinks.size} checked local links`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const guide of guides) await renderGuide(guide);
}
