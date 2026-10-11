// Transforme dist/index.html (page autonome) en fragment de page pour un hébergeur
// qui fournit lui-même le squelette <!doctype>/<html>/<head>/<body>.
// Usage : node scripts/build-artifact.mjs [sortie] (défaut : dist/artifact.html)
import fs from 'node:fs';

const src = fs.readFileSync('dist/index.html', 'utf8');
const out = process.argv[2] ?? 'dist/artifact.html';

const pick = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error(`Élément introuvable dans dist/index.html : ${what}`);
  return m[0];
};

const title = pick(/<title>[\s\S]*?<\/title>/, 'title');
const fonts = [...src.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
const style = pick(/<style>[\s\S]*?<\/style>/, 'style');
const script = pick(/<script type="module">[\s\S]*?<\/script>/, 'script');
const app = pick(/<div id="app">[\s\S]*?<\/div>\s*<\/div>/, 'app');

const page = [title, ...fonts, style, app, script].join('\n');
fs.writeFileSync(out, page);
console.log(`${out} : ${(page.length / 1024).toFixed(0)} Ko`);
