// Read-only host integration. No live data/config/plugin root is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createDomStub } from '../test/dom-stub.js';
const host = process.argv[2];
if (!host) throw Error('Usage: node scripts/host-contract.mjs /path/to/@jmfederico/pi-web');
const root = fileURLToPath(new URL('..', import.meta.url));
const { PiWebPluginCatalog, readPiWebPluginPackageArtifact } = await import(pathToFileURL(resolve(host, 'dist/server/piWebPluginCatalog.js')));
const catalog = new PiWebPluginCatalog({ roots: [], configProvider: () => ({}), packageProvider: {
  listPackages: () => [{ source: root, scope: 'user', installedPath: root }], getInstalledPath: () => root,
} });
const snapshot = await catalog.snapshot();
assert.deepEqual(snapshot.diagnostics, []);
const record = snapshot.plugins.find(p => p.id === 'openspec-status');
assert.ok(record); assert.equal(record.browserModule.path, 'dist/pi-web-plugin.js'); assert.equal(record.browserRoot.path, 'dist');
const artifact = await readPiWebPluginPackageArtifact(root, record.browserRoot); assert.ok(artifact.files.has('dist/pi-web-plugin.js'));
Object.assign(globalThis, createDomStub());
const registry = new Map(); globalThis.customElements = { get: name => registry.get(name), define: (name, cls) => registry.set(name, cls) };
const { default: plugin } = await import('../dist/pi-web-plugin.js');
assert.equal(plugin.apiVersion, 5); assert.equal(typeof plugin.name, 'string'); assert.equal(typeof plugin.activate, 'function');
const c = (await plugin.activate({ html: (s, ...v) => ({ s, v }), svg: s => s })).contributions.workspacePanels[0];
assert.equal(c.id, 'openspec-status'); assert.deepEqual(c.invalidationResources, ['workspace.files']); assert.equal(typeof c.onInvalidate, 'function');
assert.equal(c.visible({ workspace: {} }), true); assert.equal(c.visible({}), false);
const api = await readFile(resolve(host, 'dist/plugin-api.d.ts'), 'utf8');
assert.match(api, /interface WorkspaceFileRequestOptions\s*\{\s*readonly signal\?: AbortSignal/);
assert.match(api, /readFile\(path: string, options\?: WorkspaceFileRequestOptions\)/);
assert.match(api, /listFiles\(path: string, options\?: WorkspaceFileRequestOptions\)/);
const version = JSON.parse(await readFile(resolve(host, 'package.json'), 'utf8')).version;
console.log(JSON.stringify({ hostVersion: version, id: record.id, module: record.browserModule.path, browserRoot: record.browserRoot.path, diagnostics: snapshot.diagnostics, status: 'PASS: real catalog/artifact + loader predicate + v5 contribution/signal contract', boundary: 'No live authenticated shell or production plugin install' }, null, 2));
