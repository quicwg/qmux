/**
 * codepoints-table.js - Shared helpers for reading and writing codepoints.md
 *
 * The codepoints.md file contains one table per QUIC extension point type.
 * Each table has the following columns:
 *
 * | Name | Codepoint | Draft version | Selection |
 * |---|---|---|---|
 * | EXAMPLE_FRAME_1  | 0xaabbccdd11223344 | draft-ietf-example-proto-02 | https://martinthomson.github.io/quic-pick/#seed=draft-ietf-example-proto-02_frame;field=frame;... |
 * | EXAMPLE_FRAME_1  | 0x9900aabb11001100 | draft-ietf-example-proto-01 | https://martinthomson.github.io/quic-pick/#seed=draft-ietf-example-proto-01_frame;field=frame;... |
 * | EXAMPLE_FRAME_1  | 0xTBD              | draft-ietf-example-proto-00 | Manual Selection |
 * | EXAMPLE_FRAME_2  | 0xaabbccdd11223345 | draft-ietf-example-proto-02 | (consecutive with above) |
 * | MAGIC_FRAME      | 0x3f4558414d504c45 | draft-ietf-example-proto-02 | Magic Value |
 *
 * Rows are sorted by (name asc, draft version desc) so all rows for a given
 * codepoint name are grouped together with the newest version at the top.
 */

import fs from 'fs';

// Parse a markdown table row into an array of cell strings.
export const cellsOf = row => row.split('|').map(c => c.trim()).filter(c => c !== '');

// Return true if a line is a data row (not a header or separator).
export const isDataRow = line =>
  line.startsWith('|') && !line.startsWith('| Name') && !line.startsWith('|---');

// Split codepoints.md content into chunks on ## headings.
export const splitSections = content => content.split(/(?=^## )/m);

// Read the named section from a file, returning { chunks, idx, lines, separatorLine }.
// Throws if the section or its table cannot be found.
export function readSection(file, header) {
  const content = fs.readFileSync(file, 'utf8');
  const chunks = splitSections(content);
  const idx = chunks.findIndex(c => c.startsWith(header));
  if (idx === -1) throw new Error(`Section "${header}" not found in ${file}`);

  const lines = chunks[idx].split('\n');
  const separatorLine = lines.findIndex(l => l.startsWith('|---'));
  if (separatorLine === -1) throw new Error(`No table found under "${header}"`);

  return { content, chunks, idx, lines, separatorLine };
}

// Write updated chunks back to a file.
export function writeChunks(file, chunks) {
  fs.writeFileSync(file, chunks.join(''));
}
