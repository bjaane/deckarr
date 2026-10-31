// Copies the newest CHANGELOG.md sections into <Changes> in templates/deckarr.xml and sets
// <Date>, so Unraid's Apps tab shows the same release notes as GitHub.
//   node scripts/sync-template.mjs          update the template
//   node scripts/sync-template.mjs --check  exit 1 if the template is out of date

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(root, 'templates', 'deckarr.xml');
const KEEP = 5; // releases shown in the Apps tab

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

// "## 1.4.0" sections, newest first, as written in CHANGELOG.md.
const sections = changelog
  .split(/^## /m)
  .slice(1)
  .map((block) => {
    const [head, ...rest] = block.split('\n');
    return { version: head.trim(), body: rest.join('\n').trim() };
  })
  .filter((s) => /^\d+\.\d+\.\d+$/.test(s.version));

if (sections[0]?.version !== version) {
  console.error(`CHANGELOG.md has no "## ${version}" section at the top.`);
  process.exit(1);
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The Apps tab renders simple markdown. A list only shows as a list after a heading or a
// blank line, so subsections become "####" headings followed by a blank line. Bold and code
// marks are dropped.
const changes = sections
  .slice(0, KEEP)
  .map((s) => {
    const body = s.body
      .replace(/^### (.+)$/gm, '#### $1\n')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n');
    return `### ${s.version}\n\n${body}`;
  })
  .join('\n\n');

const today = new Date().toISOString().slice(0, 10);
const xml = fs.readFileSync(TEMPLATE, 'utf8');
const current = xml.match(/<Changes>([\s\S]*?)<\/Changes>/)?.[1].trim();
const wanted = xmlEscape(changes);

if (process.argv.includes('--check')) {
  if (current !== wanted) {
    console.error('templates/deckarr.xml <Changes> is out of date. Run: node scripts/sync-template.mjs');
    process.exit(1);
  }
  console.log('Template changelog is up to date.');
  process.exit(0);
}

if (current === wanted) {
  console.log('Template changelog is already up to date.');
  process.exit(0);
}

const updated = xml
  .replace(/<Changes>[\s\S]*?<\/Changes>/, `<Changes>\n${wanted}\n  </Changes>`)
  .replace(/<Date>[^<]*<\/Date>/, `<Date>${today}</Date>`);
fs.writeFileSync(TEMPLATE, updated);
console.log(`Updated templates/deckarr.xml with ${Math.min(KEEP, sections.length)} releases (newest ${version}), date ${today}.`);
