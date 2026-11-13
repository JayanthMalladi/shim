/**
 * S06b: unit tests for the pure tar unpacker (`unpackTar`). The tarball is built in memory here —
 * a small hand-rolled ustar writer, no `tar` binary, no network. Two properties are asserted:
 *   - containment: an entry whose resolved target escapes `destDir` (a `../` or absolute path) is
 *     skipped, so a hostile tarball can never write outside its dest dir;
 *   - ustar prefix: a name longer than 100 bytes, split across the `prefix` + `name` fields, is
 *     reassembled so long paths aren't cut off.
 * And the ordinary case: a `package/`-rooted tree unpacks with the root segment stripped.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unpackTar } from "../src/pack-builder/evidence.js";

/** Split a full tar entry path into the ustar `prefix` + `name` fields (both NUL-padded). */
function splitUstar(full: string): { prefix: string; name: string } {
  if (full.length <= 100) return { prefix: "", name: full };
  // Find a "/" from the right so the part after it (name) is <= 100 and the part before (prefix)
  // is <= 155 — the ustar field limits.
  let i = full.lastIndexOf("/");
  while (i > 0) {
    const name = full.slice(i + 1);
    const prefix = full.slice(0, i);
    if (name.length <= 100 && prefix.length <= 155) return { prefix, name };
    i = full.lastIndexOf("/", i - 1);
    if (i <= 0) break;
  }
  return { prefix: "", name: full.slice(0, 100) }; // shouldn't happen in these tests
}

interface TarEntry {
  /** The full entry path (e.g. "package/index.d.ts"), or a hostile one ("package/../../x"). */
  path: string;
  /** Directory entries carry no data; the typeflag is "7". */
  dir?: boolean;
  data?: string;
}

/** One 512-byte ustar header for an entry. The checksum is computed the standard way (the field
 * blanked to spaces while summing) — the unpacker doesn't verify it, but a real tar would. */
function tarHeader(entry: TarEntry): Buffer {
  const { prefix, name } = splitUstar(entry.path);
  const size = entry.dir ? 0 : Buffer.byteLength(entry.data ?? "");
  const h = Buffer.alloc(512);
  h.write(name, 0, Math.min(name.length, 100), "utf8"); // [0..100)
  if (prefix) h.write(prefix, 345, Math.min(prefix.length, 155), "utf8"); // [345..500)
  h.write(size.toString(8), 124, "ascii"); // [124..136) octal, NUL-padded
  h.write(entry.dir ? "7" : "0", 156, 1, "ascii"); // [156] typeflag
  h.write("ustar\0", 257, 6, "ascii"); // [257..263) magic
  h.write("00", 263, 2, "ascii"); // [263..265) version
  for (let i = 148; i < 156; i++) h[i] = 0x20; // blank the checksum field
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8), 148, "ascii"); // [148..156)
  return h;
}

/** Concatenate headers + data blocks (padded to 512) + the two zero end-blocks, as a raw tar. */
function buildTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    blocks.push(tarHeader(e));
    if (!e.dir) {
      const data = Buffer.from(e.data ?? "");
      blocks.push(data);
      const rem = data.length % 512;
      if (rem !== 0) blocks.push(Buffer.alloc(512 - rem));
    }
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks: end of archive
  return Buffer.concat(blocks);
}

describe("S06b tar unpacker", () => {
  it("skips entries that escape destDir (path traversal) and unpacks the rest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-tar-"));
    try {
      const dest = path.join(root, "base", "dest");
      fs.mkdirSync(dest, { recursive: true });
      const entries: TarEntry[] = [
        { path: "package", dir: true },
        { path: "package/sub", dir: true },
        { path: "package/index.d.ts", data: "declare const x: number;\n" },
        { path: "package/sub/deep.d.ts", data: "export const y = 1;\n" },
        // A `../` entry: after stripping the root segment it resolves outside dest -> must be skipped.
        { path: "package/../../escape.txt", data: "PWNED\n" },
        { path: "package/../outside-base.txt", data: "PWNED\n" },
      ];
      unpackTar(buildTar(entries), dest);

      // The ordinary files land inside dest.
      expect(fs.readFileSync(path.join(dest, "index.d.ts"), "utf8")).toBe("declare const x: number;\n");
      expect(fs.readFileSync(path.join(dest, "sub", "deep.d.ts"), "utf8")).toBe("export const y = 1;\n");
      // Nothing wrote outside dest: the `../../escape.txt` target is root/escape.txt (two up from
      // base/dest); the `../outside-base.txt` target is base/outside-base.txt.
      expect(fs.existsSync(path.join(root, "escape.txt"))).toBe(false);
      expect(fs.existsSync(path.join(root, "base", "outside-base.txt"))).toBe(false);
      // dest holds exactly the two unpacked files + the sub dir.
      expect(fs.readdirSync(dest).sort()).toEqual(["index.d.ts", "sub"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an absolute entry that would write outside destDir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-tar-"));
    try {
      const dest = path.join(root, "dest");
      fs.mkdirSync(dest, { recursive: true });
      // An absolute name: stripping the first segment yields "/abs/evil.txt"; joining it onto
      // destDir and resolving still points at the filesystem root, not inside dest.
      const entries: TarEntry[] = [{ path: "/abs/evil.txt", data: "PWNED\n" }];
      unpackTar(buildTar(entries), dest);
      expect(fs.existsSync(path.join(root, "dest", "abs", "evil.txt"))).toBe(false);
      expect(fs.readdirSync(dest)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reassembles a ustar name longer than 100 bytes from the prefix field", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shim-tar-"));
    try {
      const dest = path.join(root, "dest");
      fs.mkdirSync(dest, { recursive: true });
      // A >100-byte path: "package/" + 130 chars + "/file.d.ts" -> split across prefix + name.
      const dir = "d".repeat(130);
      const entries: TarEntry[] = [
        { path: "package", dir: true },
        { path: `package/${dir}`, dir: true },
        { path: `package/${dir}/file.d.ts`, data: "export const long = 1;\n" },
      ];
      unpackTar(buildTar(entries), dest);
      expect(fs.readFileSync(path.join(dest, dir, "file.d.ts"), "utf8")).toBe("export const long = 1;\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
