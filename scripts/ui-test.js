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
  // animations: 'disabled' spult Einblend-Animationen bis zum Ende vor
  await seite.screenshot({ path: path.join(ORDNER, `${name}.png`), animations: 'disabled' });
}

// Kein horizontales Scrollen erlaubt
async function pruefeBreite(seite, wo) {
  const zuBreit = await seite.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (zuBreit) throw new Error(`Horizontales Scrollen auf ${wo}`);
}

// Name eingeben → Lobby → "Schnelles Spiel"
async function anmelden(seite, name, { foto: fotoName } = {}) {
  await seite.fill('#name-eingabe', name);
  await seite.click('#knopf-spielen');
  await seite.waitForSelector('#ansicht-lobby:not([hidden])');
  await seite.waitForFunction(() => /\d/.test(document.querySelector('#lobby-online').textContent));
  if (fotoName) {
    await foto(seite, fotoName);
    await pruefeBreite(seite, 'Lobby');
  }
  await seite.click('#knopf-schnell');
}

// Wartet, bis die Spielansicht eines NEUEN Spiels sichtbar ist (Overlay zu, Status gesetzt)
async function warteAufSpielstart(seite) {
  await seite.waitForSelector('#ansicht-spiel:not([hidden])');
  await seite.waitForSelector('#spielende[hidden]', { state: 'attached' });
  await seite.waitForFunction(() => document.querySelector('#status-titel').textContent.length > 0);
}

async function steinAnzahl(seite) {
  return seite.locator('.steine .stein').count();
}

// Klickt ein Feld und wartet, bis beide Browser den neuen Stein zeigen
async function zug(amZug, andere, row, col, erwarteteSteine) {
  await amZug.click(`polygon.feld[data-r="${row}"][data-c="${col}"]`);
  for (const seite of [amZug, andere]) {
    await seite.waitForFunction(n => document.querySelectorAll('.steine .stein').length === n, erwarteteSteine);
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

  // Lobby und 2. Warten
  await anmelden(a, 'Milo', { foto: `${groesse.name}-1b-lobby` });
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
  const pfadSteine = await rot.locator('.stein.gewinn').count();
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

// Privates Spiel: Code erstellen, falscher Code, richtiger Code
async function privatesSpiel(browser, url, groesse) {
  const a = await neueSeite(browser, url, groesse, `${groesse.name}/Lena`);
  const b = await neueSeite(browser, url, groesse, `${groesse.name}/Tom`);
  for (const [seite, name] of [[a, 'Lena'], [b, 'Tom']]) {
    await seite.fill('#name-eingabe', name);
    await seite.click('#knopf-spielen');
    await seite.waitForSelector('#ansicht-lobby:not([hidden])');
  }

  await a.click('#knopf-privat');
  await a.waitForSelector('#privat-box:not([hidden])');
  const code = (await a.textContent('#privat-code')).trim();
  if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) throw new Error(`Ungültiger Code angezeigt: ${code}`);
  await foto(a, `${groesse.name}-2b-privat-warten`);
  await pruefeBreite(a, 'Privat warten');

  // Falscher Code (enthält 0) → Fehler im Browser, unbekannter Code → Fehler vom Server
  await b.fill('#code-eingabe', 'AB0C');
  await b.click('#knopf-beitreten');
  await b.waitForSelector('#code-fehler:not([hidden])');
  await b.fill('#code-eingabe', code === 'ZZZZ' ? 'YYYY' : 'ZZZZ');
  await b.click('#knopf-beitreten');
  await b.waitForFunction(() => /Kein offenes Spiel/.test(document.querySelector('#code-fehler').textContent));
  await foto(b, `${groesse.name}-1c-lobby-codefehler`);

  await b.fill('#code-eingabe', code.toLowerCase());
  await b.click('#knopf-beitreten');
  await warteAufSpielstart(a);
  await warteAufSpielstart(b);
  for (const seite of [a, b]) {
    if (await seite.isHidden('#privat-abzeichen')) throw new Error('Abzeichen "Privat" fehlt');
  }
  await a.context().close();
  await b.context().close();
}

// Schachuhr: Server mit nur 5 Sekunden Bedenkzeit → Uhr rot, dann Ende durch Zeitablauf
async function zeitSpiel(browser, groesse) {
  const server = erstelleServer({ zeitMs: 5000 });
  const port = await server.starte(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  try {
    const a = await neueSeite(browser, url, groesse, `${groesse.name}/Uhr-A`);
    const b = await neueSeite(browser, url, groesse, `${groesse.name}/Uhr-B`);
    await anmelden(a, 'Ada');
    await anmelden(b, 'Bo');
    await warteAufSpielstart(a);
    await warteAufSpielstart(b);
    await a.waitForSelector('#uhr-red.knapp');
    await a.waitForTimeout(1200);
    await foto(a, `${groesse.name}-3b-uhr-knapp`);
    await a.waitForSelector('#spielende:not([hidden])', { timeout: 10000 });
    const text = await a.textContent('#ende-text');
    if (!/Zeit/.test(text)) throw new Error(`Zeitablauf nicht angezeigt: ${text}`);
    await foto(a, `${groesse.name}-4b-zeit-abgelaufen`);
    await a.context().close();
    await b.context().close();
  } finally {
    await server.stoppe();
  }
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
      await privatesSpiel(browser, url, groesse);
      await zeitSpiel(browser, groesse);
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
