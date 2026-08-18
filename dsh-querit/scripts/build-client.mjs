/**
 * Build the browser bundle: inline the pure form model (src/form-model.js)
 * into the loader-wrapped module (src/card.js) and write lib/card.js.
 *
 * The output MUST NOT be lib/client.js: tsc already compiles src/client.ts
 * (the host-side QueritClient module) to lib/client.js, and overwriting it
 * breaks the host plugin's imports. The browser half is served from the
 * package's exports["./client"] subpath, which points at lib/card.js.
 *
 * The bundle must be self-contained (no imports — the browser loader only
 * provides `require`), so the single source of truth for the form logic lives
 * in src/form-model.js and this script copies its definitions verbatim into
 * the factory body. The node-side unit tests import the same file directly,
 * which keeps the browser and the tests on identical code.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const libDir = join(root, 'lib');
const marker = '/* __DSH_QUERIT_FORM_MODEL__ */';

const template = readFileSync(join(srcDir, 'card.js'), 'utf8');
let model = readFileSync(join(srcDir, 'form-model.js'), 'utf8');

// Strip the single-line re-export block and the per-definition `export` keyword
// so the definitions become plain declarations inside the factory body.
model = model.replace(/\nexport \{[^}]*\};\s*$/, '');
model = model.replace(/^export /gm, '');

if (!template.includes(marker)) {
  throw new Error(`src/card.js is missing the ${marker} insertion marker`);
}

mkdirSync(libDir, { recursive: true });
const output = template.replace(marker, model);
writeFileSync(join(libDir, 'card.js'), output);
console.log(`built lib/card.js (${output.length} bytes)`);