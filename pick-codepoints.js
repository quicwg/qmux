// Codepoint picker for draft-ietf-quic-qmux
//
// Determines the next draft version from git tags, runs the quic-pick
// selection algorithm, and appends new rows to codepoints.md.
//
// Usage:  node pick-codepoints.js
//         make codepoints

import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { pick, permalink } from './quic-pick/quic-pick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// fetch shim for Node.js
// ---------------------------------------------------------------------------

function fetchFn(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchFn(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ text: async () => data }));
    }).on('error', reject);
  });
}

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
      const name = l.split('|').map(c => c.trim()).filter(c => c !== '')[0];
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map(l => {
      const cells = l.split('|').map(c => c.trim()).filter(c => c !== '');
      cells[2] = draftVersion;
      return '| ' + cells.join(' | ') + ' |';
    });
}

// Add new rows to a section and re-sort the entire table by (name asc, version desc).
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

  const existingRows = lines.slice(separatorLine + 1).filter(l => l.startsWith('|'));
  const nonTableLines = lines.slice(separatorLine + 1).filter(l => !l.startsWith('|'));
  const allRows = [...existingRows, ...newRows];

  const cellsOf = r => r.split('|').map(c => c.trim()).filter(c => c !== '');
  const nameOf = r => cellsOf(r)[0];
  const versionOf = r => cellsOf(r)[2];

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

  const SIZE = 8;

  // Field-specific seeds avoid coincidental value collisions across registries
  const frameSeed = `${draftVersion}_frame`;
  const tpSeed = `${draftVersion}_tp`;

  console.log('Computing frame codepoints...');
  const frameBase = await pick({ seed: frameSeed, field: 'frame', bytes: SIZE, count: 2n, fetchFn });

  console.log('Computing transport parameter codepoint...');
  const tpVal = await pick({ seed: tpSeed, field: 'tp', bytes: SIZE, fetchFn });

  const pad = (v) => '0x' + v.toString(16).padStart(SIZE * 2, '0');

  addRows('frame', [
    ...magicValueRows('frame', draftVersion),
    `| QX_PING (request) | ${pad(frameBase)} | ${draftVersion} | ${permalink({ seed: frameSeed, field: 'frame', codepoint: frameBase, bytes: SIZE, count: 2n })} |`,
    `| QX_PING (response) | ${pad(frameBase + 1n)} | ${draftVersion} | (consecutive with above) |`,
  ]);

  addRows('tp', [
    ...magicValueRows('tp', draftVersion),
    `| max_frame_size | ${pad(tpVal)} | ${draftVersion} | ${permalink({ seed: tpSeed, field: 'tp', codepoint: tpVal, bytes: SIZE })} |`,
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
