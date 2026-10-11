// Copie le jeu compilé (dist/index.html, fichier unique) dans jouer/index.html.
// GitHub Pages en mode « Deploy from a branch » sert les fichiers du dépôt tels quels :
// la page racine (sources Vite) redirige alors vers cette copie compilée.
// Usage : npm run build:pages
import fs from 'node:fs';

fs.mkdirSync('jouer', { recursive: true });
fs.copyFileSync('dist/index.html', 'jouer/index.html');
const kb = fs.statSync('jouer/index.html').size / 1024;
console.log(`jouer/index.html : ${kb.toFixed(0)} Ko`);
