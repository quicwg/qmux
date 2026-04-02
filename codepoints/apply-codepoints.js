/**
 * apply-codepoints.js - Codepoint applicator for draft-ietf-quic-qmux
 *
 * Reads codepoints.md and substitutes updated codepoint values into the draft.
 * For each codepoint name, finds the two most recent versions in the table and
 * replaces the older value with the newer value in the draft document.
 *
 * Magic Value rows are never substituted (their value never changes).
 * Rows with no previous version (i.e. first appearance) are skipped —
 * there is nothing to replace.
 *
 * Usage:  node apply-codepoints.js [--dry-run]
 *         make apply-codepoints
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cellsOf, isDataRow, splitSections } from './codepoints-table.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODEPOINTS_FILE = path.join(__dirname, '..', 'codepoints.md');
const DRAFT_FILE = path.join(__dirname, '..', 'draft-ietf-quic-qmux.md');

const DRY_RUN = process.argv.includes('--dry-run');

// Parse codepoints.md into sections, each containing an ordered list of rows
// (newest version first within each name group).
function parseCodepoints() {
  const content = fs.readFileSync(CODEPOINTS_FILE, 'utf8');
  return splitSections(content)
    .filter(chunk => chunk.startsWith('## '))
    .map(chunk => ({
      header: chunk.split('\n')[0].trim(),
      rows: chunk.split('\n')
        .filter(isDataRow)
        .map(line => {
          const [name, codepoint, version, selection] = cellsOf(line);
          return { name, codepoint, version, selection };
        })
        .filter(row => row.name),
    }));
}

// Build the list of substitutions to apply. For each codepoint name, the two
// most recent rows are compared; the older value is replaced with the newer.
// Magic Value rows and TBD placeholders are skipped.
function buildSubstitutions(sections) {
  const subs = [];

  for (const { rows } of sections) {
    const byName = new Map();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row);
    }

    for (const [name, nameRows] of byName) {
      if (nameRows[0].selection === 'Magic Value') continue;
      if (nameRows.length < 2) continue;

      const [newer, older] = nameRows;
      if (older.codepoint.includes('TBD')) continue;
      if (newer.codepoint === older.codepoint) continue;

      subs.push({ name, from: older.codepoint, to: newer.codepoint, fromVersion: older.version, toVersion: newer.version });
    }
  }

  return subs;
}

// Apply substitutions to the draft, replacing all occurrences of each old
// codepoint value with the new one.
function applySubstitutions(subs) {
  let draft = fs.readFileSync(DRAFT_FILE, 'utf8');
  let changed = false;

  for (const sub of subs) {
    // Escape regex special chars defensively — codepoint strings (0x...) can't
    // contain them in practice, but this is future-proof for other value formats.
    const count = (draft.match(new RegExp(sub.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

    if (count === 0) {
      console.log(`  SKIP     ${sub.name}: ${sub.from} not found in draft`);
      continue;
    }

    console.log(`  ${DRY_RUN ? 'WOULD ' : ''}REPLACE  ${sub.name} (${sub.fromVersion} -> ${sub.toVersion})`);
    console.log(`           ${sub.from} -> ${sub.to}  (${count} occurrence${count > 1 ? 's' : ''})`);

    if (!DRY_RUN) {
      draft = draft.replaceAll(sub.from, sub.to);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(DRAFT_FILE, draft);
    console.log('\nDraft updated.');
  } else if (!DRY_RUN) {
    console.log('\nNo changes made.');
  }
}

const sections = parseCodepoints();
const subs = buildSubstitutions(sections);

if (subs.length === 0) {
  console.log('Nothing to substitute — all codepoints are up to date.');
  process.exit(0);
}

console.log(`${DRY_RUN ? 'Dry run — ' : ''}Substitutions to apply:\n`);
applySubstitutions(subs);
