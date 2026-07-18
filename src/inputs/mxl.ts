/* ====================================================================
   MXL_IN — bytes -> MusicXML text. Compressed MusicXML (.mxl) is a ZIP
   archive — and the DEFAULT export of MuseScore, Finale, and Sibelius —
   so this is the container most real-world scores actually arrive in.
   This module only unwraps the container; the extracted text goes to
   MusicxmlIn.parse like any other MusicXML file (inputs stay composable,
   the container is not the notation's concern).

   A from-scratch minimal ZIP reader, same spirit as the SMF reader:
   find the end-of-central-directory record, walk the central directory,
   and read one entry's bytes via its local header. Which entry: the one
   META-INF/container.xml names as <rootfile full-path>; if the manifest
   is absent (out-of-spec but seen in the wild), the first *.xml or
   *.musicxml outside META-INF/.

   Only "stored" (0) and "deflate" (8) entries are supported — the only
   methods MusicXML tools emit. Inflation uses the browser-native
   DecompressionStream("deflate-raw") — still zero dependencies — but is
   injectable because Node 18's DecompressionStream lacks deflate-raw,
   so tests supply node:zlib. CRCs are not verified: a corrupt archive
   surfaces as a parse error one step later in MusicxmlIn.
   ==================================================================== */

export type InflateRaw = (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

const webInflateRaw: InflateRaw = async (data) => {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const EOCD_SIG = 0x06054b50; // end of central directory
const CEN_SIG = 0x02014b50; // central directory file header
const LOC_SIG = 0x04034b50; // local file header

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  csize: number; // compressed bytes on disk
  offset: number; // of the local file header
}

// Walk the central directory (the authoritative index; local headers may
// carry zeroed sizes when the archive was written streaming).
export function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const dv = new DataView(buf);
  // EOCD sits at the very end, pushed back by an up-to-64KiB comment.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  const utf8 = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CEN_SIG) throw new Error("Corrupt ZIP central directory.");
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    entries.push({
      name: utf8.decode(new Uint8Array(buf, p + 46, nameLen)),
      method: dv.getUint16(p + 10, true),
      csize: dv.getUint32(p + 20, true),
      offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readEntry(
  buf: ArrayBuffer,
  entry: ZipEntry,
  inflateRaw: InflateRaw,
): Promise<Uint8Array> {
  const dv = new DataView(buf);
  if (dv.getUint32(entry.offset, true) !== LOC_SIG) throw new Error("Corrupt ZIP local header.");
  const nameLen = dv.getUint16(entry.offset + 26, true);
  const extraLen = dv.getUint16(entry.offset + 28, true);
  const data = new Uint8Array(buf, entry.offset + 30 + nameLen + extraLen, entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
}

export async function extract(buf: ArrayBuffer, inflateRaw: InflateRaw = webInflateRaw): Promise<string> {
  const entries = zipEntries(buf);
  const utf8 = new TextDecoder();

  let rootPath: string | undefined;
  const manifest = entries.find((e) => e.name === "META-INF/container.xml");
  if (manifest) {
    const doc = new DOMParser().parseFromString(
      utf8.decode(await readEntry(buf, manifest, inflateRaw)),
      "application/xml",
    );
    rootPath = doc.querySelector("rootfile")?.getAttribute("full-path") ?? undefined;
  }

  const root = rootPath
    ? entries.find((e) => e.name === rootPath)
    : entries.find((e) => /\.(musicxml|xml)$/i.test(e.name) && !e.name.startsWith("META-INF/"));
  if (!root) throw new Error("No MusicXML document inside the .mxl archive.");
  return utf8.decode(await readEntry(buf, root, inflateRaw));
}

export const MxlIn = { extract };
