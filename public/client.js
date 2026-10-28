// client.js – Ablauf im Browser: Verbindung zum Server, Ansichten, Spielzüge.
// Der Client vertraut sich nie selbst: Er schickt nur Wünsche (join, move, …)
// und zeigt an, was der Server zurückmeldet. Steine erscheinen erst nach "state".

import { Brett } from './board.js';
import { $, zeigeAnsicht, meldung, pruefeName, FARBNAME, RICHTUNG } from './ui.js';

// Verbindung zum Server, von dem die Seite geladen wurde.
// Bricht sie ab, versucht Socket.io automatisch, sich neu zu verbinden.
const socket = io();

// Was der Browser über die aktuelle Sitzung weiß
const app = {
  name: null,          // eigener Name nach erfolgreichem join
  ansicht: 'login',    // aktuelle Ansicht: login | warten | spiel
  farbe: null,         // eigene Farbe im Spiel: 'red' | 'blue'
  spieler: null,       // Namen im Spiel: { red, blue }
  zustand: null,       // letzter state vom Server
  laeuft: false,       // läuft gerade ein Spiel?
  zugGesendet: false,  // Zug abgeschickt, Antwort vom Server steht noch aus
  nachJoin: null,      // was nach "joined" passieren soll (z. B. 'queue')
};

// Klick auf ein freies Feld → Zug an den Server schicken (nicht selbst setzen!)
const brett = new Brett($('#brett'), (row, col) => {
  if (!istMeinZug()) return;
  app.zugGesendet = true;          // schützt vor Doppelklicks
  aktualisiereStatus();
  socket.emit('move', { row, col });
});

function wechsleZu(ansicht) {
  app.ansicht = ansicht;
  zeigeAnsicht(ansicht);
  // Angemeldeter Name oben rechts (außer auf der Login-Seite)
  const kopfName = $('#kopf-name');
  kopfName.textContent = app.name || '';
  kopfName.hidden = !app.name || ansicht === 'login';
}

function istMeinZug() {
  return app.laeuft && !app.zugGesendet && socket.connected &&
         app.zustand !== null && app.zustand.turn === app.farbe;
}

// ---------- 1. Anmelden ----------

function zeigeNamensFehler(text) {
  const fehler = $('#name-fehler');
  fehler.textContent = text || '';
  fehler.hidden = !text;
  $('#name-eingabe').setAttribute('aria-invalid', text ? 'true' : 'false');
}

$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const pruefung = pruefeName($('#name-eingabe').value);
  if (!pruefung.ok) {
    zeigeNamensFehler(pruefung.fehler);
    $('#name-eingabe').focus();
    return;
  }
  if (!socket.connected) {
    zeigeNamensFehler('Keine Verbindung zum Server – bitte einen Moment warten.');
    return;
  }
  zeigeNamensFehler(null);
  $('#knopf-spielen').disabled = true;
  app.nachJoin = null;
  socket.emit('join', { name: pruefung.name });
});

// Angemeldet → in die Lobby (oder nach einem Verbindungsabbruch direkt weiter warten)
socket.on('joined', ({ name }) => {
  app.name = name;
  $('#knopf-spielen').disabled = false;
  $('#lobby-name').textContent = name;
  const naechstes = app.nachJoin;
  app.nachJoin = null;
  if (naechstes === 'queue') socket.emit('queue');
  else if (app.ansicht !== 'spiel') wechsleZu('lobby');
});

socket.on('joinError', ({ reason }) => {
  $('#knopf-spielen').disabled = false;
  zeigeNamensFehler(reason);
});

socket.on('loggedOut', () => {
  app.name = null;
  app.laeuft = false;
  wechsleZu('login');
});

// ---------- Lobby ----------

function mehrzahl(anzahl, einzahl, mehrzahlForm) {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrzahlForm}`;
}

// Live-Anzeige "X Spieler online · Y laufende Spiele"
socket.on('lobby', daten => {
  $('#lobby-online').textContent = `${mehrzahl(daten.online, 'Spieler', 'Spieler')} online`;
  $('#lobby-spiele').textContent = mehrzahl(daten.games, 'laufendes Spiel', 'laufende Spiele');
});

$('#knopf-schnell').addEventListener('click', () => socket.emit('queue'));
$('#knopf-lobby-abmelden').addEventListener('click', () => socket.emit('logout'));

// ---------- 2. Warten ----------

socket.on('waiting', () => {
  $('#warten-name').textContent = app.name;
  wechsleZu('warten');
});

// Abbrechen: aus der Warteschlange zurück in die Lobby
$('#knopf-abbrechen').addEventListener('click', () => socket.emit('cancel'));
socket.on('cancelled', () => wechsleZu('lobby'));

// ---------- 3. Spielen ----------

socket.on('gameStart', daten => {
  app.farbe = daten.color;
  app.spieler = daten.players;
  app.laeuft = true;
  app.zugGesendet = false;
  app.zustand = null;

  $('#spiel-id').textContent = daten.gameId;
  for (const farbe of ['red', 'blue']) {
    const eintrag = $(`#spieler-${farbe}`);
    eintrag.querySelector('.spieler-name').textContent = daten.players[farbe];
    eintrag.querySelector('.du').hidden = farbe !== app.farbe;
  }
  brett.zuruecksetzen();
  $('#spielende').hidden = true;
  setzeAufgebenZurueck();
  wechsleZu('spiel');
});

socket.on('state', zustand => {
  app.zustand = zustand;
  app.zugGesendet = false;
  brett.zeigeZustand(zustand.board);
  aktualisiereStatus();
});

// Ungültiger Zug: Anzeige bleibt unverändert, nur ein Hinweis
socket.on('invalid', ({ reason }) => {
  app.zugGesendet = false;
  meldung(reason, 'fehler');
  aktualisiereStatus();
});

// Statusbox, Zugzähler und Klickbarkeit des Bretts aktualisieren
function aktualisiereStatus() {
  const zustand = app.zustand;
  brett.setzeInteraktiv(istMeinZug(), app.farbe);

  const status = $('#status');
  status.classList.remove('status-red', 'status-blue');
  if (!app.laeuft) {
    $('#status-titel').textContent = 'Spiel beendet';
    $('#status-text').textContent = 'Das Brett ist gesperrt.';
  } else if (!zustand) {
    $('#status-titel').textContent = 'Spiel startet …';
    $('#status-text').textContent = '';
  } else if (zustand.turn === app.farbe) {
    status.classList.add(`status-${app.farbe}`);
    $('#status-titel').textContent = 'Du bist am Zug';
    $('#status-text').textContent = 'Klicke auf ein freies Feld';
  } else {
    $('#status-titel').textContent = `${app.spieler[zustand.turn]} ist am Zug`;
    $('#status-text').textContent = 'Warte auf den Zug deines Gegners';
  }

  for (const farbe of ['red', 'blue']) {
    $(`#spieler-${farbe}`).classList.toggle('am-zug', app.laeuft && zustand?.turn === farbe);
  }

  if (zustand) {
    const steine = { red: 0, blue: 0 };
    for (const zeile of zustand.board) for (const feld of zeile) if (feld) steine[feld]++;
    const zugNummer = app.laeuft ? zustand.moves.length + 1 : zustand.moves.length;
    const steinText = steine.red === steine.blue
      ? `${steine.red} ${steine.red === 1 ? 'Stein' : 'Steine'} je Spieler`
      : `Rot ${steine.red} · Blau ${steine.blue} Steine`;
    $('#zugzaehler').textContent = `Zug ${zugNummer} · ${steinText}`;
  }
}

// Aufgeben mit Sicherheitsabfrage: erster Klick fragt nach, zweiter gibt auf
let aufgebenTimer = null;

function setzeAufgebenZurueck() {
  clearTimeout(aufgebenTimer);
  const knopf = $('#knopf-aufgeben');
  delete knopf.dataset.bestaetigen;
  knopf.textContent = 'Aufgeben';
  knopf.classList.remove('knopf-gefahr');
  knopf.disabled = !app.laeuft;
}

$('#knopf-aufgeben').addEventListener('click', () => {
  const knopf = $('#knopf-aufgeben');
  if (!app.laeuft) return;
  if (knopf.dataset.bestaetigen) {
    socket.emit('resign');
    setzeAufgebenZurueck();
    return;
  }
  knopf.dataset.bestaetigen = 'ja';
  knopf.textContent = 'Wirklich aufgeben?';
  knopf.classList.add('knopf-gefahr');
  aufgebenTimer = setTimeout(setzeAufgebenZurueck, 4000);
});

// ---------- 4. Spielende ----------

socket.on('gameOver', ende => {
  app.laeuft = false;
  brett.zeigeGewinnPfad(ende.path);
  aktualisiereStatus();
  setzeAufgebenZurueck();
  zeigeSpielende(ende);
});

function zuegeText(anzahl) {
  return `${anzahl} ${anzahl === 1 ? 'Zug' : 'Zügen'}`;
}

function zeigeSpielende(ende) {
  const verlierer = ende.winner === 'red' ? 'blue' : 'red';
  const namen = ende.players;
  let text;
  if (ende.reason === 'connect') {
    text = `${namen[ende.winner]} hat ${RICHTUNG[ende.winner]} verbunden – nach ${zuegeText(ende.moveCount)}`;
  } else if (ende.reason === 'resign') {
    text = verlierer === app.farbe ? 'Du hast aufgegeben.' : `${namen[verlierer]} hat aufgegeben.`;
  } else if (ende.reason === 'timeout') {
    text = verlierer === app.farbe ? 'Deine Zeit ist abgelaufen.' : `Die Zeit von ${namen[verlierer]} ist abgelaufen.`;
  } else {
    text = verlierer === app.farbe ? 'Du hast das Spiel verlassen.' : 'Gegner hat das Spiel verlassen.';
  }
  const gewonnen = ende.winner === app.farbe;
  zeigeEndeKarte(`${FARBNAME[ende.winner]} gewinnt!`, text,
    gewonnen ? 'Glückwunsch, du hast gewonnen!' : 'Diesmal hat es nicht gereicht.', ende.winner);
}

function zeigeEndeKarte(titel, text, ergebnis, farbe) {
  $('#ende-titel').textContent = titel;
  $('#ende-text').textContent = text;
  $('#ende-ergebnis').textContent = ergebnis;
  const karte = $('#spielende');
  karte.dataset.farbe = farbe || '';
  karte.hidden = false;
  $('#ende-titel').focus({ preventScroll: true });
}

// 5. Erneut spielen: zurück in die Warteschlange, in die Lobby oder abmelden
$('#knopf-nochmal').addEventListener('click', () => {
  if (app.name) socket.emit('queue');
});
$('#knopf-zur-lobby').addEventListener('click', () => wechsleZu('lobby'));
$('#knopf-abmelden').addEventListener('click', () => socket.emit('logout'));

// ---------- Verbindung ----------

socket.on('disconnect', () => {
  $('#verbindung').hidden = false;
  brett.setzeInteraktiv(false);
});

socket.on('connect', () => {
  $('#verbindung').hidden = true;
  if (!app.name) return;   // war noch nicht angemeldet → nichts zu tun

  // Der Server hat uns beim Abbruch abgemeldet → mit gleichem Namen neu anmelden
  const warWartend = app.ansicht === 'warten';
  app.nachJoin = warWartend ? 'queue' : null;
  socket.emit('join', { name: app.name });

  if (app.laeuft) {
    app.laeuft = false;
    aktualisiereStatus();
    setzeAufgebenZurueck();
    zeigeEndeKarte('Verbindung unterbrochen', 'Das Spiel wurde wegen des Verbindungsabbruchs beendet.', '', null);
  }
});

// Start: Login zeigen, Fokus ins Namensfeld
wechsleZu('login');
$('#name-eingabe').focus();
