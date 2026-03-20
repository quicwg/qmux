'use strict';

// Codepoint picker for draft-ietf-quic-qmux
//
// Determines the next draft version from git tags, loads the quic-pick
// algorithm from the vendored quic-pick.html, fetches the IANA registry
// snapshot, runs the selection, and appends new rows to codepoints.md.
//
// Usage:  node pick-codepoints.js
//         make codepoints
//
// To update the vendored quic-pick algorithm:
//         make update-quic-pick

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { webcrypto } = require('crypto');
const vm = require('vm');

// ---------------------------------------------------------------------------
// Version derivation
// ---------------------------------------------------------------------------

function nextVersion() {
  const tags = execSync('git tag -l', { encoding: 'utf8' })
    .split('\n')
    .map(t => t.trim())
    .filter(t => /^draft-ietf-quic-qmux-\d+$/.test(t));

  if (tags.length === 0) {
    throw new Error('No tags matching draft-ietf-quic-qmux-NN found');
  }

  const nums = tags.map(t => parseInt(t.match(/(\d+)$/)[1], 10));
  const next = Math.max(...nums) + 1;
  return `draft-ietf-quic-qmux-${String(next).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (handles redirects)
// ---------------------------------------------------------------------------

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Load quic-pick algorithm from vendored quic-pick.html
//
// Extracts the <script> block and runs it in a vm sandbox, providing shims
// for the browser APIs it uses (crypto.subtle, fetch, DOMParser) so the core
// algorithm functions (rng, draw, etc.) can be called directly.
// ---------------------------------------------------------------------------

const QUIC_PICK_HTML = path.join(__dirname, 'quic-pick.html');

async function loadQuicPick(seedValue, takenValues) {
  const html = fs.readFileSync(QUIC_PICK_HTML, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No <script> block found in quic-pick.html');
  const source = match[1];

  // Shim: DOMParser backed by regex, faithfully reproducing quic-pick's
  // range parsing including its off-by-one on range ends (end is exclusive).
  class DOMParser {
    parseFromString(text) {
      return {
        documentElement: {
          get children() {
            const registries = [];
            const regPattern = /<registry([^>]*)>([\s\S]*?)<\/registry>/g;
            let m;
            while ((m = regPattern.exec(text)) !== null) {
              const attrs = m[1];
              const body = m[2];
              const idMatch = attrs.match(/id="([^"]+)"/);
              const id = idMatch ? idMatch[1] : null;

              const records = [];
              const recPattern = /<record[\s\S]*?<\/record>/g;
              let rm;
              while ((rm = recPattern.exec(body)) !== null) {
                const valMatch = /<value>([^<]+)<\/value>/.exec(rm[0]);
                records.push({
                  localName: 'record',
                  get children() {
                    if (!valMatch) return [];
                    return [{
                      localName: 'value',
                      textContent: valMatch[1],
                    }];
                  },
                });
              }

              registries.push({
                localName: 'registry',
                getAttribute: (a) => a === 'id' ? id : null,
                get children() { return records; },
              });
            }
            return registries;
          },
        },
      };
    }
  }

  // Shim: fetch for the relative XML URLs quic-pick uses
  const xmlCache = {};
  const xmlUrls = {
    'quic.xml': 'https://raw.githubusercontent.com/martinthomson/quic-pick/main/quic.xml',
    'h3.xml':   'https://raw.githubusercontent.com/martinthomson/quic-pick/main/h3.xml',
    'masque.xml': 'https://raw.githubusercontent.com/martinthomson/quic-pick/main/masque.xml',
  };
  async function shimFetch(url) {
    const key = url.replace(/.*\//, ''); // basename
    if (!xmlCache[key]) {
      const absUrl = xmlUrls[key];
      if (!absUrl) throw new Error(`Unknown XML url: ${url}`);
      console.log(`  fetching ${absUrl}...`);
      xmlCache[key] = await fetchUrl(absUrl);
    }
    return {
      text: async () => xmlCache[key],
    };
  }

  // Shim: minimal el() — only 'seed' is accessed by the algorithm
  function el(id) {
    if (id === 'seed') return { value: seedValue };
    return { value: '' };
  }

  const sandbox = {
    // Browser globals needed by quic-pick
    crypto: webcrypto,
    fetch: shimFetch,
    DOMParser,
    TextEncoder,
    console,
    // el() shim
    el,
    // quic-pick uses bare `taken` and `urlcodepoint` as module-level vars
    taken: takenValues,
    urlcodepoint: null,
    // Suppress UI-only functions — quic-pick calls these but we don't need them
    addEventListener: () => {},
    window: { location: { origin: '', pathname: '' }, addEventListener: () => {} },
    document: {
      getElementById: el,
      querySelector: () => ({ value: '8' }), // default size=8
    },
    navigator: { clipboard: { writeText: () => {} } },
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return sandbox;
}

// ---------------------------------------------------------------------------
// codepoints.md management
// ---------------------------------------------------------------------------

const CODEPOINTS_FILE = path.join(__dirname, 'codepoints.md');

const SECTIONS = [
  { field: 'frame',   header: '## QUIC Frame Types' },
  { field: 'tp',      header: '## QUIC Transport Parameters' },
  { field: 'error',   header: '## QUIC Transport Error Codes' },
  { field: 'version', header: '## QUIC Versions' },
];

const TABLE_HEADER = '| Name | Codepoint | Draft version | Selection |\n|---|---|---|---|';

function initCodepointsFile() {
  if (fs.existsSync(CODEPOINTS_FILE)) return;

  const sections = SECTIONS
    .map(s => `${s.header}\n\n${TABLE_HEADER}`)
    .join('\n\n');

  fs.writeFileSync(CODEPOINTS_FILE, `# QMux Codepoints\n\n${sections}\n`);
  console.log('Created codepoints.md');
}

function alreadyHasVersion(draftVersion) {
  const content = fs.readFileSync(CODEPOINTS_FILE, 'utf8');
  // Draft version is now the third column: | Name | Codepoint | draft-... |
  return content.includes(`| ${draftVersion} |`);
}

// Returns rows from a given section whose Selection column is 'Magic Value',
// with the draft version updated to draftVersion.
function magicValueRows(field, draftVersion) {
  const content = fs.readFileSync(CODEPOINTS_FILE, 'utf8');
  const section = SECTIONS.find(s => s.field === field);
  if (!section) return [];
  const chunks = content.split(/(?=^## )/m);
  const chunk = chunks.find(c => c.startsWith(section.header));
  if (!chunk) return [];
  const seen = new Set();
  return chunk.split('\n')
    .filter(l => l.startsWith('|') && !l.startsWith('| Name') && !l.startsWith('|---'))
    .filter(l => l.endsWith('| Magic Value |'))
    .filter(l => {
      // Deduplicate by name (first column) — only carry each unique name forward once
      const name = l.split('|').map(c => c.trim()).filter(c => c !== '')[0];
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map(l => {
      // Replace the draft version column (third cell) with the new version
      const cells = l.split('|').map(c => c.trim()).filter(c => c !== '');
      cells[2] = draftVersion;
      return '| ' + cells.join(' | ') + ' |';
    });
}

// Add new rows to a section and re-sort the entire table by (name asc, version desc).
// This keeps all rows for the same name together, with newer versions first.
function addRows(field, newRows) {
  let content = fs.readFileSync(CODEPOINTS_FILE, 'utf8');
  const section = SECTIONS.find(s => s.field === field);
  if (!section) throw new Error(`Unknown field: ${field}`);

  const chunks = content.split(/(?=^## )/m);
  const idx = chunks.findIndex(c => c.startsWith(section.header));
  if (idx === -1) throw new Error(`Section "${section.header}" not found in codepoints.md`);

  const lines = chunks[idx].split('\n');
  let separatorLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|---')) { separatorLine = i; break; }
  }
  if (separatorLine === -1) throw new Error(`No table found under "${section.header}"`);

  // Collect existing table rows (everything after the separator that starts with |)
  const existingRows = lines.slice(separatorLine + 1).filter(l => l.startsWith('|'));
  const nonTableLines = lines.slice(separatorLine + 1).filter(l => !l.startsWith('|'));

  const allRows = [...existingRows, ...newRows];

  const cellsOf = r => r.split('|').map(c => c.trim()).filter(c => c !== '');
  const nameOf = r => cellsOf(r)[0];
  const versionOf = r => cellsOf(r)[2];

  // Sort by name asc, then version desc (lexical on "draft-ietf-quic-qmux-NN" works fine)
  allRows.sort((a, b) => {
    const nameCmp = nameOf(a).localeCompare(nameOf(b));
    if (nameCmp !== 0) return nameCmp;
    return versionOf(b).localeCompare(versionOf(a));
  });

  chunks[idx] = [
    ...lines.slice(0, separatorLine + 1),
    ...allRows,
    ...nonTableLines,
  ].join('\n');
  fs.writeFileSync(CODEPOINTS_FILE, chunks.join(''));
}

// ---------------------------------------------------------------------------
// Permalink URL (matches quic-pick's updateDecoration logic)
// ---------------------------------------------------------------------------

function permalink(seed, field, count, size, codepoint) {
  const base = 'https://martinthomson.github.io/quic-pick/';
  const cpStr = `0x${codepoint.toString(16).padStart(size * 2, '0')}`;
  let url = `${base}#seed=${encodeURIComponent(seed)};field=${field};codepoint=${encodeURIComponent(cpStr)}`;
  if (count > 1n) url += `;count=${count}`;
  url += `;size=${size}`;
  return url;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const draftVersion = nextVersion();
  console.log(`Target version: ${draftVersion}`);

  initCodepointsFile();

  if (alreadyHasVersion(draftVersion)) {
    console.log(`${draftVersion} already present in codepoints.md — nothing to do.`);
    return;
  }

  // Use field-specific seeds to avoid coincidental collisions across registries.
  // e.g. "draft-ietf-quic-qmux-01/frame", "draft-ietf-quic-qmux-01/tp"
  // The shared taken object is populated lazily and reused across both calls.
  const sharedTaken = {};
  const SIZE = 8;

  // Compute frame codepoints (consecutive pair: QX_PING request + response)
  const frameSeed = `${draftVersion}_frame`;
  console.log('Computing frame codepoints...');
  const qpFrame = await loadQuicPick(frameSeed, sharedTaken);
  const frameBase = await qpFrame.draw(2n, qpFrame.vi62, SIZE, 'frame');

  // Compute transport parameter codepoint (max_frame_size)
  const tpSeed = `${draftVersion}_tp`;
  console.log('Computing transport parameter codepoint...');
  const qpTp = await loadQuicPick(tpSeed, sharedTaken);
  const tpVal = await qpTp.draw(1n, qpTp.vi62g27mod31, SIZE, 'tp');

  const pad = (v) => '0x' + v.toString(16).padStart(SIZE * 2, '0');

  // Collect all rows per field then write at once — addRows sorts by name
  addRows('frame', [
    ...magicValueRows('frame', draftVersion),
    `| QX_PING (request) | ${pad(frameBase)} | ${draftVersion} | ${permalink(frameSeed, 'frame', 2n, SIZE, frameBase)} |`,
    `| QX_PING (response) | ${pad(frameBase + 1n)} | ${draftVersion} | (consecutive with above) |`,
  ]);

  addRows('tp', [
    ...magicValueRows('tp', draftVersion),
    `| max_frame_size | ${pad(tpVal)} | ${draftVersion} | ${permalink(tpSeed, 'tp', 1n, SIZE, tpVal)} |`,
  ]);

  console.log('');
  console.log('Results:');
  console.log(`  QX_PING (request):  ${pad(frameBase)}`);
  console.log(`  QX_PING (response): ${pad(frameBase + 1n)}`);
  console.log(`  max_frame_size:     ${pad(tpVal)}`);
  console.log('');
  console.log('codepoints.md updated.');
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
