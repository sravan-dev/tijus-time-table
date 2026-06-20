// Tiny pure-Node reader for a single entry inside a .docx (ZIP) file.
// Supports stored (0) and deflate (8) entries — all that .docx uses.
import fs from 'fs';
import zlib from 'zlib';

function readEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);

  // Locate End Of Central Directory record (signature 0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file: ' + zipPath);

  const cdCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory offset

  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break; // central dir header sig
    const compMethod = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    if (name === entryName) {
      // Parse local file header to find where the data starts.
      if (buf.readUInt32LE(localOffset) !== 0x04034b50)
        throw new Error('Bad local header for ' + entryName);
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (compMethod === 0) return raw.toString('utf8');
      if (compMethod === 8) return zlib.inflateRawSync(raw).toString('utf8');
      throw new Error('Unsupported compression method ' + compMethod);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Entry not found: ' + entryName);
}

export default { readEntry };
