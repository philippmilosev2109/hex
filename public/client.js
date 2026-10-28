// client.js – Ablauf im Browser: Verbindung zum Server, Ansichten, Spielzüge.
// Der Client vertraut sich nie selbst: Er schickt nur Wünsche (join, move, …)
// und zeigt an, was der Server zurückmeldet. Steine erscheinen erst nach "state".

import { Brett, koordinate } from './board.js';
import { $, zeigeAnsicht, meldung, pruefeName, FARBNAME, RICHTUNG } from './ui.js';
import { sound } from './sound.js';
import { konfetti } from './effekte.js';

// ---------- Sitzung (zum Wiederverbinden) ----------
// Nach dem Anmelden schickt der Server ein geheimes Sitzungs-Token. Es liegt im
// sessionStorage (gilt nur für diesen Tab) und wird bei jedem (Neu-)Verbinden
// mitgeschickt – so kommt man nach einem WLAN-Wackler oder F5 zurück ins Spiel.
const SITZUNG_SCHLUESSEL = 'hex-sitzung';

function ladeSitzung() {
  try {
    return JSON.parse(sessionStorage.getItem(SITZUNG_SCHLUESSEL)) || null;
  } catch {
    return null;
  }
}

function speichereSitzung(sitzung) {
  try {
    sessionStorage.setItem(SITZUNG_SCHLUESSEL, JSON.stringify(sitzung));
  } catch {
    // Speicher gesperrt → Wiederverbinden klappt dann nur über neues Anmelden
  }
}

function loescheSitzung() {
  try {
    sessionStorage.removeItem(SITZUNG_SCHLUESSEL);
  } catch {
    // nichts zu tun
  }
}

// Verbindung zum Server, von dem die Seite geladen wurde.
// Bricht sie ab, versucht Socket.io automatisch, sich neu zu verbinden.
// auth wird bei JEDEM Verbindungsversuch neu gelesen.
const socket = io({ auth: antwort => antwort({ session: ladeSitzung()?.session ?? null }) });

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
  revanche: 'offen',   // Revanche-Zustand nach Spielende (siehe zeigeRevanche)
  zuschauer: false,    // schauen wir gerade nur zu?
  gegnerWeg: null,     // { name, bis } – Gegner verbindet gerade neu
  gegnerTimer: null,   // aktualisiert den Countdown jede Sekunde
  uebernommen: false,  // Sitzung läuft in einem anderen Tab weiter
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

// Angemeldet → Sitzung merken und in die Lobby
// (oder nach einem Verbindungsabbruch direkt weiter warten)
socket.on('joined', ({ name, session }) => {
  app.name = name;
  speichereSitzung({ session, name });
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
  loescheSitzung();
  wechsleZu('login');
});

// ---------- Lobby ----------

function mehrzahl(anzahl, einzahl, mehrzahlForm) {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrzahlForm}`;
}

// Live-Anzeige "X Spieler online · Y laufende Spiele" und Liste zum Zuschauen
socket.on('lobby', daten => {
  $('#lobby-online').textContent = `${mehrzahl(daten.online, 'Spieler', 'Spieler')} online`;
  $('#lobby-spiele').textContent = mehrzahl(daten.games, 'laufendes Spiel', 'laufende Spiele');
  zeigeSpieleliste(daten.list || []);
  zeigeRangliste(daten.leaderboard || []);
});

// Rangliste (Top 10): Platz, Name, Siege, Niederlagen – der eigene Name ist hervorgehoben
function zeigeRangliste(liste) {
  const zeilen = liste.map((eintrag, i) => {
    const zeile = document.createElement('tr');
    if (app.name && eintrag.name.toLowerCase() === app.name.toLowerCase()) zeile.className = 'ich';
    const zellen = [String(i + 1), eintrag.name, String(eintrag.wins), String(eintrag.losses)];
    zellen.forEach((inhalt, spalte) => {
      const zelle = document.createElement('td');
      zelle.textContent = inhalt;
      if (spalte === 1) zelle.className = 'rangliste-name';
      if (spalte >= 2) zelle.className = 'zahl';
      zeile.appendChild(zelle);
    });
    return zeile;
  });
  $('#rangliste-zeilen').replaceChildren(...zeilen);
  $('#rangliste-leer').hidden = liste.length > 0;
  document.querySelector('.rangliste').hidden = liste.length === 0;
}

// Ein Eintrag pro öffentlichem Spiel: "Milo vs. Nico · Zug 14" + Knopf "Zuschauen"
function zeigeSpieleliste(liste) {
  const eintraege = liste.map(spiel => {
    const eintrag = document.createElement('li');
    eintrag.className = 'spiel-eintrag';

    const namen = document.createElement('span');
    namen.className = 'spiel-namen';
    const rot = document.createElement('span');
    rot.className = 'name-red';
    rot.textContent = spiel.red;
    const blau = document.createElement('span');
    blau.className = 'name-blue';
    blau.textContent = spiel.blue;
    namen.append(rot, ' vs. ', blau);

    const info = document.createElement('span');
    info.className = 'spiel-info';
    info.textContent = `Zug ${spiel.moves + 1}` +
      (spiel.spectators ? ` · ${mehrzahl(spiel.spectators, 'Zuschauer', 'Zuschauer')}` : '');

    const text = document.createElement('span');
    text.className = 'spiel-text';
    text.append(namen, info);

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'knopf knopf-sekundaer knopf-klein';
    knopf.textContent = 'Zuschauen';
    knopf.setAttribute('aria-label', `Spiel von ${spiel.red} (Rot) gegen ${spiel.blue} (Blau) zuschauen`);
    knopf.addEventListener('click', () => socket.emit('spectate', { gameId: spiel.id }));

    eintrag.append(text, knopf);
    return eintrag;
  });
  $('#spiele-liste').replaceChildren(...eintraege);
  $('#spiele-leer').hidden = liste.length > 0;
}

socket.on('spectateError', ({ reason }) => meldung(reason, 'fehler'));
socket.on('spectateStopped', () => wechsleZu('lobby'));

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

// Spielansicht für ein neues Spiel vorbereiten – als Spieler oder als Zuschauer
function oeffneSpielansicht(daten, { zuschauer }) {
  app.zuschauer = zuschauer;
  app.farbe = zuschauer ? null : daten.color;
  app.spieler = daten.players;
  app.laeuft = true;
  app.zugGesendet = false;
  app.zustand = null;
  app.gegnerWeg = null;
  clearInterval(app.gegnerTimer);

  $('#spiel-id').textContent = daten.gameId;
  $('#privat-abzeichen').hidden = !daten.private;
  $('#code-eingabe').value = '';
  zeigeCodeFehler(null);
  for (const farbe of ['red', 'blue']) {
    const eintrag = $(`#spieler-${farbe}`);
    eintrag.querySelector('.spieler-name').textContent = daten.players[farbe];
    eintrag.querySelector('.du').hidden = farbe !== app.farbe;
  }

  // Zuschauer: Hinweis statt Aufgeben, Chat nur lesen, eigene Knöpfe am Spielende
  $('#zuschauer-hinweis').hidden = !zuschauer;
  $('#knopf-aufgeben').hidden = zuschauer;
  $('#knopf-zuschauen-beenden').hidden = !zuschauer;
  $('#chat-bedienung').hidden = zuschauer;
  $('#knopf-revanche').hidden = zuschauer;
  $('#knopf-nochmal').hidden = zuschauer;
  $('#knopf-zuschauer-lobby').hidden = !zuschauer;
  zeigeZuschauerzahl(0);

  clearTimeout(app.endeTimer);
  app.zeitWarnung = false;
  app.tickSekunde = null;
  document.querySelectorAll('.konfetti').forEach(leinwand => leinwand.remove());
  brett.zuruecksetzen();
  $('#spielende').hidden = true;
  $('#knopf-ergebnis').hidden = true;
  $('#zugliste').replaceChildren();
  $('#chatliste').replaceChildren();
  ungelesen = 0;
  zeigeUngelesen();
  setzeAufgebenZurueck();
  setzeUhren({ red: daten.timeMs, blue: daten.timeMs }, 'red', false);
  wechsleZu('spiel');
  aktualisiereChat();
}

// Neues Spiel – oder (resumed) zurück im laufenden Spiel nach einem Verbindungsabbruch
socket.on('gameStart', daten => {
  oeffneSpielansicht(daten, { zuschauer: false });
  if (daten.resumed) for (const nachricht of daten.chat || []) zeigeChatNachricht(nachricht);
});

// Zuschauen: gleiche Ansicht, dazu der bisherige Chat; das Brett kommt mit "state"
socket.on('spectateStart', daten => {
  oeffneSpielansicht(daten, { zuschauer: true });
  for (const nachricht of daten.chat || []) zeigeChatNachricht(nachricht);
});

// Zuschauerzahl oben im Panel (für Spieler und Zuschauer)
function zeigeZuschauerzahl(anzahl) {
  $('#zuschauer-zahl').textContent = `${anzahl} ${anzahl === 1 ? 'Zuschauer' : 'Zuschauer'}`;
  $('#zuschauer-anzeige').hidden = anzahl === 0;
}
socket.on('spectators', ({ count }) => zeigeZuschauerzahl(count));

$('#knopf-zuschauen-beenden').addEventListener('click', () => socket.emit('stopSpectating'));
$('#knopf-zuschauer-lobby').addEventListener('click', () => wechsleZu('lobby'));

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
  const dran = app.laeuft && !app.zuschauer && zustand?.turn === app.farbe;
  document.title = dran ? '● Du bist am Zug – Hex' : (app.zuschauer ? 'Zuschauen – Hex' : 'Hex');

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
    $('#status-text').textContent = app.zuschauer
      ? `${FARBNAME[zustand.turn]} · Du schaust zu`
      : 'Warte auf den Zug deines Gegners';
  }

  // Verbindet ein Spieler gerade neu? Dann Countdown statt des normalen Hinweises
  status.classList.toggle('status-warnung', Boolean(app.laeuft && app.gegnerWeg));
  if (app.laeuft && app.gegnerWeg) {
    const rest = Math.max(0, Math.ceil((app.gegnerWeg.bis - performance.now()) / 1000));
    $('#status-text').textContent = `${app.gegnerWeg.name} verbindet neu … ${rest} s`;
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
  app.gegnerWeg = null;
  clearInterval(app.gegnerTimer);
  setzeUhren(ende.clock, null, false);    // Uhren bleiben auf dem Endstand stehen
  const pfadDauer = brett.zeigeGewinnPfad(ende.path);
  aktualisiereStatus();
  setzeAufgebenZurueck();

  if (app.zuschauer) {
    sound.gegner();                 // Zuschauer: neutraler Ton, kein Jubel
  } else if (ende.winner === app.farbe) {
    sound.sieg();
    konfetti();
  } else {
    sound.niederlage();
  }

  // Revanche geht nur, wenn der Gegner noch da ist (und nur für Spieler)
  zeigeRevanche(ende.reason === 'disconnect' || app.zuschauer ? 'unmoeglich' : 'offen');

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
  } else if (app.zuschauer) {
    text = `${namen[verlierer]} hat das Spiel verlassen.`;
  } else {
    text = verlierer === app.farbe ? 'Du hast das Spiel verlassen.' : 'Gegner hat das Spiel verlassen.';
  }
  let ergebnis = ende.winner === app.farbe ? 'Glückwunsch, du hast gewonnen!' : 'Diesmal hat es nicht gereicht.';
  if (app.zuschauer) ergebnis = `Glückwunsch an ${namen[ende.winner]}!`;
  zeigeEndeKarte(`${FARBNAME[ende.winner]} gewinnt!`, text, ergebnis, ende.winner);
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

// ---------- Revanche ----------
// Zustände: 'offen' (Knopf aktiv), 'gefragt' (wir warten), 'angebot' (Gegner will),
// 'unmoeglich' (Gegner weg). text: Statuszeile über den Knöpfen.

function zeigeRevanche(zustand, text = '') {
  app.revanche = zustand;
  const knopf = $('#knopf-revanche');
  knopf.disabled = zustand === 'gefragt' || zustand === 'unmoeglich';
  knopf.textContent = {
    offen: 'Revanche',
    gefragt: 'Revanche angefragt …',
    angebot: 'Revanche annehmen',
    unmoeglich: 'Revanche nicht möglich',
  }[zustand];
  const status = $('#revanche-status');
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('angebot', zustand === 'angebot');
  aktualisiereChat();   // ist der Gegner weg, schließt auch der Chat
}

$('#knopf-revanche').addEventListener('click', () => {
  if (app.revanche !== 'offen' && app.revanche !== 'angebot') return;
  if (app.revanche === 'offen') zeigeRevanche('gefragt');
  socket.emit('rematch');
});

socket.on('rematchWaiting', ({ opponent }) => {
  zeigeRevanche('gefragt', `Warte auf ${opponent} …`);
});

socket.on('rematchOffered', ({ from }) => {
  zeigeRevanche('angebot', `${from} möchte eine Revanche!`);
  // Ist die Karte gerade ausgeblendet ("Brett ansehen"), zusätzlich ein Hinweis
  if ($('#spielende').hidden) meldung(`${from} möchte eine Revanche!`);
});

socket.on('rematchCancelled', ({ reason }) => {
  zeigeRevanche('unmoeglich', reason);
});

// ---------- Chat und Reaktionen ----------

let ungelesen = 0;   // Chat-Nachrichten, die kamen, während der Zugverlauf offen war

// Reiter umschalten (Zugverlauf | Chat) – auch mit den Pfeiltasten
function zeigeReiter(name) {
  for (const reiter of ['zuege', 'chat']) {
    const aktiv = reiter === name;
    const knopf = $(`#reiter-${reiter}`);
    knopf.setAttribute('aria-selected', String(aktiv));
    knopf.tabIndex = aktiv ? 0 : -1;
    $(`#tafel-${reiter}`).hidden = !aktiv;
  }
  if (name === 'chat') {
    ungelesen = 0;
    zeigeUngelesen();
    $('#chatliste').scrollTop = $('#chatliste').scrollHeight;
  }
}
for (const reiter of ['zuege', 'chat']) {
  $(`#reiter-${reiter}`).addEventListener('click', () => zeigeReiter(reiter));
}
$('.reiter').addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const neu = $('#reiter-zuege').getAttribute('aria-selected') === 'true' ? 'chat' : 'zuege';
  zeigeReiter(neu);
  $(`#reiter-${neu}`).focus();
});

function zeigeUngelesen() {
  const zahl = $('#chat-ungelesen');
  zahl.textContent = ungelesen > 9 ? '9+' : String(ungelesen);
  zahl.hidden = ungelesen === 0;
}

// Chat ist offen im Spiel und danach, solange der Gegner noch am Tisch ist
function aktualisiereChat() {
  const offen = app.laeuft || (app.ansicht === 'spiel' && app.revanche !== 'unmoeglich');
  $('#chat-eingabe').disabled = !offen;
  $('#chat-eingabe').placeholder = offen ? 'Nachricht schreiben …' : 'Chat ist geschlossen';
  for (const knopf of document.querySelectorAll('#chat-bedienung button')) knopf.disabled = !offen;
}

// Neue Nachricht: Name in Spielerfarbe, Text NUR per textContent (kein HTML!)
socket.on('chat', nachricht => zeigeChatNachricht(nachricht));

function zeigeChatNachricht(nachricht) {
  const eintrag = document.createElement('li');
  const name = document.createElement('strong');
  name.className = `chat-name ${nachricht.color}`;
  name.textContent = nachricht.from;
  const text = document.createElement('span');
  text.textContent = nachricht.text;
  eintrag.append(name, text);
  const liste = $('#chatliste');
  liste.appendChild(eintrag);
  while (liste.children.length > 100) liste.firstElementChild.remove();
  liste.scrollTop = liste.scrollHeight;
  if ($('#tafel-chat').hidden) {
    ungelesen++;
    zeigeUngelesen();
  }
}

socket.on('chatError', ({ reason }) => meldung(reason, 'fehler'));

$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const eingabe = $('#chat-eingabe');
  const text = eingabe.value.replace(/\s+/g, ' ').trim();
  if (!text) return;
  socket.emit('chat', { text: text.slice(0, 200) });
  eingabe.value = '';
});

for (const knopf of document.querySelectorAll('.reaktion-knopf')) {
  knopf.addEventListener('click', () => socket.emit('reaction', { emoji: knopf.dataset.emoji }));
}

// Reaktion steigt über dem Brett auf und verschwindet nach gut 2 Sekunden
socket.on('reaction', ({ from, color, emoji }) => {
  const blase = document.createElement('div');
  blase.className = `reaktion-blase ${color}`;
  blase.style.left = `${10 + Math.random() * 70}%`;
  const zeichen = document.createElement('span');
  zeichen.className = 'emoji';
  zeichen.textContent = emoji;
  const wer = document.createElement('span');
  wer.className = 'wer';
  wer.textContent = from;
  blase.append(zeichen, wer);
  $('#reaktion-buehne').appendChild(blase);
  setTimeout(() => blase.remove(), 2300);
});

// 5. Erneut spielen: neuer Gegner (Warteschlange), Lobby oder abmelden
$('#knopf-nochmal').addEventListener('click', () => {
  if (app.name) socket.emit('queue');
});
$('#knopf-zur-lobby').addEventListener('click', () => {
  socket.emit('leaveGame');   // Revanche-Angebote sind damit erledigt
  wechsleZu('lobby');
});
$('#knopf-abmelden').addEventListener('click', () => socket.emit('logout'));

// ---------- Verbindung und Wiederverbinden ----------

socket.on('disconnect', () => {
  if (app.uebernommen) return;    // Sitzung läuft in einem anderen Tab weiter
  $('#verbindung').hidden = false;
  brett.setzeInteraktiv(false);   // die Uhr läuft weiter – wie auf dem Server
});

socket.on('connect', () => {
  $('#verbindung').hidden = true;
  // Ohne gespeicherte Sitzung (z. B. sessionStorage gesperrt) erkennt uns der
  // Server nicht wieder → wie bei einer abgelaufenen Sitzung neu anmelden
  if (app.name && !ladeSitzung()?.session) neuAnmeldenNachAbbruch();
});

// Der Server kennt unsere Sitzung noch – gleich folgt der aktuelle Stand
// (laufendes Spiel mit gameStart + state, Wartebildschirm, Zuschauen …)
socket.on('resumed', ({ name, session, state }) => {
  app.name = name;
  speichereSitzung({ session, name });
  $('#lobby-name').textContent = name;
  if (state === 'idle') wechsleZu('lobby');
  meldung(state === 'imSpiel' ? 'Verbindung wiederhergestellt – weiter geht’s!' : 'Verbindung wiederhergestellt.');
});

// Sitzung unbekannt (Frist abgelaufen, Server neu gestartet …) → mit gleichem Namen neu anmelden
socket.on('sessionInvalid', () => {
  const gespeichert = ladeSitzung();
  loescheSitzung();
  if (!app.name && gespeichert?.name) app.name = gespeichert.name;   // nach dem Neuladen der Seite
  neuAnmeldenNachAbbruch();
});

function neuAnmeldenNachAbbruch() {
  if (!app.name) return;
  // Wer in der Warteschlange stand, stellt sich automatisch wieder an
  const warWartend = app.ansicht === 'warten';
  app.nachJoin = warWartend && app.wartemodus === 'queue' ? 'queue' : null;
  socket.emit('join', { name: app.name });
  if (warWartend && app.wartemodus === 'private') {
    meldung('Die Verbindung war unterbrochen – dein privater Code gilt nicht mehr.', 'fehler');
  }
  if (app.ansicht !== 'spiel') return;
  if (app.zuschauer) {
    app.laeuft = false;
    clearInterval(uhrIntervall);
    wechsleZu('lobby');
    meldung('Die Verbindung war unterbrochen – Zuschauen beendet.', 'fehler');
  } else if (app.laeuft) {
    // Gnadenfrist verpasst: Das Spiel ist verloren
    app.laeuft = false;
    clearInterval(uhrIntervall);
    beendeGegnerCountdown();
    setzeAufgebenZurueck();
    zeigeRevanche('unmoeglich');
    zeigeEndeKarte('Verbindung unterbrochen', 'Das Spiel wurde wegen des Verbindungsabbruchs beendet.', '', null);
  } else {
    zeigeRevanche('unmoeglich', 'Die Verbindung war kurz weg – keine Revanche möglich.');
  }
}

// Die gleiche Sitzung wurde in einem anderen Tab geöffnet → dieser Tab ist raus
socket.on('sessionTakenOver', () => {
  app.uebernommen = true;
  $('#verbindung').hidden = true;
  $('#uebernommen').hidden = false;
  $('#knopf-neu-starten').focus();
});
$('#knopf-neu-starten').addEventListener('click', () => {
  loescheSitzung();
  location.reload();
});

// Gegner (bzw. für Zuschauer: ein Spieler) hat die Verbindung verloren → Countdown
socket.on('opponentDisconnected', ({ name, color, seconds }) => {
  if (color === app.farbe) return;
  app.gegnerWeg = { name, bis: performance.now() + seconds * 1000 };
  clearInterval(app.gegnerTimer);
  app.gegnerTimer = setInterval(aktualisiereStatus, 1000);
  aktualisiereStatus();
});

socket.on('opponentReconnected', ({ name, color }) => {
  if (color === app.farbe) return;
  beendeGegnerCountdown();
  meldung(`${name} ist wieder da.`);
});

function beendeGegnerCountdown() {
  app.gegnerWeg = null;
  clearInterval(app.gegnerTimer);
  aktualisiereStatus();
}

// Das Spiel endete, während unsere Verbindung weg war
const GRUND_TEXT = { connect: 'Verbindung geschafft', resign: 'Aufgabe', timeout: 'Zeit abgelaufen', disconnect: 'Spiel verlassen' };
socket.on('missedGameOver', ende => {
  wechsleZu('lobby');
  meldung(`Während deine Verbindung weg war, endete dein Spiel: ${FARBNAME[ende.winner]} gewinnt (${GRUND_TEXT[ende.reason]}).`, 'info', 8000);
});

// Start: Login zeigen, Fokus ins Namensfeld
wechsleZu('login');
$('#name-eingabe').focus();
