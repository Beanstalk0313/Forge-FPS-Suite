import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The user guide in `docs/` is a linked set: relative page links, an index that
 * lists every page, and one `Related` line per page. Documentation that points
 * at a page that was renamed or never written is worse than no documentation,
 * so the set is checked here instead of by eye.
 */
const docsDir = path.join(process.cwd(), 'docs');
const pages = fs.readdirSync(docsDir).filter(name => name.endsWith('.md')).sort();
const read = name => fs.readFileSync(path.join(docsDir, name), 'utf8');
const linksIn = text => [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]);

test('the docs folder ships an index and the numbered pages it links', () => {
  assert.ok(pages.includes('README.md'), 'docs/README.md is the index');
  assert.ok(pages.length > 8, `expected a full guide, found ${pages.length} pages`);
  for (const page of pages) {
    const numbered = /^(\d\d)-[a-z0-9-]+\.md$/.test(page) || page === 'README.md';
    assert.ok(numbered, `${page}: name pages as NN-topic.md so the index order is obvious`);
  }
});

test('every relative link in the guide resolves to a real file', () => {
  const broken = [];
  for (const page of pages) {
    for (const target of linksIn(read(page))) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [file] = target.split('#');
      if (!fs.existsSync(path.resolve(docsDir, file))) broken.push(`${page} → ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'relative links must resolve; anchors are checked separately');
});

test('the index links every page, and each page links back to siblings', () => {
  const index = read('README.md');
  const indexed = new Set(linksIn(index).map(target => target.split('#')[0]));
  for (const page of pages) {
    if (page === 'README.md') continue;
    assert.ok(indexed.has(page), `docs/README.md does not link ${page}`);
  }
  for (const page of pages) {
    if (page === 'README.md') continue;
    const siblings = linksIn(read(page)).filter(target => target.endsWith('.md'));
    assert.ok(siblings.length >= 2, `${page}: end with a Related line linking sibling pages`);
  }
});

test('the guide does not hardcode app or engine versions, which belong to the release process', () => {
  const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
  const offenders = [];
  for (const page of pages) {
    const text = read(page);
    if (text.includes(version)) offenders.push(`${page} mentions ${version}`);
    if (/\b\d+\.\d+\.\d+\b/.test(text.replace(/`[^`]*`/g, ''))) offenders.push(`${page} has a bare version number`);
  }
  assert.deepEqual(offenders, []);
});
