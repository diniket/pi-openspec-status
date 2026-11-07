// Mock dell'host API `files` (WorkspaceFiles) per i test node.
//
// createFsFromDir(root): mock di lettura reale basato su una directory
//   del filesystem (i fixture): listFiles/readFile sul sottoalbero,
//   rifiuto per path fuori root.
// createMockFs(spec): mock sintetico in memoria con tree, contenuti,
//   rejectPaths (throw ENOENT), truncatedPaths (listFiles),
//   truncatedReads (readFile). Espone .calls {list, read} per i contatori.
// createContext(files, workspaceId): WorkspacePanelContextV5 minimal.
import { readdir, stat, readFile as fsReadFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

// Normalizza i path relativi usati nei test: strip di ./, \, e trailing /.
const norm = (p) =>
  String(p)
    .replace(/\\/g, "/")
    .replace(/^\/+/g, "")
    .replace(/^(\.\/)+/g, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");

// ──────────────────────────────────────────────────────────────────────
// Mock su filesystem
// ──────────────────────────────────────────────────────────────────────
export async function createFsFromDir(root) {
  const rootAbs = resolve(root);
  const relToAbs = (rel) => {
    const p = isAbsolute(rel) ? resolve(rel) : resolve(join(rootAbs, rel));
    return p === rootAbs || p.startsWith(rootAbs + "/") ? p : null;
  };

  return {
    async listFiles(rel) {
      const dir = relToAbs(rel);
      if (dir === null) {
        const err = new Error(`ENOENT: no such file or directory: ${rel}`);
        err.code = "ENOENT";
        throw err;
      }
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) {
          const err = new Error(`ENOTDIR: not a directory: ${dir}`);
          err.code = "ENOTDIR";
          throw err;
        }
        const names = (await readdir(dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return {
          entries: names.map((n) => {
            const s = statSync(join(dir, n));
            return { name: n, type: s.isDirectory() ? "directory" : "file", size: s.size, modifiedAt: s.mtimeMs };
          }),
          scannedAt: Date.now(),
          truncated: false,
        };
      } catch (err) {
        throw err;
      }
    },

    async readFile(rel) {
      const p = relToAbs(rel);
      if (p === null) {
        const err = new Error(`ENOENT: no such file or directory: ${rel}`);
        err.code = "ENOENT";
        throw err;
      }
      const data = await fsReadFile(p, "utf8");
      const st = statSync(p);
      return {
        content: data,
        encoding: "utf8",
        size: st.size,
        modifiedAt: st.mtimeMs,
        truncated: false,
        binary: false,
      };
    },

    async listTree(rel) {
      const rootDir = relToAbs(rel);
      if (rootDir === null) {
        const err = new Error(`ENOENT: no such file or directory: ${rel}`);
        err.code = "ENOENT";
        throw err;
      }
      const out = [];
      const walk = async (d) => {
        const names = await readdir(d).catch(() => []);
        for (const n of names.sort()) {
          const full = join(d, n);
          const s = statSync(full);
          out.push({ name: n, type: s.isDirectory() ? "directory" : "file", size: s.size, modifiedAt: s.mtimeMs });
          if (s.isDirectory()) await walk(full);
        }
      };
      await walk(rootDir);
      return { entries: out, truncated: false, scannedAt: Date.now() };
    },

    async listFilesAt(p) {
      return this.listFiles(p);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Mock sintetico
// ──────────────────────────────────────────────────────────────────────
export function createMockFs(spec = {}) {
  const tree = new Map();
  for (const [k, v] of Object.entries(spec.tree ?? {})) {
    tree.set(norm(k), { type: v.type, size: v.size ?? 0 });
  }
  const contents = new Map();
  for (const [k, v] of Object.entries(spec.contents ?? {})) {
    contents.set(norm(k), String(v));
  }
  const reject = new Set(spec.rejectPaths ?? []);
  const truncated = new Set(spec.truncatedPaths ?? []);
  const truncatedRead = new Set(spec.truncatedReads ?? []);
  const calls = { list: 0, read: 0 };

  const enoent = (rel) => {
    const e = new Error(`ENOENT: no such file or directory: ${rel}`);
    e.code = "ENOENT";
    return e;
  };

  return {
    async listFiles(rel) {
      calls.list++;
      const r = norm(rel);
      if (reject.has(r)) throw enoent(rel);
      const t = tree.get(r);
      if (!t || t.type !== "directory") {
        throw enoent(rel);
      }
      const entries = [];
      for (const [p, v] of tree) {
        if (p === r) continue;
        if (p.startsWith(r + "/")) {
          const rest = p.slice(r.length + 1).split("/");
          if (rest.length === 1) {
            entries.push({ name: rest[0], type: v.type, size: v.size ?? 0, modifiedAt: Date.now() });
          }
        }
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { entries, scannedAt: Date.now(), truncated: truncated.has(r) };
    },

    async readFile(rel) {
      calls.read++;
      const r = norm(rel);
      if (reject.has(r)) throw enoent(rel);
      const t = tree.get(r);
      if (!t || t.type !== "file") throw enoent(rel);
      const content = contents.get(r) ?? "";
      return {
        content,
        encoding: "utf8",
        size: t.size ?? content.length,
        modifiedAt: Date.now(),
        truncated: truncatedRead.has(r),
        binary: false,
      };
    },

    async listTree(rel) {
      calls.list++;
      const r = norm(rel);
      const out = [];
      for (const [p, v] of tree) {
        if (p === r) continue;
        if (p.startsWith(r + "/")) {
          out.push({ name: p.slice(r.length + 1), type: v.type, size: v.size ?? 0, modifiedAt: Date.now() });
        }
      }
      out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { entries: out, truncated: false, scannedAt: Date.now() };
    },

    async listFilesAt(p) {
      return this.listFiles(p);
    },

    calls,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Context factory
// ──────────────────────────────────────────────────────────────────────
export function createContext(files, workspaceId = "ws-1") {
  return {
    machine: { id: "local", label: "local-machine" },
    workspace: {
      id: workspaceId,
      projectId: `proj-${workspaceId}`,
      path: `/workspaces/${workspaceId}`,
      label: workspaceId,
      isMain: true,
    },
    files,
    host: {},
    state: {},
    navigate: () => {},
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────
export const tick = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};
