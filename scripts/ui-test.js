// UI-Test mit Playwright (nur Testwerkzeug, kein Teil des Spiels):
// Zwei Browser spielen eine komplette Partie. Dabei entstehen Screenshots
// aller Ansichten, und jede Fehlermeldung in der Browser-Konsole lässt den Test scheitern.
//
// Start: npm run uitest   (einmalig vorher: npx playwright install chromium)

'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { erstelleServer } = require('../server');

const ORDNER = path.join(__dirname, '..', 'screenshots');
const GROESSEN = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'handy', width: 375, height: 812 },
];

const konsolenFehler = [];
const offeneSeiten = [];   // für Fehler-Screenshots

async function neueSeite(browser, url, groesse, wer) {
  const kontext = await browser.newContext({ viewport: { width: groesse.width, height: groesse.height } });
  const seite = await kontext.newPage();
  offeneSeiten.push({ seite, wer });
  seite.on('console', nachricht => {
    if (nachricht.type() === 'error') konsolenFehler.push(`${wer}: ${nachricht.text()}`);
  });
  seite.on('pageerror', fehler => konsolenFehler.push(`${wer}: ${fehler.message}`));
  await seite.goto(url);
  return seite;
}

async function foto(seite, name) {
  await seite.screenshot({ path: path.join(ORDNER, `${name}.png`) });
}

// Kein horizontales Scrollen erlaubt
async function pruefeBreite(seite, wo) {
  const zuBreit = await seite.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (zuBreit) throw new Error(`Horizontales Scrollen auf ${wo}`);
}

async function anmelden(seite, name) {
  await seite.fill('#name-eingabe', name);
  await seite.click('#knopf-spielen');
}

// Wartet, bis die Spielansicht eines NEUEN Spiels sichtbar ist (Overlay zu, Status gesetzt)
async function warteAufSpielstart(seite) {
  await seite.waitForSelector('#ansicht-spiel:not([hidden])');
  await seite.waitForSelector('#spielende[hidden]', { state: 'attached' });
  await seite.waitForFunction(() => document.querySelector('#status-titel').textContent.length > 0);
}

async function steinAnzahl(seite) {
  return seite.locator('circle.stein').count();
}

// Klickt ein Feld und wartet, bis beide Browser den neuen Stein zeigen
async function zug(amZug, andere, row, col, erwarteteSteine) {
  await amZug.click(`polygon.feld[data-r="${row}"][data-c="${col}"]`);
  for (const seite of [amZug, andere]) {
    await seite.waitForFunction(n => document.querySelectorAll('circle.stein').length === n, erwarteteSteine);
  }
}

async function durchlauf(browser, url, groesse) {
  const a = await neueSeite(browser, url, groesse, `${groesse.name}/Milo`);
  const b = await neueSeite(browser, url, groesse, `${groesse.name}/Nico`);

  // 1. Login
  await a.waitForSelector('#ansicht-login:not([hidden])');
  await foto(a, `${groesse.name}-1-login`);
  await pruefeBreite(a, 'Login');

  // Leerer Name wird im Browser abgefangen
  await a.click('#knopf-spielen');
  await a.waitForSelector('#name-fehler:not([hidden])');

  // 2. Warten
  await anmelden(a, 'Milo');
  await a.waitForSelector('#ansicht-warten:not([hidden])');
  await foto(a, `${groesse.name}-2-warten`);
  await pruefeBreite(a, 'Warten');

  // 3. Spiel
  await anmelden(b, 'Nico');
  await warteAufSpielstart(a);
  await warteAufSpielstart(b);

  // Wer ist Rot? Rot ist zuerst am Zug.
  const aIstRot = await a.evaluate(() => !document.querySelector('#spieler-red .du').hidden);
  const rot = aIstRot ? a : b;
  const blau = aIstRot ? b : a;

  // Ein paar Züge, dann Screenshot mitten im Spiel
  let steine = 0;
  for (let r = 0; r < 4; r++) {
    await zug(rot, blau, r, 0, ++steine);
    await zug(blau, rot, r, 5, ++steine);
  }
  await rot.hover('polygon.feld[data-r="6"][data-c="3"]');
  await foto(rot, `${groesse.name}-3-spiel`);
  await pruefeBreite(rot, 'Spiel');

  // Ungültiger Klick: Blau ist nicht am Zug → nichts passiert
  await blau.click('polygon.feld[data-r="8"][data-c="8"]', { force: true });
  if (await steinAnzahl(blau) !== steine) throw new Error('Client hat selbst einen Stein gesetzt');

  // Rot spielt die Spalte 0 zu Ende → Sieg
  for (let r = 4; r < 11; r++) {
    await zug(rot, blau, r, 0, ++steine);
    if (r < 10) await zug(blau, rot, r, 5, ++steine);
  }

  // 4. Spielende
  for (const seite of [rot, blau]) await seite.waitForSelector('#spielende:not([hidden])');
  const titel = await rot.textContent('#ende-titel');
  const text = await rot.textContent('#ende-text');
  if (titel !== 'Rot gewinnt!') throw new Error(`Falscher Titel: ${titel}`);
  if (!text.includes('oben und unten verbunden – nach 21 Zügen')) throw new Error(`Falscher Text: ${text}`);
  const pfadSteine = await rot.locator('circle.stein.gewinn').count();
  if (pfadSteine !== 11) throw new Error(`Gewinnpfad hat ${pfadSteine} statt 11 Steinen`);
  await rot.waitForTimeout(400);
  await foto(rot, `${groesse.name}-4-spielende-sieger`);
  await foto(blau, `${groesse.name}-4-spielende-verlierer`);
  await pruefeBreite(rot, 'Spielende');

  // 5. Nochmal spielen → beide landen wieder im Spiel
  await rot.click('#knopf-nochmal');
  await blau.click('#knopf-nochmal');
  await warteAufSpielstart(rot);
  await warteAufSpielstart(blau);

  // Aufgeben (mit Sicherheitsabfrage) → Gegner sieht den Grund
  await rot.click('#knopf-aufgeben');
  await rot.click('#knopf-aufgeben');
  await blau.waitForSelector('#spielende:not([hidden])');
  const grund = await blau.textContent('#ende-text');
  if (!grund.includes('hat aufgegeben')) throw new Error(`Aufgabe nicht angezeigt: ${grund}`);

  // Abmelden → Login
  await rot.waitForSelector('#spielende:not([hidden])');
  await rot.click('#knopf-abmelden');
  await rot.waitForSelector('#ansicht-login:not([hidden])');

  // Verbindungsabbruch des Gegners → "Gegner hat das Spiel verlassen"
  await blau.click('#knopf-nochmal');
  await anmelden(rot, 'Milo');
  await warteAufSpielstart(rot);
  await warteAufSpielstart(blau);
  await rot.context().close();
  await blau.waitForSelector('#spielende:not([hidden])');
  const verlassen = await blau.textContent('#ende-text');
  if (!verlassen.includes('Gegner hat das Spiel verlassen')) throw new Error(`Abbruch nicht angezeigt: ${verlassen}`);

  await blau.context().close();
}

async function main() {
  fs.mkdirSync(ORDNER, { recursive: true });
  const server = erstelleServer();
  const port = await server.starte(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    for (const groesse of GROESSEN) {
      await durchlauf(browser, url, groesse);
      console.log(`✓ ${groesse.name} (${groesse.width}×${groesse.height})`);
    }
    if (konsolenFehler.length) throw new Error(`Fehler in der Browser-Konsole:\n${konsolenFehler.join('\n')}`);
    console.log(`UI-Test bestanden. Screenshots in ${ORDNER}`);
  } catch (fehler) {
    // Zur Fehlersuche: Bildschirm aller noch offenen Seiten festhalten
    for (const { seite, wer } of offeneSeiten) {
      if (!seite.isClosed()) await foto(seite, `fehler-${wer.replace(/\W/g, '-')}`).catch(() => {});
    }
    throw fehler;
  } finally {
    await browser.close();
    await server.stoppe();
  }
}

main().catch(fehler => {
  console.error('UI-Test fehlgeschlagen:', fehler.message);
  process.exit(1);
});
