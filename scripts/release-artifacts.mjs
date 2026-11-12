// Retained, auditable test artifacts, not publication or deployment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const output = resolve(process.argv[2] || '/tmp/openspec-consolidation-artifacts');
if (!output.startsWith('/tmp/openspec-') || existsSync(output)) throw Error('Choose a new /tmp/openspec-* output directory');
mkdirSync(output, { recursive: true });
const baseline = '609c6bbe9be7cf586e87e94e6718978ea411e037';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain', '--', 'src', 'dist', 'package.json', 'README.md', 'LICENSE'], { encoding: 'utf8' }).trim()) throw Error('Package inputs must be committed');
const evidence = [];
for (const [label, sha] of [['rollback', baseline], ['candidate', head]]) {
  const root = join(output, label); mkdirSync(root);
  const archive = execFileSync('git', ['archive', sha, 'package.json', 'dist', 'README.md', 'LICENSE']);
  execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
  const names = result.files.map(f => f.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(['LICENSE', 'README.md', 'dist/pi-web-plugin.js', 'package.json'])) throw Error('Unexpected package files: ' + names);
  const bytes = readFileSync(join(root, result.filename));
  evidence.push({ label, sha, filename: `${label}/${result.filename}`, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: result.integrity, files: names, moduleSha256: createHash('sha256').update(readFileSync(join(root, 'dist/pi-web-plugin.js'))).digest('hex') });
}
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ output, evidence }, null, 2));
