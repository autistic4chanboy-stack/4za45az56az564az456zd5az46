import { h, btn, clear } from './dom';
import { icon } from './icons';
import { DIFFICULTIES, type Difficulty } from '../data/balance';
import { saveSummary, loadGame, hasStorage, exportSave, importSave, deleteSave, saveGame, type Settings } from '../state/save';
import { loadMeta, saveMeta, META_PERKS } from '../state/meta';
import { formatTime } from '../core/math';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { GameMode, GameState } from '../state/types';

let menuEl: HTMLElement | null = null;

function closeMenu(ui: UI): void {
  menuEl?.remove();
  menuEl = null;
  ui.menuOpen = false;
}

export function showMainMenu(ui: UI, game: Game): void {
  closeMenu(ui);
  ui.menuOpen = true;
  const inner = h('div', { class: 'menu-inner interactive' });
  menuEl = h('div', { class: 'menu interactive' }, inner);
  ui.root.appendChild(menuEl);
  renderHome(ui, game, inner);
}

function renderHome(ui: UI, game: Game, inner: HTMLElement): void {
  clear(inner);
  const story = saveSummary('histoire');
  const inf = saveSummary('infini');
  const meta = loadMeta();
  inner.append(
    h('h1', { class: 'title' }, 'Rails', h('br'), 'de Cendres'),
    h('div', { class: 'tagline' }, 'Tower defense · Rogue-like · Exploration'),
  );
  if (story) {
    inner.append(btn([icon('play', 16), `Continuer l'histoire — ${story.station}, jour ${story.day}`], () => {
      const s = loadGame('histoire');
      if (s) start(ui, game, () => game.loadState(s));
      else ui.toast('Sauvegarde illisible.', 'mauvais');
    }, 'primary'));
  }
  if (inf) {
    inner.append(btn([icon('play', 16), `Continuer l'infini — ${inf.station}, jour ${inf.day}`], () => {
      const s = loadGame('infini');
      if (s) start(ui, game, () => game.loadState(s));
    }, story ? '' : 'primary'));
  }
  inner.append(
    btn([icon('book', 16), 'Nouvelle partie — Histoire'], () => renderNewGame(ui, game, inner, 'histoire')),
    btn([icon('fast', 16), 'Mode Infini (rogue-like)'], () => renderNewGame(ui, game, inner, 'infini')),
    btn([icon('star', 16), `Héritage (${meta.points} pts)`], () => renderHeritage(ui, game, inner)),
    btn([icon('gear', 16), 'Options'], () => renderOptions(ui, game, inner, () => renderHome(ui, game, inner))),
    btn([icon('journal', 16), 'Aide & commandes'], () => renderHelp(ui, game, inner, () => renderHome(ui, game, inner))),
    btn([icon('bag', 16), 'Importer une sauvegarde'], () => renderImport(ui, game, inner)),
    h('div', { class: 'foot' },
      hasStorage() ? 'Sauvegarde automatique à chaque gare (stockage local du navigateur).' : 'Stockage local indisponible : utilisez l\'export de sauvegarde.',
      h('br'),
      `Meilleure distance en infini : gare n°${meta.bestLayer} · ${meta.runs} partie(s).`,
    ),
  );
}

/** Reprend directement une partie (rechargement à chaud de la page publiée). */
export function resumeGame(ui: UI, game: Game, state: GameState): void {
  start(ui, game, () => game.loadState(state));
}

function start(ui: UI, game: Game, fn: () => void): void {
  game.audio.unlock();
  closeMenu(ui);
  ui.fade(true, () => {
    fn();
    ui.hud.setVisible(true);
    ui.fade(false);
  });
}

function renderNewGame(ui: UI, game: Game, inner: HTMLElement, mode: GameMode): void {
  clear(inner);
  let diff: Difficulty = 'normal';
  const nameInput = h('input', { type: 'text', value: 'Conducteur', maxlength: 24, style: 'width:100%' }) as HTMLInputElement;
  const seedInput = h('input', { type: 'text', placeholder: 'Aléatoire', style: 'width:100%' }) as HTMLInputElement;
  const diffRow = h('div', { class: 'choice' });
  const desc = h('div', { class: 'muted small', style: 'min-height:36px' });
  const renderDiff = () => {
    clear(diffRow);
    for (const d of Object.keys(DIFFICULTIES) as Difficulty[]) {
      diffRow.append(btn(DIFFICULTIES[d].name, () => {
        diff = d;
        renderDiff();
      }, d === diff ? 'active' : ''));
    }
    desc.textContent = DIFFICULTIES[diff].desc;
  };
  renderDiff();
  inner.append(
    h('h1', { class: 'title', style: 'font-size:40px' }, mode === 'histoire' ? 'Le Remède' : 'Mode Infini'),
    h('div', { class: 'tagline' }, mode === 'histoire' ? 'Campagne scénarisée · 17 gares' : 'Réseau procédural sans fin · mort définitive'),
    h('div', { class: 'muted' }, mode === 'histoire'
      ? 'La Fièvre Grise ronge Cendrebourg. Traversez le Réseau jusqu\'à la Station Polaris pour synthétiser le remède. Choix, trahisons et deux saisons.'
      : 'Gares générées à l\'infini sur 8 biomes et 20 types de gares. La difficulté monte avec la distance, l\'été et l\'hiver alternent. Vos points d\'Héritage débloquent des avantages de départ.'),
    h('label', { class: 'small muted' }, 'Nom du conducteur'), nameInput,
    h('label', { class: 'small muted' }, 'Difficulté'), diffRow, desc,
  );
  if (mode === 'infini') {
    const meta = loadMeta();
    inner.append(h('label', { class: 'small muted' }, 'Graine (optionnelle)'), seedInput);
    if (meta.active.length) inner.append(h('div', { class: 'small' }, 'Héritage actif : ', meta.active.map((p) => META_PERKS[p]?.name).join(', ')));
  }
  inner.append(
    h('div', { class: 'row', style: 'margin-top:10px' },
      btn('Retour', () => renderHome(ui, game, inner)),
      btn([icon('play', 16), 'Commencer'], () => {
        const seedText = seedInput.value.trim();
        const seed = seedText ? (Number.isFinite(Number(seedText)) ? Number(seedText) : hashSeed(seedText)) : undefined;
        if (mode === 'infini') deleteSave('infini');
        start(ui, game, () => game.newGame({ mode, difficulty: diff, playerName: nameInput.value, seed }));
      }, 'primary'),
    ),
  );
}

function hashSeed(s: string): number {
  let h1 = 0;
  for (let i = 0; i < s.length; i++) h1 = (Math.imul(h1, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h1);
}

function renderHeritage(ui: UI, game: Game, inner: HTMLElement): void {
  clear(inner);
  const meta = loadMeta();
  inner.append(h('h1', { class: 'title', style: 'font-size:40px' }, 'Héritage'), h('div', { class: 'tagline' }, `${meta.points} points disponibles`));
  inner.append(h('div', { class: 'muted small' }, 'Gagnez des points en mode Infini (distance parcourue, ennemis abattus). Débloquez des avantages, puis activez-les pour vos prochaines parties.'));
  const list = h('div', { class: 'list', style: 'max-height:52vh;overflow:auto' });
  for (const p of Object.values(META_PERKS)) {
    const unlocked = meta.unlocked.includes(p.id);
    const active = meta.active.includes(p.id);
    list.append(h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), h('div', { class: 'sub' }, p.desc)),
      unlocked
        ? btn(active ? 'Actif' : 'Activer', () => {
          meta.active = active ? meta.active.filter((x) => x !== p.id) : [...meta.active, p.id];
          saveMeta(meta);
          renderHeritage(ui, game, inner);
        }, `small ${active ? 'active' : ''}`)
        : btn(`${p.cost} pts`, () => {
          if (meta.points < p.cost) return ui.toast('Pas assez de points d\'héritage.', 'mauvais');
          meta.points -= p.cost;
          meta.unlocked.push(p.id);
          meta.active.push(p.id);
          saveMeta(meta);
          game.audio.play('success');
          renderHeritage(ui, game, inner);
        }, 'small', { disabled: meta.points < p.cost }),
    ));
  }
  inner.append(list, btn('Retour', () => renderHome(ui, game, inner)));
}

export function renderOptions(ui: UI, game: Game, inner: HTMLElement, back: () => void): void {
  clear(inner);
  const s = game.settings;
  const slider = (label: string, key: 'master' | 'sfx' | 'music' | 'ambient') => {
    const input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key] }) as HTMLInputElement;
    input.addEventListener('input', () => {
      s[key] = Number(input.value);
      game.applySettings();
    });
    return h('div', null, h('div', { class: 'small muted' }, label), input);
  };
  const quality = h('div', { class: 'choice' });
  const renderQ = () => {
    clear(quality);
    for (const q of ['basse', 'moyenne', 'haute'] as const) quality.append(btn(q, () => { s.quality = q; game.applySettings(); renderQ(); }, s.quality === q ? 'active' : ''));
  };
  renderQ();
  const pixels = h('div', { class: 'choice' });
  const renderPx = () => {
    clear(pixels);
    const sizes: [number, string][] = [[0, 'auto'], [2, 'fins'], [3, 'moyens'], [4, 'gros'], [5, 'énormes']];
    for (const [v, label] of sizes) pixels.append(btn(label, () => { s.pixelSize = v; game.applySettings(); renderPx(); }, s.pixelSize === v ? 'active small' : 'small'));
  };
  renderPx();
  const palette = h('div', { class: 'choice' });
  const renderPal = () => {
    clear(palette);
    const modes: [Settings['palette'], string][] = [['paliers', 'Paliers (DA)'], ['stricte', 'Palette tramée'], ['aucune', 'Couleurs libres']];
    for (const [v, label] of modes) palette.append(btn(label, () => { s.palette = v; game.applySettings(); renderPal(); }, s.palette === v ? 'active small' : 'small'));
  };
  renderPal();
  const toggle = (label: string, key: 'shadows' | 'showFps' | 'screenShake' | 'tutorial' | 'outlines' | 'bloom') => {
    const b = btn(`${label} : ${s[key] ? 'oui' : 'non'}`, () => {
      s[key] = !s[key];
      game.applySettings();
      b.textContent = `${label} : ${s[key] ? 'oui' : 'non'}`;
    }, 'small');
    return b;
  };
  inner.append(
    h('h2', { style: 'font-size:30px' }, 'Options'),
    slider('Volume général', 'master'),
    slider('Effets sonores', 'sfx'),
    slider('Musique', 'music'),
    slider('Ambiance', 'ambient'),
    h('div', { class: 'small muted' }, 'Qualité graphique'), quality,
    h('div', { class: 'small muted' }, 'Taille des pixels'), pixels,
    h('div', { class: 'small muted' }, 'Couleurs'), palette,
    h('div', { class: 'row wrap' }, toggle('Contours', 'outlines'), toggle('Halos lumineux', 'bloom'), toggle('Ombres', 'shadows')),
    h('div', { class: 'row wrap' }, toggle('Secousses', 'screenShake'), toggle('Afficher les i/s', 'showFps'), toggle('Astuces', 'tutorial')),
    btn('Retour', back),
  );
}

export function renderHelp(ui: UI, game: Game, inner: HTMLElement, back: () => void): void {
  clear(inner);
  const mv = game.input.moveKeysLabel();
  const rows: [string, string][] = [
    [`${mv} / flèches`, 'Se déplacer'],
    ['Maj', 'Sprinter'],
    ['Espace', 'Esquive (invulnérable un instant)'],
    ['Souris + clic gauche', 'Viser et tirer'],
    ['Clic droit', 'Coup de clé à molette'],
    ['1 à 4', 'Changer d\'arme'],
    ['R', 'Recharger'],
    ['E', 'Interagir (maintenir pour réparer, forcer…)'],
    ['F', 'Lampe torche'],
    ['H / X / G', 'Trousse de soins / anti-rad / dynamite'],
    ['Tab', 'Tableau de bord (train, énergie, équipage…)'],
    ['T / K / C / I / J / M / P', 'Train / Énergie / Équipage / Inventaire / Journal / Carte / Atouts'],
    ['+ / −', 'Régulateur de vitesse (en cabine ou avec un chauffeur)'],
    ['V', 'Accélérer le temps (hors combat)'],
    ['Molette', 'Zoom'],
    ['Échap', 'Pause / fermer'],
  ];
  inner.append(
    h('h2', { style: 'font-size:30px' }, 'Aide'),
    h('div', { class: 'kv', style: 'max-height:40vh;overflow:auto' }, rows.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', null, v)])),
    h('div', { class: 'small muted', style: 'line-height:1.5' },
      'Le train est votre base : il roule au charbon, sa dynamo produit l\'énergie que vous répartissez entre lumière, chauffage, armement et boucliers. ',
      'Entre deux gares, des bandits ou des monstres attaquent : tourelles automatiques, tireurs de l\'équipage ou vous-même aux commandes. ',
      'Un wagon détruit se détache et emporte tous ceux qui le suivent : réparez-le (E sur son panneau) ou évacuez ses occupants vers l\'avant. ',
      'En gare, explorez les bâtiments : codes sur des notes, serrures à crocheter, badges d\'accès, barricades à forcer.'),
    btn('Retour', back),
  );
}

/** Import d'une sauvegarde : texte collé (fonctionne partout) ou fichier JSON. */
function renderImport(ui: UI, game: Game, inner: HTMLElement): void {
  clear(inner);
  const area = h('textarea', { class: 'save-text', id: 'import-save', placeholder: 'Collez ici le texte de votre sauvegarde…', spellcheck: 'false' }) as HTMLTextAreaElement;
  const load = () => {
    const state = importSave(area.value.trim());
    if (!state) return ui.toast('Ce texte n\'est pas une sauvegarde valide de Rails de Cendres.', 'mauvais');
    start(ui, game, () => game.loadState(state));
  };
  inner.append(
    h('h2', { style: 'font-size:30px' }, 'Importer'),
    h('div', { class: 'small muted' }, 'Collez le texte obtenu avec « Exporter la sauvegarde » (menu Pause), ou choisissez un fichier .json.'),
    area,
    h('div', { class: 'row wrap' },
      btn([icon('play', 16), 'Charger ce texte'], load, 'primary'),
      btn([icon('bag', 16), 'Choisir un fichier…'], () => importFile(ui, game)),
      btn('Retour', () => renderHome(ui, game, inner)),
    ),
  );
}

function importFile(ui: UI, game: Game): void {
  const input = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const text = await f.text();
    const state = importSave(text);
    if (!state) return ui.toast('Fichier de sauvegarde invalide.', 'mauvais');
    start(ui, game, () => game.loadState(state));
  });
  document.body.appendChild(input);
  input.click();
  window.setTimeout(() => input.remove(), 60000);
}

export function showPauseMenu(ui: UI, game: Game): void {
  const body = h('div', { class: 'stack' });
  const st = game.state;
  const atStation = !!game.stationLevel();
  body.append(
    h('div', { class: 'muted small' }, `${st.mode === 'histoire' ? 'Histoire' : 'Infini'} · ${DIFFICULTIES[st.difficulty].name} · Jour ${Math.floor(st.time / 1440) + 1}, ${formatTime(st.time)} · ${st.stats.stations} gares · ${st.stats.kills} ennemis abattus`),
    btn([icon('play', 16), 'Reprendre'], () => ui.closeModal(), 'primary'),
    btn([icon('bag', 16), 'Sauvegarder'], () => {
      if (!atStation) return ui.toast('Sauvegarde possible uniquement en gare.', 'mauvais');
      const ok = saveGame(st, st.map.nodes[st.map.current]?.name ?? '');
      ui.toast(ok ? 'Partie sauvegardée.' : 'Échec de la sauvegarde.', ok ? 'bon' : 'mauvais');
    }, '', { disabled: !atStation }),
    btn([icon('journal', 16), 'Exporter la sauvegarde'], () => {
      openExport(ui, game);
    }),
    btn([icon('gear', 16), 'Options'], () => {
      const inner = h('div', { class: 'stack' });
      ui.openModal(inner, { title: 'Options', className: 'narrow' });
      renderOptions(ui, game, inner, () => ui.closeModal());
    }),
    btn([icon('journal', 16), 'Aide & commandes'], () => {
      const inner = h('div', { class: 'stack' });
      ui.openModal(inner, { title: 'Aide', className: 'narrow' });
      renderHelp(ui, game, inner, () => ui.closeModal());
    }),
    btn([icon('close', 16), 'Quitter vers le menu'], () => {
      ui.closeAll();
      game.quitToMenu();
    }, 'danger'),
  );
  ui.openModal(body, { title: 'Pause', className: 'narrow' });
}

/** Export : texte à copier (toujours disponible) et fichier (si le navigateur l'autorise). */
function openExport(ui: UI, game: Game): void {
  const st = game.state;
  const text = exportSave(st);
  const area = h('textarea', { class: 'save-text', id: 'export-save', readonly: true, spellcheck: 'false' }, text) as HTMLTextAreaElement;
  area.value = text;
  const copy = () => {
    const fallback = () => {
      area.focus();
      area.select();
      ui.toast('Texte sélectionné : copiez-le avec Ctrl+C (ou appui long).', 'info');
    };
    try {
      navigator.clipboard.writeText(text).then(() => ui.toast('Sauvegarde copiée dans le presse-papiers.', 'bon'), fallback);
    } catch {
      fallback();
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `rails-de-cendres-${st.mode}-jour${Math.floor(st.time / 1440) + 1}.json` }) as HTMLAnchorElement;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'small muted' }, 'Gardez ce texte en lieu sûr (note, message…). Pour reprendre la partie ailleurs : menu principal › Importer une sauvegarde, puis collez-le.'),
    area,
    h('div', { class: 'row wrap' },
      btn([icon('journal', 16), 'Copier le texte'], copy, 'primary'),
      btn([icon('bag', 16), 'Télécharger un fichier'], download),
    ),
  );
  ui.openModal(body, { title: 'Exporter la sauvegarde', className: 'narrow' });
}

export function showGameOver(ui: UI, game: Game, victory: boolean, reason: string, heritage: number): void {
  const st = game.state;
  const body = h('div', { class: 'stack' },
    h('div', { style: 'font-size:18px' }, reason),
    h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Gares visitées'), h('span', null, String(st.stats.stations)),
      h('span', { class: 'k' }, 'Distance'), h('span', null, `${(st.stats.distance / 1000).toFixed(1)} km`),
      h('span', { class: 'k' }, 'Ennemis abattus'), h('span', null, String(st.stats.kills)),
      h('span', { class: 'k' }, 'Attaques subies'), h('span', null, String(st.stats.attacks)),
      h('span', { class: 'k' }, 'Jours de voyage'), h('span', null, String(Math.floor(st.time / 1440) + 1)),
    ),
    st.mode === 'infini' ? h('div', { class: 'pill good', style: 'font-size:14px' }, `+${heritage} points d'Héritage`) : null,
  );
  const foot = [
    st.mode === 'histoire' && !victory ? btn('Recharger la dernière gare', () => {
      const s = loadGame('histoire');
      ui.closeAll();
      if (s) game.loadState(s);
      else game.quitToMenu();
    }, 'primary') : null,
    btn('Menu principal', () => {
      ui.closeAll();
      game.quitToMenu();
    }, st.mode === 'infini' || victory ? 'primary' : ''),
  ].filter(Boolean) as HTMLElement[];
  ui.openModal(body, { title: victory ? 'Victoire' : 'Fin du voyage', className: 'narrow', locked: true }, foot);
}
