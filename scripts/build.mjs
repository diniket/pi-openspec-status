// Build: copia la fonte (già ES module autonomo, nessun toolchain) in dist/.
// Il plugin deve essere distribuito come file già compilato: PI WEB non
// compila il sorgente dei plugin installati.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(import.meta.dirname, "../src/pi-web-plugin.js");
const outDir = resolve(import.meta.dirname, "../dist");
const out = resolve(outDir, "pi-web-plugin.js");

if (!existsSync(src)) throw new Error(`src mancante: ${src}`);
mkdirSync(outDir, { recursive: true });
copyFileSync(src, out);
console.log(`copiato ${src} -> ${out}`);
