// Minimal WordprocessingML table reader.
// Reads word/document.xml from a .docx and returns its tables as
// arrays of rows; each row is an array of cells: { text, lines, span }.
import AdmZipLike from './unzip.js';

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Extract visible text of a cell, preserving paragraph breaks as lines.
function cellToLines(tcXml) {
  const paras = tcXml.split(/<w:p[ >]/).slice(1);
  const lines = [];
  for (const p of paras) {
    // NB: `<w:t(?: ...)?>` only — must NOT match <w:tcPr>, <w:tbl>, <w:tr>, etc.
    const texts = [...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) =>
      decode(m[1])
    );
    const line = texts.join('').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}

function gridSpan(tcXml) {
  const m = tcXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
  return m ? Number(m[1]) : 1;
}

export function readTables(docxPath) {
  const xml = AdmZipLike.readEntry(docxPath, 'word/document.xml');
  const tables = [];
  const tblChunks = xml.split('<w:tbl>').slice(1);
  for (const chunk of tblChunks) {
    const tblXml = chunk.split('</w:tbl>')[0];
    const rows = [];
    const trChunks = tblXml.split(/<w:tr[ >]/).slice(1);
    for (const tr of trChunks) {
      const trXml = tr.split('</w:tr>')[0];
      const cells = [];
      const tcChunks = trXml.split('<w:tc>').slice(1);
      for (const tc of tcChunks) {
        const tcXml = tc.split('</w:tc>')[0];
        const lines = cellToLines(tcXml);
        cells.push({ text: lines.join(' | '), lines, span: gridSpan(tcXml) });
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}
