/**
 * Harness for the README screenshots.
 *
 * It builds a self-contained HTML page that mounts the real plugin
 * (`dist/pi-web-plugin.js`) with a synthetic `openspec/changes/` tree behind a
 * simulated PI WEB files API. Nothing real is read: the tree comes only from
 * the fixture you pass in, so a screenshot cannot leak a project, a path or a
 * session.
 *
 * Usage, from a Pi `browser_execute` snippet or any CDP client:
 *
 *   const { buildHtml } = await import('<repo>/scripts/panel-screenshot-harness.mjs');
 *   const html = await buildHtml({ fixture: '<repo>/fixtures/os-partial' });
 *   // then: Page.setDocumentContent({ frameId, html }), wait for the panel,
 *   // and Page.captureScreenshot({ clip }) on the openspec-status-panel box.
 *
 * Optional:
 *   PI_WEB_THEME_CSS=/path/to/pi-web-plugins/themes/assets/pi-web-dark.css
 *   (or `themeCssPath`) reuses PI WEB's real theme variables. Without it the
 *   page falls back to neutral colours, so the layout is identical but the
 *   palette is not PI WEB's.
 *
 * The README images were captured this way from a throwaway synthetic tree
 * (five active changes plus two archived ones); any fixture with an
 * `openspec/changes/` directory works.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FALLBACK_THEME = `:root {
  color-scheme: dark;
  --pi-bg: #101014;
  --pi-text: #f4f4f6;
  --pi-muted: #9aa0aa;
}`;

async function walk(root) {
  const entries = [];
  async function rec(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        entries.push({ path: full, dir: true });
        await rec(full);
      } else if (entry.isFile()) {
        entries.push({ path: full, dir: false });
      }
    }
  }
  await rec(root);
  return entries;
}

export async function buildHtml({ fixture, themeCssPath = process.env.PI_WEB_THEME_CSS, padding = 20 } = {}) {
  if (typeof fixture !== 'string' || fixture === '') {
    throw new Error('buildHtml needs a fixture directory containing openspec/changes/');
  }
  const root = resolve(fixture).replace(/\/+$/, '');
  const pluginSource = await readFile(join(REPO, 'dist', 'pi-web-plugin.js'), 'utf8');
  const themeCss = themeCssPath ? await readFile(themeCssPath, 'utf8') : FALLBACK_THEME;
  const entries = await walk(root);
  const tree = {};
  const contents = {};
  for (const entry of entries) {
    const rel = entry.path.slice(root.length + 1);
    tree[rel] = entry.dir ? { type: 'directory' } : { type: 'file', size: (await stat(entry.path)).size };
    if (!entry.dir) contents[rel] = await readFile(entry.path, 'utf8');
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OpenSpec panel</title>
<style>${themeCss}</style>
<style>
  html, body { margin: 0; }
  body {
    background: var(--pi-bg, #070912);
    color: var(--pi-text, #f7f4ff);
    font-family: var(--pi-font, system-ui, sans-serif);
    padding: ${padding}px;
    box-sizing: border-box;
  }
  #panel { background: var(--pi-surface, transparent); border-radius: 12px; padding: 14px; }
</style></head>
<body><div id="panel"></div>
<script type="module">
const src = ${JSON.stringify(pluginSource)};
const tree = ${JSON.stringify(tree)};
const contents = ${JSON.stringify(contents)};
const mod = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
customElements.define('openspec-status-panel', mod.OpenspecPanelElement);
const norm = (p) => p.replace(/\\/+$/, '');
const files = {
  async listFiles(path) {
    path = norm(path);
    if (tree[path]?.type !== 'directory') throw new Error('Not found');
    return {
      entries: Object.entries(tree)
        .filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
        .map(([k, v]) => ({ name: k.slice(path.length + 1), ...v, modifiedAt: 1 })),
      truncated: false,
    };
  },
  async readFile(path) {
    if (!(path in contents)) throw new Error('Not found');
    return { content: contents[path], binary: false, truncated: false };
  },
};
const el = document.createElement('openspec-status-panel');
const host = { requestRender() { el.requestUpdate?.(); } };
el.context = { machine: { id: 'local' }, workspace: { id: 'demo' }, files, host };
document.getElementById('panel').appendChild(el);
window.__panel = el;
</script></body></html>`;
}
