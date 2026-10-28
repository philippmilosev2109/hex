// Kontrast-Prüfung nach WCAG 2.1 (Stufe AA)
// Liest die Farben aus den CSS-Variablen in public/style.css (:root) und prüft
// alle Farbpaare, die in der Oberfläche tatsächlich vorkommen.
//   Text:          mindestens 4,5 : 1
//   große Schrift: mindestens 3 : 1   (ab 24 px oder 18,66 px fett)
//   Grafik/Rahmen: mindestens 3 : 1   (z. B. Steine, Fokus-Rahmen, Brettränder)
// Zusätzlich: Außerhalb von :root darf keine Farbe fest im CSS stehen.
//
// Start: npm run contrast

'use strict';

const fs = require('fs');
const path = require('path');

const CSS_DATEI = path.join(__dirname, '..', 'public', 'style.css');
const TEXT = 4.5;
const GROSS = 3;
const GRAFIK = 3;

// [Vordergrund, Hintergrund, Mindestwert, Wo kommt das vor?]
const PAARE = [
  // Normale Schrift auf allen Flächen
  ['--text', '--bg', TEXT, 'Schrift auf dem Seitenhintergrund (Kopfzeile)'],
  ['--text', '--flaeche', TEXT, 'Schrift in Karten und Panel (unten)'],
  ['--text', '--flaeche-oben', TEXT, 'Schrift in Karten und Panel (oben)'],
  ['--text', '--flaeche-hoch', TEXT, 'Schrift auf sekundären Knöpfen, Pillen, Meldungen'],
  ['--text', '--flaeche-tief', TEXT, 'Eingabefeld, Statusbox'],
  // Nebentexte
  ['--text-2', '--bg', TEXT, 'Nebentext auf dem Seitenhintergrund'],
  ['--text-2', '--flaeche', TEXT, 'Untertitel, Zugzähler, Spielerfarbe (unten)'],
  ['--text-2', '--flaeche-oben', TEXT, 'Untertitel, Panel-Titel (oben)'],
  ['--text-2', '--flaeche-hoch', TEXT, 'Pille "Angemeldet als", "(du)" beim Spieler am Zug'],
  ['--text-2', '--flaeche-tief', TEXT, 'Platzhalter im Eingabefeld, Statustext'],
  // Farbige Schrift auf dunklem Grund
  ['--rot-text', '--flaeche', TEXT, 'Fehlermeldung unter dem Namensfeld, "Rot ↕"'],
  ['--rot-text', '--flaeche-oben', TEXT, 'Fehlermeldung / Regeltext (oberer Kartenteil)'],
  ['--rot-text', '--flaeche-tief', TEXT, 'Uhr unter 20 Sekunden'],
  ['--rot-text', '--uhr-knapp', TEXT, 'Uhr unter 20 Sekunden (Puls-Hintergrund)'],
  ['--text', '--uhr-knapp', TEXT, 'Schrift auf Puls-Hintergrund'],
  ['--blau-text', '--flaeche', TEXT, '"Blau ↔" im Regeltext'],
  ['--blau-text', '--flaeche-oben', TEXT, '"Blau ↔" im Regeltext (oben)'],
  ['--blau-text', '--flaeche-tief', TEXT, '"Swap-Regel:" im Erklärtext, blauer Name im Chat'],
  ['--text-2', '--flaeche-hoch', TEXT, 'Nicht gewählter Reiter auf hervorgehobener Fläche'],
  ['--blau', '--flaeche-tief', GRAFIK, 'Blauer Rahmen der Swap-Box'],
  // Weiße Schrift auf farbigen Flächen
  ['--auf-farbe', '--rot', TEXT, 'Primärknopf, Logo (heller Teil)'],
  ['--auf-farbe', '--rot-dunkel', TEXT, 'Primärknopf (dunkler Teil, Hover)'],
  ['--auf-farbe', '--blau', TEXT, 'Blauer Knopf (heller Teil)'],
  ['--auf-farbe', '--blau-dunkel', TEXT, 'Blauer Knopf (dunkler Teil, Hover)'],
  ['--auf-farbe', '--warnung', TEXT, 'Hinweis "Verbindung verloren"'],
  // Grafische Elemente
  ['--fokus', '--bg', GRAFIK, 'Fokus-Rahmen auf dem Seitenhintergrund'],
  ['--fokus', '--flaeche', GRAFIK, 'Fokus-Rahmen in Karten'],
  ['--fokus', '--flaeche-hoch', GRAFIK, 'Fokus-Rahmen um sekundäre Knöpfe'],
  ['--fokus', '--flaeche-tief', GRAFIK, 'Gelber Rahmen um ein Revanche-Angebot'],
  ['--rahmen-stark', '--flaeche-oben', GRAFIK, 'Rahmen des Eingabefelds zur Karte'],
  ['--rahmen-stark', '--flaeche-tief', GRAFIK, 'Rahmen des Eingabefelds zum Feldinneren'],
  ['--rot', '--bg', GRAFIK, 'Roter Brettrand'],
  ['--blau', '--bg', GRAFIK, 'Blauer Brettrand'],
  ['--rot', '--flaeche-tief', GRAFIK, 'Roter Rahmen der Statusbox'],
  ['--blau', '--flaeche-tief', GRAFIK, 'Blauer Rahmen der Statusbox'],
  ['--text-2', '--bg', TEXT, 'Koordinaten A–K / 1–11 am Brettrand'],
  ['--letzter-zug', '--feld', GRAFIK, 'Ring um den letzten Zug (auf dem Feld)'],
  ['--letzter-zug', '--rot', GRAFIK, 'Ring um den letzten Zug (an rotem Stein)'],
  ['--letzter-zug', '--blau', GRAFIK, 'Ring um den letzten Zug (an blauem Stein)'],
  ['--rot', '--flaeche-tief', GRAFIK, 'Roter Punkt im Zugverlauf'],
  ['--blau', '--flaeche-tief', GRAFIK, 'Blauer Punkt im Zugverlauf'],
  ['--stein-rot-licht', '--feld', GRAFIK, 'Roter Stein: Kante gegen das Feld'],
  ['--stein-blau-licht', '--feld', GRAFIK, 'Blauer Stein: Kante gegen das Feld'],
  ['--auf-farbe', '--rot', GRAFIK, 'Symbol ↕ im roten Spieler-Sechseck'],
  ['--auf-farbe', '--blau', GRAFIK, 'Symbol ↔ im blauen Spieler-Sechseck'],
];

// ---------- Farben aus dem CSS lesen ----------
const css = fs.readFileSync(CSS_DATEI, 'utf8');
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!rootBlock) throw new Error(':root-Block nicht gefunden');

const variablen = {};
for (const [, name, wert] of rootBlock[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\s*;/g)) {
  variablen[`--${name}`] = wert;
}

function hexZuRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(z => z + z).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

// Relative Leuchtdichte nach WCAG
function leuchtdichte(hex) {
  const [r, g, b] = hexZuRgb(hex).map(kanal => {
    const s = kanal / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

// ---------- Prüfen ----------
let fehler = 0;
console.log('Kontrast-Prüfung (WCAG 2.1 AA)\n');
for (const [vorne, hinten, minimum, wo] of PAARE) {
  const a = variablen[vorne];
  const b = variablen[hinten];
  if (!a || !b) {
    console.log(`✗ Unbekannte Variable: ${!a ? vorne : hinten} (${wo})`);
    fehler++;
    continue;
  }
  const wert = kontrast(a, b);
  const ok = wert >= minimum;
  if (!ok) fehler++;
  const zeile = `${ok ? '✓' : '✗'} ${wert.toFixed(2).padStart(5)} : 1  (min ${minimum})  ${vorne} ${a} auf ${hinten} ${b}`;
  console.log(`${zeile.padEnd(84)} ${wo}`);
}

// Feste Farben außerhalb von :root aufspüren (Farben gehören in Variablen)
const ohneRoot = css.replace(rootBlock[0], '').replace(/url\("data:[^"]*"\)/g, '');
const festeFarben = ohneRoot.match(/#[0-9a-fA-F]{3,6}\b|rgba?\(/g) || [];
if (festeFarben.length) {
  console.log(`\n✗ ${festeFarben.length} feste Farbe(n) außerhalb von :root: ${[...new Set(festeFarben)].join(', ')}`);
  fehler++;
}

console.log(fehler ? `\n${fehler} Problem(e) gefunden.` : `\nAlle ${PAARE.length} Farbpaare bestehen.`);
process.exit(fehler ? 1 : 0);
