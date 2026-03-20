'use strict';

// Codepoint applicator for draft-ietf-quic-qmux
//
// Reads codepoints.md and substitutes updated codepoint values into the draft.
// For each codepoint name, finds the two most recent versions in the table and
// replaces the older value with the newer value in the draft document.
//
// Magic Value rows are never substituted (their value never changes).
// Rows with no previous version (i.e. first appearance) are skipped — there is
// nothing to replace.
//
// Usage:  node apply-codepoints.js [--dry-run]
//         make apply-codepoints

const fs = require('fs');
const path = require('path');

const CODEPOINTS_FILE = path.join(__dirname, 'codepoints.md');
const DRAFT_FILE = path.join(__dirname, 'draft-ietf-quic-qmux.md');

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Parse codepoints.md
// Returns a map of: sectionHeader -> [ { name, codepoint, version, selection } ]
// Rows are in table order (newest version first within each name group).
// ---------------------------------------------------------------------------

function parseCodepoints() {
  const content = fs.readFileSync(CODEPOINTS_FILE, 'utf8');
  const chunks = content.split(/(?=^## )/m);
  const sections = [];

  for (const chunk of chunks) {
    if (!chunk.startsWith('## ')) continue;
    const header = chunk.split('\n')[0].trim();
    const rows = [];
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('|') || line.startsWith('| Name') || line.startsWith('|---')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cells.length < 4) continue;
      rows.push({
        name:      cells[0],
        codepoint: cells[1],
        version:   cells[2],
        selection: cells[3],
      });
    }
    sections.push({ header, rows });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Build substitution list
// For each name, find the two most recent rows (by version desc, which is
// already the table order). The newer row's value replaces the older row's value.
// Skip Magic Value rows and rows with no predecessor.
// ---------------------------------------------------------------------------

function buildSubstitutions(sections) {
  const subs = [];

  for (const { header, rows } of sections) {
    // Group rows by name, preserving order (newest first)
    const byName = new Map();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row);
    }

    for (const [name, nameRows] of byName) {
      // Skip magic values — they never change
      if (nameRows[0].selection === 'Magic Value') continue;

      // Need at least two rows to have something to replace
      if (nameRows.length < 2) continue;

      const newer = nameRows[0];
      const older = nameRows[1];

      // Skip if either value is a TBD placeholder or identical
      if (older.codepoint.includes('TBD')) continue;
      if (newer.codepoint === older.codepoint) continue;

      subs.push({
        section: header,
        name,
        from: older.codepoint,
        to:   newer.codepoint,
        fromVersion: older.version,
        toVersion:   newer.version,
      });
    }
  }

  return subs;
}

// ---------------------------------------------------------------------------
// Apply substitutions to draft
// ---------------------------------------------------------------------------

function applySubstitutions(subs) {
  let draft = fs.readFileSync(DRAFT_FILE, 'utf8');
  let changed = false;

  for (const sub of subs) {
    const count = (draft.match(new RegExp(sub.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

    if (count === 0) {
      console.log(`  SKIP  ${sub.name}: ${sub.from} not found in draft`);
      continue;
    }

    console.log(`  ${DRY_RUN ? 'WOULD ' : ''}REPLACE  ${sub.name} (${sub.fromVersion} -> ${sub.toVersion})`);
    console.log(`          ${sub.from} -> ${sub.to}  (${count} occurrence${count > 1 ? 's' : ''})`);

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sections = parseCodepoints();
const subs = buildSubstitutions(sections);

if (subs.length === 0) {
  console.log('Nothing to substitute — all codepoints are up to date.');
  process.exit(0);
}

console.log(`${DRY_RUN ? 'Dry run — ' : ''}Substitutions to apply:\n`);
applySubstitutions(subs);
