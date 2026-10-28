// Lasttest: 40 simulierte Spieler (Bots) gleichzeitig gegen einen echten Server.
// Die Bots verhalten sich unterschiedlich: normal spielen, aufgeben, mitten im Spiel
// die Verbindung trennen, kaputte Daten senden, Warten abbrechen …
// Am Ende wird geprüft: alle Spiele korrekt beendet, alle Gewinnpfade gültig,
// keine Server-Fehler, Server läuft weiter, alle Maps/Timer/Räume leer.
//
// Start: npm run loadtest

'use strict';

const { io: ioClient } = require('socket.io-client');
const { erstelleServer } = require('../server');
const { ROT, BLAU, nachbarn, findeGewinnPfad } = require('../game');

const ANZAHL_BOTS = 40;
const MAX_DAUER_MS = 120000;

// Kürzere Bedenkzeit für den Lasttest (wird beim Erstellen des Servers gelesen)
process.env.HEX_ZEIT_MS = process.env.HEX_ZEIT_MS || '10000';

// Verteilung der Verhaltensweisen (wird reihum vergeben)
const VERHALTEN = [
  'normal', 'normal', 'normal',
  'aufgeber', 'abbrecher', 'chaot', 'zoegerer', 'flooder',
  'privatErsteller', 'privatGast', 'schlaefer', 'spammer',
];
const REAKTIONEN = ['👍', '😮', '😅', '🔥', '👏', '🤝'];

const zufall = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Private Spiele: Ersteller-Bots "geben" ihren Code über diese Liste an Gast-Bots weiter
const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const offeneCodes = [];
const alleCodes = new Set();
const zufallsCode = () => Array.from({ length: 4 }, () => CODE_ZEICHEN[zufall(0, CODE_ZEICHEN.length - 1)]).join('');

// Kaputte Daten, die ein manipulierter Client schicken könnte
const MUELL = [
  undefined, null, 0, -1, NaN, 'text', '', [], {}, [1, 2, 3], true,
  { row: 'a', col: 'b' }, { row: 1.5, col: 2 }, { row: -5, col: 99 }, { row: {}, col: [] },
  { name: 'x'.repeat(300) }, { name: { toString: 'kaputt' } }, 'x'.repeat(2000),
];

// ---------- Auswertung ----------
const statistik = {
  spieleGestartet: 0,
  privateSpiele: 0,
  codeFehler: 0,         // erwartete Fehler bei falschen Codes
  tausche: 0,            // Swap-Regel angewendet
  revanchen: 0,          // angenommene Revanche-Angebote
  chatEmpfangen: 0,
  chatAbgelehnt: 0,      // vom Server gebremste/abgelehnte Nachrichten
  reaktionen: 0,
  gameOver: {},          // Grund → Anzahl
  zuege: 0,
  ungueltigeZuegeNormal: 0,
  invalidNachVerhalten: {},  // Verhalten → Anzahl "invalid"-Antworten
  timeoutVerlierer: {},      // Verhalten → wie oft auf Zeit verloren
  fehler: [],
};
const spiele = new Map(); // Spiel-ID → { teilnehmer: Set, beendet: bool, verlassenVon: Set }

function fehler(text) {
  statistik.fehler.push(text);
}

// Prüft einen Gewinnpfad gegen das letzte bekannte Brett
function pruefeGewinnPfad(brett, pfad, farbe, wo) {
  if (!Array.isArray(pfad) || pfad.length === 0) return fehler(`${wo}: kein Gewinnpfad`);
  const n = brett.length;
  const erstes = pfad[0];
  const letztes = pfad[pfad.length - 1];
  const raenderOk = farbe === ROT
    ? erstes.row === 0 && letztes.row === n - 1
    : erstes.col === 0 && letztes.col === n - 1;
  if (!raenderOk) fehler(`${wo}: Pfad berührt nicht beide Ränder`);
  pfad.forEach((feld, i) => {
    if (brett[feld.row][feld.col] !== farbe) fehler(`${wo}: Pfad-Feld ${feld.row},${feld.col} hat falsche Farbe`);
    if (i > 0) {
      const vorher = pfad[i - 1];
      const ok = nachbarn(vorher.row, vorher.col).some(([r, c]) => r === feld.row && c === feld.col);
      if (!ok) fehler(`${wo}: Pfad hat eine Lücke bei ${feld.row},${feld.col}`);
    }
  });
  if (!findeGewinnPfad(brett, farbe)) fehler(`${wo}: Sieger hat laut Brett keine Verbindung`);
  const verlierer = farbe === ROT ? BLAU : ROT;
  if (findeGewinnPfad(brett, verlierer)) fehler(`${wo}: auch der Verlierer hat eine Verbindung`);
}

// ---------- Ein Bot ----------
class Bot {
  constructor(nummer, verhalten, url) {
    this.nummer = nummer;
    this.verhalten = verhalten;
    this.name = `Bot${nummer}`;
    this.url = url;
    this.spieleUebrig = verhalten === 'normal' ? 3 : 2;
    this.farbe = null;
    this.spielId = null;
    this.brett = null;
    this.eigeneZuege = 0;
    this.zugTimer = null;
    this.warteTimer = null;
    this.antwortTimer = null;
    this.fertig = false;
    this.abbruchNachZuegen = zufall(2, 10);
  }

  start() {
    return new Promise(resolve => {
      this.beenden = resolve;
      // Die Hälfte nutzt nur WebSocket, die andere startet wie ein Browser mit Polling
      this.socket = ioClient(this.url, {
        forceNew: true,
        reconnection: false,
        transports: this.nummer % 2 ? ['websocket'] : ['polling', 'websocket'],
      });
      const s = this.socket;
      s.on('connect', () => s.emit('join', { name: this.name }));
      s.on('connect_error', err => { fehler(`${this.name}: connect_error ${err.message}`); this.fertigMachen(); });
      s.on('joined', () => this.losSpielen());
      s.on('joinError', ({ reason }) => {
        // Manipulierte Clients schicken absichtlich kaputte "join"-Daten → Ablehnung ist richtig
        if (!this.istManipuliert()) fehler(`${this.name}: joinError ${reason}`);
      });
      s.on('waiting', daten => this.wartet(daten));
      s.on('privateError', ({ reason }) => this.codeFehler(reason));
      s.on('rematchOffered', () => this.revancheAngebot());
      s.on('rematchCancelled', () => this.weiterNachSpiel());
      s.on('chat', nachricht => this.chatEmpfangen(nachricht));
      s.on('chatError', () => { statistik.chatAbgelehnt++; });
      s.on('reaction', () => { statistik.reaktionen++; });
      s.on('gameStart', daten => this.spielStart(daten));
      s.on('state', zustand => this.neuerZustand(zustand));
      s.on('invalid', () => this.ungueltig());
      s.on('gameOver', ende => this.spielEnde(ende));
      s.on('disconnect', () => this.fertigMachen());
    });
  }

  // Nach dem Anmelden: je nach Verhalten privat spielen oder in die Warteschlange
  losSpielen() {
    if (this.verhalten === 'privatErsteller') return this.socket.emit('createPrivate');
    if (this.verhalten === 'privatGast') return this.privatBeitreten();
    return this.inWarteschlange();
  }

  // Gast: erst zwei falsche Codes (müssen sauber abgelehnt werden), dann ein echter
  async privatBeitreten() {
    this.erlaubteCodeFehler = 2;
    this.socket.emit('joinPrivate', { code: 'AB' });            // falsches Format
    let unbekannt;
    do { unbekannt = zufallsCode(); } while (alleCodes.has(unbekannt));
    this.socket.emit('joinPrivate', { code: unbekannt });        // gibt es nicht
    const ende = Date.now() + 3000;
    while (!this.fertig && Date.now() < ende) {
      const code = offeneCodes.shift();
      if (code) return this.socket.emit('joinPrivate', { code: code.toLowerCase() });
      await pause(50);
    }
    if (!this.fertig) this.inWarteschlange();                    // kein Code da → normal spielen
  }

  codeFehler(grund) {
    statistik.codeFehler++;
    if (!this.erlaubteCodeFehler) fehler(`${this.name}: unerwarteter privateError "${grund}"`);
    else this.erlaubteCodeFehler--;
  }

  inWarteschlange() {
    if (this.verhalten === 'flooder' && !this.geflutet) {
      // 200 Ereignisse auf einmal – das Rate-Limit muss fast alle verwerfen.
      // Danach eine Sekunde Ruhe und ganz normal weiterspielen.
      this.geflutet = true;
      for (let i = 0; i < 200; i++) this.socket.emit(i % 2 ? 'queue' : 'move', MUELL[i % MUELL.length]);
      setTimeout(() => !this.fertig && this.inWarteschlange(), 1100);
      return;
    }
    this.socket.emit('queue');
    if (this.verhalten === 'zoegerer') {
      // Kurz warten, abbrechen, nochmal anstellen
      setTimeout(() => {
        if (this.fertig || this.spielId !== null) return;
        this.socket.emit('cancel');
        setTimeout(() => !this.fertig && this.spielId === null && this.socket.emit('queue'), 50);
      }, zufall(20, 100));
    }
  }

  // Findet sich kein Gegner mehr (ungerade Anzahl), gibt der Bot nach ein paar Sekunden auf
  wartet(daten) {
    if (daten.mode === 'private') {
      offeneCodes.push(daten.code);
      alleCodes.add(daten.code);
    }
    clearTimeout(this.warteTimer);
    this.warteTimer = setTimeout(() => {
      if (this.spielId === null) this.verlassen();
    }, daten.mode === 'private' ? 6000 : 3000);
  }

  // Jede empfangene Nachricht muss sauber aufgebaut sein
  chatEmpfangen(nachricht) {
    statistik.chatEmpfangen++;
    const ok = nachricht && typeof nachricht.text === 'string' && nachricht.text.length >= 1 &&
               nachricht.text.length <= 200 && typeof nachricht.from === 'string' &&
               (nachricht.color === ROT || nachricht.color === BLAU);
    if (!ok) fehler(`${this.name}: kaputte Chat-Nachricht empfangen`);
  }

  // Spammer: schickt viel zu schnell Nachrichten und Reaktionen (Server muss bremsen)
  spammen() {
    clearInterval(this.spamTimer);
    this.spamTimer = setInterval(() => {
      if (this.fertig || this.spielId === null) return clearInterval(this.spamTimer);
      this.socket.emit('chat', { text: `Spam ${Math.random()}`.repeat(zufall(1, 12)) });
      this.socket.emit('reaction', { emoji: REAKTIONEN[zufall(0, REAKTIONEN.length - 1)] });
    }, 150);
  }

  spielStart(daten) {
    clearTimeout(this.warteTimer);
    if (this.verhalten === 'spammer') this.spammen();
    // Normale Spieler grüßen manchmal
    else if (!this.istManipuliert() && Math.random() < 0.3) {
      setTimeout(() => !this.fertig && this.socket.emit('chat', { text: 'Viel Glück! 🍀' }), zufall(50, 500));
    }
    this.farbe = daten.color;
    this.spielId = daten.gameId;
    this.brett = null;
    this.eigeneZuege = 0;
    if (!spiele.has(daten.gameId)) {
      spiele.set(daten.gameId, { teilnehmer: new Set(), farben: new Set(), beendet: false, verlassenVon: new Set() });
      statistik.spieleGestartet++;
      if (daten.private) statistik.privateSpiele++;
    }
    const spiel = spiele.get(daten.gameId);
    spiel.teilnehmer.add(this.name);
    spiel.farben.add(daten.color);
    if (spiel.teilnehmer.size === 2 && spiel.farben.size !== 2) fehler(`Spiel ${daten.gameId}: beide haben dieselbe Farbe`);
  }

  neuerZustand(zustand) {
    clearTimeout(this.antwortTimer);
    this.brett = zustand.board;
    if (this.verhalten === 'chaot') this.chaos();
    if (zustand.turn !== this.farbe) return;

    // Swap-Regel: Blau tauscht manchmal statt zu setzen
    if (zustand.swapAvailable && this.farbe === BLAU && Math.random() < 0.4) {
      statistik.tausche++;
      this.socket.emit('swap');
      clearTimeout(this.antwortTimer);
      this.antwortTimer = setTimeout(() => this.ziehe(), 1500);   // falls verworfen: normal ziehen
      return;
    }

    // Besonderes Verhalten nach ein paar eigenen Zügen
    if (this.eigeneZuege >= this.abbruchNachZuegen) {
      if (this.verhalten === 'aufgeber') return this.socket.emit('resign');
      if (this.verhalten === 'abbrecher') return this.verlassen(true);
      if (this.verhalten === 'schlaefer') return;   // zieht nicht mehr → Zeit läuft ab
    }
    clearTimeout(this.zugTimer);
    this.zugTimer = setTimeout(() => this.ziehe(), zufall(30, 70));
  }

  // Zufälliger gültiger Zug auf ein freies Feld
  ziehe() {
    if (this.fertig || !this.brett) return;
    const frei = [];
    this.brett.forEach((zeile, r) => zeile.forEach((feld, c) => { if (!feld) frei.push([r, c]); }));
    if (frei.length === 0) return fehler(`${this.name}: Brett voll ohne Sieger`);
    const [row, col] = frei[zufall(0, frei.length - 1)];
    this.eigeneZuege++;
    statistik.zuege++;
    this.socket.emit('move', { row, col });
    // Kommt keine Antwort (z. B. vom Rate-Limit verworfen), nochmal versuchen
    clearTimeout(this.antwortTimer);
    this.antwortTimer = setTimeout(() => this.ziehe(), 1500);
  }

  // Chaot, Flooder und Spammer spielen einen manipulierten Client
  istManipuliert() {
    return ['chaot', 'flooder', 'spammer'].includes(this.verhalten);
  }

  ungueltig() {
    clearTimeout(this.antwortTimer);
    statistik.invalidNachVerhalten[this.verhalten] = (statistik.invalidNachVerhalten[this.verhalten] || 0) + 1;
    // Ehrliche Bots senden nur gültige Züge → hier darf nie "invalid" kommen
    if (!this.istManipuliert()) statistik.ungueltigeZuegeNormal++;
  }

  // Manipulierter Client: kaputte Daten und Ereignisse im falschen Zustand (maßvoll,
  // damit die eigenen echten Züge nicht vom Rate-Limit verworfen werden)
  chaos() {
    const ereignisse = ['move', 'swap', 'join', 'queue', 'cancel', 'gibtEsNicht', 'toString'];
    for (let i = 0; i < 3; i++) {
      this.socket.emit(ereignisse[zufall(0, ereignisse.length - 1)], MUELL[zufall(0, MUELL.length - 1)]);
    }
  }

  spielEnde(ende) {
    clearTimeout(this.zugTimer);
    clearTimeout(this.antwortTimer);
    const spiel = spiele.get(this.spielId);
    if (spiel) spiel.beendet = true;
    statistik.gameOver[ende.reason] = (statistik.gameOver[ende.reason] || 0) + 1;
    if (ende.reason === 'connect') {
      if (!this.brett) fehler(`${this.name}: Sieg ohne Brett`);
      else pruefeGewinnPfad(this.brett, ende.path, ende.winner, `${this.name} Spiel ${this.spielId}`);
    }
    if (ende.reason === 'timeout') {
      const verlierer = ende.winner === ROT ? BLAU : ROT;
      if (verlierer === this.farbe) {
        statistik.timeoutVerlierer[this.verhalten] = (statistik.timeoutVerlierer[this.verhalten] || 0) + 1;
        // Ehrliche Bots ziehen immer rechtzeitig – ein Timeout hieße: ein Zug ist hängen geblieben
        if (!this.istManipuliert() && this.verhalten !== 'schlaefer') fehler(`${this.name}: ehrlicher Bot verliert auf Zeit`);
      }
      if (!ende.clock || ende.clock[verlierer] !== 0) fehler(`${this.name}: Timeout, aber Uhr des Verlierers steht nicht auf 0`);
      if (!ende.clock || ende.clock[ende.winner] <= 0) fehler(`${this.name}: Timeout, aber auch der Sieger hat keine Zeit mehr`);
    }
    this.spielId = null;
    this.farbe = null;
    this.spieleUebrig--;
    if (this.spieleUebrig <= 0) {
      setTimeout(() => this.verlassen(), zufall(10, 200));
    } else if (ende.reason !== 'disconnect' && Math.random() < 0.5) {
      // Revanche anbieten; kommt nach 800 ms nichts, normal weitersuchen
      this.socket.emit('rematch');
      clearTimeout(this.revancheTimer);
      this.revancheTimer = setTimeout(() => this.weiterNachSpiel(), 800);
    } else {
      setTimeout(() => this.weiterNachSpiel(), zufall(10, 200));
    }
  }

  // Gegner möchte eine Revanche → annehmen, wenn noch Spiele übrig sind
  revancheAngebot() {
    if (this.fertig || this.spielId !== null || this.spieleUebrig <= 0) return;
    statistik.revanchen++;
    this.socket.emit('rematch');
  }

  // Keine Revanche (mehr) → in die Warteschlange, falls noch kein neues Spiel läuft
  weiterNachSpiel() {
    clearTimeout(this.revancheTimer);
    if (!this.fertig && this.spielId === null && this.spieleUebrig > 0) this.socket.emit('queue');
  }

  // hart = Verbindung mitten im Spiel einfach kappen
  verlassen(hart = false) {
    if (this.fertig) return;
    if (this.spielId !== null) spiele.get(this.spielId)?.verlassenVon.add(this.name);
    if (!hart) this.socket.emit('logout');
    setTimeout(() => this.socket.disconnect(), hart ? 0 : 20);
  }

  fertigMachen() {
    if (this.fertig) return;
    this.fertig = true;
    for (const t of [this.zugTimer, this.warteTimer, this.antwortTimer, this.revancheTimer]) clearTimeout(t);
    clearInterval(this.spamTimer);
    if (this.socket.connected) this.socket.disconnect();
    this.beenden();
  }
}

// ---------- Ablauf ----------
async function main() {
  const start = Date.now();
  // Server-Fehler mitzählen (zusätzlich zu diagnose().fehler)
  const originalError = console.error;
  let serverFehlerAusgaben = 0;
  console.error = (...args) => { serverFehlerAusgaben++; originalError(...args); };

  const server = erstelleServer();
  const port = await server.starte(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  console.log(`Lasttest: ${ANZAHL_BOTS} Bots gegen ${url}`);

  const bots = [];
  for (let i = 0; i < ANZAHL_BOTS; i++) bots.push(new Bot(i + 1, VERHALTEN[i % VERHALTEN.length], url));

  // Bots leicht versetzt starten
  const laeufe = bots.map(async bot => {
    await pause(zufall(0, 400));
    return bot.start();
  });

  const zeitlimit = pause(MAX_DAUER_MS).then(() => 'zeitlimit');
  const ergebnis = await Promise.race([Promise.all(laeufe), zeitlimit]);
  if (ergebnis === 'zeitlimit') {
    const haengend = bots.filter(b => !b.fertig).map(b => `${b.name}(${b.verhalten})`);
    fehler(`Zeitlimit erreicht, nicht fertig: ${haengend.join(', ')}`);
    bots.forEach(b => b.socket.disconnect());
  }

  // Jedes Spiel, in dem mindestens ein Spieler bis zum Ende verbunden blieb, muss beendet sein
  for (const [id, spiel] of spiele) {
    const jemandBlieb = [...spiel.teilnehmer].some(name => !spiel.verlassenVon.has(name));
    if (jemandBlieb && !spiel.beendet) fehler(`Spiel ${id} wurde nie beendet`);
  }
  if (statistik.ungueltigeZuegeNormal > 0) {
    fehler(`${statistik.ungueltigeZuegeNormal} gültige Züge wurden als ungültig abgelehnt`);
  }

  if (statistik.privateSpiele === 0) fehler('Es wurde kein einziges privates Spiel gespielt');
  if (statistik.chatAbgelehnt === 0) fehler('Das Chat-Rate-Limit hat nie gegriffen');

  // Server muss aufgeräumt haben …
  const leer = { spieler: 0, warteschlange: 0, partien: 0, privateRaeume: 0, raeume: 0, timer: 0 };
  const bisLeer = Date.now() + 3000;
  let diagnose = server.diagnose();
  while (Date.now() < bisLeer && Object.keys(leer).some(k => diagnose[k] !== 0)) {
    await pause(50);
    diagnose = server.diagnose();
  }
  for (const k of Object.keys(leer)) {
    if (diagnose[k] !== 0) fehler(`Nach dem Test nicht leer: ${k} = ${diagnose[k]}`);
  }
  if (diagnose.fehler > 0 || serverFehlerAusgaben > 0) {
    fehler(`Server-Fehler: ${diagnose.fehler} in Handlern, ${serverFehlerAusgaben} Fehlerausgaben`);
  }

  // … und weiterhin funktionieren
  const antwort = await fetch(url).catch(() => null);
  if (!antwort || antwort.status !== 200) fehler('Server antwortet nach dem Test nicht mehr');
  const probe = ioClient(url, { forceNew: true, reconnection: false, transports: ['websocket'] });
  const angenommen = await new Promise(resolve => {
    probe.on('connect', () => probe.emit('join', { name: 'Probe' }));
    probe.on('joined', () => resolve(true));
    setTimeout(() => resolve(false), 2000);
  });
  probe.disconnect();
  if (!angenommen) fehler('Neuer Spieler kann sich nach dem Test nicht anmelden');

  await server.stoppe();
  console.error = originalError;

  const dauer = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Spiele gestartet: ${statistik.spieleGestartet} (davon privat: ${statistik.privateSpiele}), Züge: ${statistik.zuege}, Dauer: ${dauer} s`);
  console.log(`Falsche Codes sauber abgelehnt: ${statistik.codeFehler}, Tausch (Swap-Regel): ${statistik.tausche}, Revanchen: ${statistik.revanchen}`);
  console.log('Spielenden nach Grund (je Client gezählt):', statistik.gameOver);
  console.log(`Chat: ${statistik.chatEmpfangen} Nachrichten zugestellt, ${statistik.chatAbgelehnt} abgelehnt, ${statistik.reaktionen} Reaktionen`);
  console.log('Abgelehnte Züge nach Verhalten:', statistik.invalidNachVerhalten);
  console.log('Auf Zeit verloren nach Verhalten:', statistik.timeoutVerlierer);
  console.log('Server-Zustand am Ende:', diagnose);

  if (statistik.fehler.length) {
    console.error(`\nLasttest FEHLGESCHLAGEN (${statistik.fehler.length} Probleme):`);
    for (const f of statistik.fehler.slice(0, 30)) console.error(' -', f);
    process.exit(1);
  }
  console.log('\nLasttest bestanden ✓');
  process.exit(0);
}

main().catch(err => {
  console.error('Lasttest abgebrochen:', err);
  process.exit(1);
});
