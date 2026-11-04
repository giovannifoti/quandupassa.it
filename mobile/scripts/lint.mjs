// Analisi statica: ESLint + controlli di sicurezza specifici del progetto.
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [`${root}node_modules/eslint/bin/eslint.js`, '--max-warnings=0', 'src', 'scripts', 'tests', 'vite.config.mjs'], { cwd: root, stdio: 'inherit' });

const RULES = [
  [/\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/, 'inserimento di HTML non sicuro'],
  [/\beval\(|new Function\(/, 'esecuzione di codice dinamico'],
  [/['"`]http:\/\/(?!www\.w3\.org|localhost|127\.0\.0\.1)/, 'URL non cifrato (http://)'],
  [/AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[0-9A-Za-z]{30,}|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY/, 'possibile segreto'],
  [/google-analytics|googletagmanager|firebase|sentry|mixpanel|amplitude|facebook\.net|doubleclick/i, 'SDK di analisi o tracciamento']
];

const problems = [];
for (const file of (await readdir(`${root}src`)).map(name => `src/${name}`).concat(['index.html', 'capacitor.config.json'])) {
  const lines = (await readFile(`${root}${file}`, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    for (const [pattern, message] of RULES) if (pattern.test(line)) problems.push(`${file}:${index + 1} ${message}`);
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Analisi statica superata.');
