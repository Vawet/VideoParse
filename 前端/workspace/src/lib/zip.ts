/**
 * Minimal ZIP writer. Entries are deflated with the platform `CompressionStream`
 * when available and stored uncompressed otherwise, so the archive is readable
 * by any standard unzip tool either way. Text and binary payloads are both supported.
 */
export type ZipEntry = {
  /** Path inside the archive, using forward slashes. */
  path: string;
  /** UTF-8 text payload. */
  content?: string;
  /** Raw bytes (images, fonts, …). Takes precedence over `content`. */
  data?: Uint8Array;
};

const encoder = new TextEncoder();

/** Byte arrays backed by a plain ArrayBuffer, which is what the Blob API expects. */
type Bytes = Uint8Array<ArrayBuffer>;

const allocate = (size: number): Bytes => new Uint8Array(new ArrayBuffer(size));

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deflate a payload, falling back to STORE (method 0) when unsupported. */
async function compress(bytes: Bytes): Promise<{ data: Bytes; method: number }> {
  if (typeof CompressionStream === "undefined") return { data: bytes, method: 0 };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return { data: new Uint8Array(buffer), method: 8 };
  } catch {
    return { data: bytes, method: 0 };
  }
}

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Bytes[] = [];
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const raw: Bytes = entry.data
      ? new Uint8Array(entry.data)
      : encoder.encode(entry.content ?? "");
    const { data, method } = await compress(raw);
    const checksum = crc32(raw);

    const local = allocate(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 file names
    localView.setUint16(8, method, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    parts.push(local, data);

    const directoryEntry = allocate(46 + nameBytes.length);
    const entryView = new DataView(directoryEntry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true); // version made by
    entryView.setUint16(6, 20, true); // version needed
    entryView.setUint16(8, 0x0800, true);
    entryView.setUint16(10, method, true);
    entryView.setUint16(12, dosTime, true);
    entryView.setUint16(14, dosDate, true);
    entryView.setUint32(16, checksum, true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, raw.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint16(30, 0, true); // extra field length
    entryView.setUint16(32, 0, true); // comment length
    entryView.setUint16(34, 0, true); // disk number
    entryView.setUint16(36, 0, true); // internal attributes
    entryView.setUint32(38, 0, true); // external attributes
    entryView.setUint32(42, offset, true);
    directoryEntry.set(nameBytes, 46);
    central.push(directoryEntry);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const end = allocate(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
