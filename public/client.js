// client.js – Ablauf im Browser: Verbindung zum Server, Ansichten, Spielzüge.
// Der Client vertraut sich nie selbst: Er schickt nur Wünsche (join, move, …)
// und zeigt an, was der Server zurückmeldet. Steine erscheinen erst nach "state".

import { Brett, koordinate } from './board.js';
import { $, zeigeAnsicht, meldung, pruefeName, FARBNAME, RICHTUNG } from './ui.js';
import { sound } from './sound.js';
import { konfetti } from './effekte.js';

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
  wartemodus: null,    // beim Warten: 'queue' (Warteschlange) oder 'private' (eigener Code)
  endeTimer: null,     // zeigt die Spielende-Karte erst nach der Gewinnpfad-Animation
  zeitWarnung: false,  // Warnton "Zeit knapp" schon gespielt?
  tickSekunde: null,   // letzte Sekunde, in der das Ticken kam (unter 10 s)
};

const wenigerBewegung = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  if (ansicht !== 'spiel') document.title = 'Hex';
}

// Ton an/aus – die Einstellung merkt sich sound.js im localStorage
function zeigeTonKnopf() {
  const stumm = sound.istStumm();
  $('#knopf-ton').setAttribute('aria-pressed', String(stumm));
  $('#knopf-ton').title = stumm ? 'Ton einschalten' : 'Ton ausschalten';
}
$('#knopf-ton').addEventListener('click', () => {
  sound.setzeStumm(!sound.istStumm());
  zeigeTonKnopf();
});
zeigeTonKnopf();

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
$('#knopf-privat').addEventListener('click', () => socket.emit('createPrivate'));
$('#knopf-lobby-abmelden').addEventListener('click', () => socket.emit('logout'));

// Privatem Spiel beitreten: Code erst im Browser prüfen, dann an den Server
const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function zeigeCodeFehler(text) {
  $('#code-fehler').textContent = text || '';
  $('#code-fehler').hidden = !text;
  $('#code-eingabe').setAttribute('aria-invalid', text ? 'true' : 'false');
}

$('#beitreten-form').addEventListener('submit', event => {
  event.preventDefault();
  const code = $('#code-eingabe').value.replace(/\s/g, '').toUpperCase();
  if (code.length !== 4) {
    zeigeCodeFehler('Der Code hat genau 4 Zeichen.');
  } else if (![...code].every(zeichen => CODE_ZEICHEN.includes(zeichen))) {
    zeigeCodeFehler('Codes enthalten nur A–Z und 2–9 (ohne 0, O, 1 und I).');
  } else {
    zeigeCodeFehler(null);
    socket.emit('joinPrivate', { code });
    return;
  }
  $('#code-eingabe').focus();
});

socket.on('privateError', ({ reason }) => {
  zeigeCodeFehler(reason);
  $('#code-eingabe').focus();
});

socket.on('privateExpired', () => {
  wechsleZu('lobby');
  meldung('Dein privates Spiel ist abgelaufen. Erstelle einfach einen neuen Code.', 'fehler');
});

// ---------- 2. Warten ----------

// mode 'queue' = Warteschlange, mode 'private' = eigener Raum mit Code
socket.on('waiting', daten => {
  const privat = daten.mode === 'private';
  app.wartemodus = daten.mode;
  $('#warten-name').textContent = app.name;
  $('#warten-titel').textContent = privat ? 'Privates Spiel erstellt' : 'Warte auf Gegner …';
  $('#warten-text').textContent = privat
    ? 'Gib diesen Code deinem Freund. Das Spiel startet, sobald er beitritt.'
    : 'Sobald sich ein zweiter Spieler anmeldet, startet das Spiel automatisch.';
  $('#privat-box').hidden = !privat;
  if (privat) {
    $('#privat-code').textContent = daten.code;
    $('#knopf-kopieren').textContent = 'Code kopieren';
  }
  wechsleZu('warten');
});

// Code in die Zwischenablage kopieren. Im lokalen Netz (http) gibt es die
// moderne Clipboard-API oft nicht – dann der klassische Weg über ein Textfeld.
$('#knopf-kopieren').addEventListener('click', async () => {
  const code = $('#privat-code').textContent;
  let kopiert = false;
  try {
    await navigator.clipboard.writeText(code);
    kopiert = true;
  } catch {
    const feld = document.createElement('textarea');
    feld.value = code;
    feld.setAttribute('readonly', '');
    feld.style.position = 'fixed';
    feld.style.opacity = '0';
    document.body.appendChild(feld);
    feld.select();
    try { kopiert = document.execCommand('copy'); } catch { kopiert = false; }
    feld.remove();
  }
  $('#knopf-kopieren').textContent = kopiert ? 'Kopiert ✓' : 'Bitte von Hand abschreiben';
});

// Abbrechen: aus der Warteschlange bzw. dem privaten Raum zurück in die Lobby
$('#knopf-abbrechen').addEventListener('click', () => socket.emit('cancel'));
socket.on('cancelled', () => wechsleZu('lobby'));

// ---------- Schachuhr ----------
// Der Server ist maßgeblich: Er schickt mit jedem state die Restzeiten.
// Der Browser zählt nur dazwischen flüssig herunter (alle 100 ms).

let uhrStand = null;      // { red, blue, turn, laeuft, zeitpunkt }
let uhrIntervall = null;

function formatiereZeit(ms) {
  const sekunden = Math.floor(ms / 1000);
  const text = `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')}`;
  // In den letzten 10 Sekunden mit Zehnteln
  return ms < 10000 ? `${text},${Math.floor((ms % 1000) / 100)}` : text;
}

function zeigeUhren() {
  if (!uhrStand) return;
  const vergangen = performance.now() - uhrStand.zeitpunkt;
  for (const farbe of ['red', 'blue']) {
    let rest = uhrStand[farbe];
    const laeuft = uhrStand.laeuft && farbe === uhrStand.turn;
    if (laeuft) rest = Math.max(0, rest - vergangen);
    const uhr = $(`#uhr-${farbe}`);
    uhr.textContent = formatiereZeit(rest);
    uhr.classList.toggle('knapp', rest < 20000);
    if (laeuft && farbe === app.farbe) warneBeiKnapperZeit(rest);
  }
}

// Eigene Uhr: einmal warnen bei 20 s, in den letzten 10 s jede Sekunde ticken
function warneBeiKnapperZeit(rest) {
  if (rest <= 0) return;
  if (rest < 20000 && !app.zeitWarnung) {
    app.zeitWarnung = true;
    sound.zeitKnapp();
  }
  const sekunde = Math.ceil(rest / 1000);
  if (rest < 10000 && sekunde !== app.tickSekunde) {
    app.tickSekunde = sekunde;
    sound.zeitKnapp();
  }
}

function setzeUhren(clock, turn, laeuft) {
  if (!clock) return;
  uhrStand = { red: clock.red, blue: clock.blue, turn, laeuft, zeitpunkt: performance.now() };
  clearInterval(uhrIntervall);
  uhrIntervall = laeuft ? setInterval(zeigeUhren, 100) : null;
  zeigeUhren();
}

// ---------- 3. Spielen ----------

socket.on('gameStart', daten => {
  app.farbe = daten.color;
  app.spieler = daten.players;
  app.laeuft = true;
  app.zugGesendet = false;
  app.zustand = null;

  $('#spiel-id').textContent = daten.gameId;
  $('#privat-abzeichen').hidden = !daten.private;
  $('#code-eingabe').value = '';
  zeigeCodeFehler(null);
  for (const farbe of ['red', 'blue']) {
    const eintrag = $(`#spieler-${farbe}`);
    eintrag.querySelector('.spieler-name').textContent = daten.players[farbe];
    eintrag.querySelector('.du').hidden = farbe !== app.farbe;
  }
  clearTimeout(app.endeTimer);
  app.zeitWarnung = false;
  app.tickSekunde = null;
  brett.zuruecksetzen();
  $('#spielende').hidden = true;
  $('#knopf-ergebnis').hidden = true;
  $('#zugliste').replaceChildren();
  setzeAufgebenZurueck();
  setzeUhren({ red: daten.timeMs, blue: daten.timeMs }, 'red', false);
  wechsleZu('spiel');
});

socket.on('state', zustand => {
  const vorher = app.zustand;
  app.zustand = zustand;
  app.zugGesendet = false;
  const letzter = zustand.moves[zustand.moves.length - 1] || null;
  // Beim allerersten Zustand eines Spiels nichts animieren
  brett.zeigeZustand(zustand.board, letzter, { animieren: vorher !== null });
  setzeUhren(zustand.clock, zustand.turn, app.laeuft && zustand.turn !== null);
  zeigeZugverlauf(zustand.moves);
  aktualisiereStatus();

  // Neuer Zug? Dann Ton – eigener Stein klingt anders als der des Gegners
  const neuerZug = vorher && zustand.moves.length > vorher.moves.length;
  if (neuerZug) {
    if (letzter.color === app.farbe) sound.setzen();
    else sound.gegner();
  }

  // Wurde gerade getauscht? Dann beide Spieler kurz informieren.
  if (neuerZug && letzter.swap) {
    meldung(letzter.color === app.farbe
      ? 'Du hast getauscht – jetzt ist Rot wieder am Zug.'
      : `${app.spieler.blue} hat getauscht: Dein erster Stein ist jetzt ein blauer Stein.`);
  }
});

// Zugverlauf im Panel: "12. Rot – F7" (links Rot, rechts Blau)
function zeigeZugverlauf(moves) {
  const liste = $('#zugliste');
  if (moves.length < liste.children.length) liste.replaceChildren();
  for (let i = liste.children.length; i < moves.length; i++) {
    const zug = moves[i];
    const eintrag = document.createElement('li');
    const punkt = document.createElement('span');
    punkt.className = `zug-punkt ${zug.color}`;
    punkt.setAttribute('aria-hidden', 'true');
    const feld = koordinate(zug.row, zug.col);
    const text = document.createElement('span');
    text.textContent = `${i + 1}. ${FARBNAME[zug.color]} – ${zug.swap ? `Tausch (${feld})` : feld}`;
    eintrag.append(punkt, text);
    liste.appendChild(eintrag);
  }
  liste.querySelector('.letzter')?.classList.remove('letzter');
  liste.lastElementChild?.classList.add('letzter');
  liste.scrollTop = liste.scrollHeight;
}

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

  // Browser-Tab zeigt an, wenn man dran ist (praktisch bei mehreren Tabs)
  const dran = app.laeuft && zustand?.turn === app.farbe;
  document.title = dran ? '● Du bist am Zug – Hex' : 'Hex';

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

  // Swap-Regel: Blau sieht den Knopf, alle anderen einen Hinweis
  const tauschMoeglich = app.laeuft && Boolean(zustand?.swapAvailable);
  const ichDarfTauschen = tauschMoeglich && istMeinZug() && app.farbe === 'blue';
  $('#tausch-box').hidden = !ichDarfTauschen;
  $('#tausch-hinweis').hidden = !tauschMoeglich || ichDarfTauschen;
  if (!ichDarfTauschen) brett.versteckeTauschVorschau();

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

// Tauschen: wie ein Zug – erst wenn der Server den neuen Zustand schickt, ändert sich das Brett
$('#knopf-tauschen').addEventListener('click', () => {
  if (!istMeinZug() || !app.zustand.swapAvailable) return;
  app.zugGesendet = true;
  aktualisiereStatus();
  socket.emit('swap');
});

// Vorschau beim Zeigen auf den Knopf (Maus oder Tastatur-Fokus)
function zeigeTauschVorschau() {
  const erster = app.zustand?.moves[0];
  if (erster && app.zustand.swapAvailable) brett.zeigeTauschVorschau(erster.row, erster.col);
}
for (const ereignis of ['mouseenter', 'focus']) $('#knopf-tauschen').addEventListener(ereignis, zeigeTauschVorschau);
for (const ereignis of ['mouseleave', 'blur']) $('#knopf-tauschen').addEventListener(ereignis, () => brett.versteckeTauschVorschau());

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
  setzeUhren(ende.clock, null, false);    // Uhren bleiben auf dem Endstand stehen
  const pfadDauer = brett.zeigeGewinnPfad(ende.path);
  aktualisiereStatus();
  setzeAufgebenZurueck();

  if (ende.winner === app.farbe) {
    sound.sieg();
    konfetti();
  } else {
    sound.niederlage();
  }

  // Erst den Gewinnpfad wachsen lassen, dann die Karte einblenden
  const warten = ende.path && !wenigerBewegung() ? Math.min(pfadDauer + 500, 2200) : 0;
  clearTimeout(app.endeTimer);
  app.endeTimer = setTimeout(() => zeigeSpielende(ende), warten);
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
  $('#knopf-ergebnis').hidden = true;
  $('#ende-titel').focus({ preventScroll: true });
}

// "Brett ansehen": Karte ausblenden, um den Gewinnpfad in Ruhe anzuschauen
$('#knopf-brett-ansehen').addEventListener('click', () => {
  $('#spielende').hidden = true;
  $('#knopf-ergebnis').hidden = false;
  $('#knopf-ergebnis').focus();
});
$('#knopf-ergebnis').addEventListener('click', () => {
  $('#knopf-ergebnis').hidden = true;
  $('#spielende').hidden = false;
  $('#ende-titel').focus({ preventScroll: true });
});

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

  // Der Server hat uns beim Abbruch abgemeldet → mit gleichem Namen neu anmelden.
  // Wer in der Warteschlange stand, stellt sich automatisch wieder an.
  const warWartend = app.ansicht === 'warten';
  app.nachJoin = warWartend && app.wartemodus === 'queue' ? 'queue' : null;
  socket.emit('join', { name: app.name });
  if (warWartend && app.wartemodus === 'private') {
    meldung('Die Verbindung war unterbrochen – dein privater Code gilt nicht mehr.', 'fehler');
  }

  if (app.laeuft) {
    app.laeuft = false;
    clearInterval(uhrIntervall);
    aktualisiereStatus();
    setzeAufgebenZurueck();
    zeigeEndeKarte('Verbindung unterbrochen', 'Das Spiel wurde wegen des Verbindungsabbruchs beendet.', '', null);
  }
});

// Start: Login zeigen, Fokus ins Namensfeld
wechsleZu('login');
$('#name-eingabe').focus();
