import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

export interface ArchiveEntry {
  /** Path inside the archive, e.g. "app.db" or "uploads/3/abc.png". */
  name: string;
  /** File on disk to read. */
  file: string;
}

/** Every file under `dir`, as archive entries named `${prefix}/relative/path`. */
export function entriesUnder(dir: string, prefix: string): ArchiveEntry[] {
  if (!fs.existsSync(dir)) return [];
  const out: ArchiveEntry[] = [];
  const walk = (current: string) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) out.push({ name: `${prefix}/${path.relative(dir, full).split(path.sep).join('/')}`, file: full });
    }
  };
  walk(dir);
  return out;
}

function header(name: string, size: number, mtimeMs: number): Buffer {
  const b = Buffer.alloc(512);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    // ustar splits long paths into a 155-byte prefix and a 100-byte name at a "/".
    const at = name.lastIndexOf('/', 155);
    if (at <= 0 || Buffer.byteLength(name.slice(at + 1)) > 100) throw new Error(`Path too long for archive: ${name}`);
    prefix = name.slice(0, at);
    base = name.slice(at + 1);
  }
  b.write(base, 0, 100, 'utf8');
  b.write('0000644\0', 100);
  b.write('0000000\0', 108);
  b.write('0000000\0', 116);
  b.write(size.toString(8).padStart(11, '0') + '\0', 124);
  b.write(Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0') + '\0', 136);
  b.write('        ', 148); // checksum field counts as spaces while summing
  b.write('0', 156);
  b.write('ustar\0', 257);
  b.write('00', 263);
  b.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}

async function* tarChunks(entries: ArchiveEntry[]) {
  for (const { name, file } of entries) {
    let data: Buffer;
    let mtime: number;
    try {
      data = await fs.promises.readFile(file);
      mtime = (await fs.promises.stat(file)).mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // deleted while we were reading
      throw err;
    }
    yield header(name, data.length, mtime);
    yield data;
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) yield Buffer.alloc(pad);
  }
  yield Buffer.alloc(1024); // end-of-archive marker
}

/** A .tar.gz (readable by any `tar`) of the given files. */
export function createArchive(entries: ArchiveEntry[]): Readable {
  return Readable.from(tarChunks(entries)).pipe(zlib.createGzip());
}
