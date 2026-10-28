// Kontrast-Prüfung nach WCAG 2.1 (Stufe AA)
// Liest die Farben aus den CSS-Variablen in public/style.css und prüft alle
// Farbpaare, die in der Oberfläche tatsächlich vorkommen – und zwar für BEIDE
// Designs: dunkel (:root) und hell (:root[data-theme="hell"] überschreibt :root).
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
  ['--rot-text', '--flaeche', TEXT, 'Fehlermeldung unter dem Namensfeld'],
  ['--rot-text', '--flaeche-oben', TEXT, 'Fehlermeldung (oberer Kartenteil)'],
  ['--rot-text', '--flaeche-tief', TEXT, 'Uhr unter 20 Sekunden'],
  ['--rot-text', '--uhr-knapp', TEXT, 'Uhr unter 20 Sekunden (Puls-Hintergrund)'],
  ['--text', '--uhr-knapp', TEXT, 'Schrift auf Puls-Hintergrund'],
  ['--rot-text', '--flaeche-hoch', TEXT, 'Roter Name in der Liste laufender Spiele'],
  ['--blau-text', '--flaeche-hoch', TEXT, 'Blauer Name in der Liste laufender Spiele'],
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
  ['--stein-rot-rand', '--feld', GRAFIK, 'Roter Stein: Kante gegen das Feld'],
  ['--stein-blau-rand', '--feld', GRAFIK, 'Blauer Stein: Kante gegen das Feld'],
  ['--gewinn', '--feld', GRAFIK, 'Rand der Steine im Gewinnpfad gegen das Feld'],
  ['--fokus', '--feld', GRAFIK, 'Tastatur-Rahmen um das gewählte Feld'],
  ['--auf-farbe', '--rot', GRAFIK, 'Symbol ↕ im roten Spieler-Sechseck'],
  ['--auf-farbe', '--blau', GRAFIK, 'Symbol ↔ im blauen Spieler-Sechseck'],
];

// ---------- Farben aus dem CSS lesen ----------
const css = fs.readFileSync(CSS_DATEI, 'utf8');
const dunkelBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
const hellBlock = css.match(/:root\[data-theme="hell"\]\s*\{([\s\S]*?)\n\}/);
if (!dunkelBlock) throw new Error(':root-Block nicht gefunden');
if (!hellBlock) throw new Error(':root[data-theme="hell"]-Block nicht gefunden');

// Alle Variablen mit Hex-Farbwert aus einem Block lesen
function leseFarben(block) {
  const farben = {};
  for (const [, name, wert] of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\s*;/g)) {
    farben[`--${name}`] = wert;
  }
  return farben;
}

const dunkel = leseFarben(dunkelBlock[1]);
// Das helle Design übernimmt alles, was es nicht selbst überschreibt, vom dunklen
const DESIGNS = [
  ['Dunkles Design', dunkel],
  ['Helles Design', { ...dunkel, ...leseFarben(hellBlock[1]) }],
];

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
console.log('Kontrast-Prüfung (WCAG 2.1 AA)');
for (const [designName, variablen] of DESIGNS) {
  console.log(`\n== ${designName} ==`);
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
}

// Feste Farben außerhalb der beiden Farbblöcke aufspüren (Farben gehören in Variablen)
const ohneRoot = css.replace(dunkelBlock[0], '').replace(hellBlock[0], '').replace(/url\("data:[^"]*"\)/g, '');
const festeFarben = ohneRoot.match(/#[0-9a-fA-F]{3,6}\b|rgba?\(/g) || [];
if (festeFarben.length) {
  console.log(`\n✗ ${festeFarben.length} feste Farbe(n) außerhalb von :root: ${[...new Set(festeFarben)].join(', ')}`);
  fehler++;
}

console.log(fehler ? `\n${fehler} Problem(e) gefunden.` : `\nAlle ${PAARE.length} Farbpaare bestehen in beiden Designs.`);
process.exit(fehler ? 1 : 0);
