/**
 * pick-codepoints.js - Codepoint picker for draft-ietf-quic-qmux
 *
 * Determines the next draft version from git tags, runs the quic-pick
 * selection algorithm, and appends new rows to codepoints.md.
 *
 * Usage:  node pick-codepoints.js
 *         make pick-codepoints
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { pick, permalink } from './quic-pick/quic-pick.js';
import { cellsOf, isDataRow, readSection, writeChunks } from './codepoints-table.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load IANA registry XML from the local quic-pick submodule rather than the
// network. quic-pick.js constructs URLs of the form:
//   https://martinthomson.github.io/quic-pick/quic.xml
// We extract the filename and resolve it against the local submodule directory.
const localRegistry = url => ({
  text: async () => fs.readFileSync(
    path.join(__dirname, 'quic-pick', new URL(url).pathname.split('/').pop()),
    'utf8'
  )
});

// Derive the next draft version by finding the highest draft-ietf-quic-qmux-NN
// git tag and incrementing its number.
function nextVersion() {
  const tags = execSync('git tag -l', { encoding: 'utf8', cwd: path.join(__dirname, '..') })
    .split('\n')
    .map(t => t.trim())
    .filter(t => /^draft-ietf-quic-qmux-\d+$/.test(t));

  if (tags.length === 0) throw new Error('No tags matching draft-ietf-quic-qmux-NN found');

  const nums = tags.map(t => parseInt(t.match(/(\d+)$/)[1], 10));
  const next = Math.max(...nums) + 1;
  return `draft-ietf-quic-qmux-${String(next).padStart(2, '0')}`;
}

const CODEPOINTS_FILE = path.join(__dirname, '..', 'codepoints.md');

const SECTIONS = [
  { field: 'frame',   header: '## QUIC Frame Types' },
  { field: 'tp',      header: '## QUIC Transport Parameters' },
  { field: 'error',   header: '## QUIC Transport Error Codes' },
  { field: 'version', header: '## QUIC Versions' },
];

const TABLE_HEADER = '| Name | Codepoint | Draft version | Selection |\n|---|---|---|---|';

// Create codepoints.md with empty tables if it does not already exist.
function initCodepointsFile() {
  if (fs.existsSync(CODEPOINTS_FILE)) return;
  const sections = SECTIONS.map(s => `${s.header}\n\n${TABLE_HEADER}`).join('\n\n');
  fs.writeFileSync(CODEPOINTS_FILE, `# QMux Codepoints\n\n${sections}\n`);
  console.log('Created codepoints.md');
}

// Returns true if codepoints.md already has rows for the given draft version.
function alreadyHasVersion(draftVersion) {
  return fs.readFileSync(CODEPOINTS_FILE, 'utf8').includes(`| ${draftVersion} |`);
}

// Returns Magic Value rows from a section with the draft version updated to
// draftVersion. Deduplicates by name so each magic value is carried forward once.
function magicValueRows(field, draftVersion) {
  const section = SECTIONS.find(s => s.field === field);
  if (!section) throw new Error(`Unknown field: ${field}`);
  const { lines, separatorLine } = readSection(CODEPOINTS_FILE, section.header);
  const seen = new Set();
  return lines.slice(separatorLine + 1)
    .filter(l => isDataRow(l) && l.endsWith('| Magic Value |'))
    .filter(l => {
      const name = cellsOf(l)[0];
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map(l => {
      const cells = cellsOf(l);
      cells[2] = draftVersion;
      return '| ' + cells.join(' | ') + ' |';
    });
}

// Add new rows to a section and re-sort the entire table by (name asc, version desc),
// keeping all rows for the same codepoint name together with newer versions first.
function addRows(field, newRows) {
  const section = SECTIONS.find(s => s.field === field);
  if (!section) throw new Error(`Unknown field: ${field}`);
  const { chunks, idx, lines, separatorLine } = readSection(CODEPOINTS_FILE, section.header);

  const existingRows = lines.slice(separatorLine + 1).filter(l => isDataRow(l));
  const nonTableLines = lines.slice(separatorLine + 1).filter(l => !isDataRow(l));
  const allRows = [...existingRows, ...newRows];

  allRows.sort((a, b) => {
    const nameCmp = cellsOf(a)[0].localeCompare(cellsOf(b)[0]);
    if (nameCmp !== 0) return nameCmp;
    return cellsOf(b)[2].localeCompare(cellsOf(a)[2]);
  });

  chunks[idx] = [...lines.slice(0, separatorLine + 1), ...allRows, ...nonTableLines].join('\n');
  writeChunks(CODEPOINTS_FILE, chunks);
}

async function main() {
  const draftVersion = nextVersion();
  console.log(`Target version: ${draftVersion}`);

  initCodepointsFile();

  if (alreadyHasVersion(draftVersion)) {
    console.log(`${draftVersion} already present in codepoints.md — nothing to do.`);
    return;
  }

  const SIZE = 8;

  // Use field-specific seeds to avoid coincidental value collisions across
  // registries (e.g. frame and tp could otherwise produce the same value).
  const frameSeed = `${draftVersion}_frame`;
  const tpSeed = `${draftVersion}_tp`;

  console.log('Computing frame codepoints...');
  const frameBase = await pick({ seed: frameSeed, field: 'frame', bytes: SIZE, count: 2n, fetchFn: localRegistry });

  console.log('Computing transport parameter codepoint...');
  const tpVal = await pick({ seed: tpSeed, field: 'tp', bytes: SIZE, fetchFn: localRegistry });

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
