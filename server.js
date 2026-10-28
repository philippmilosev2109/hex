// server.js – Node.js-Server für Hex
// Express liefert die Webseite aus (Ordner public/), Socket.io verbindet die Spieler.
// Der Server ist die einzige "Wahrheit": Er verwaltet Warteschlange und Spiele,
// prüft jeden Zug (mit game.js) und schickt den Zustand an die Browser.

'use strict';

const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { HexSpiel } = require('./game');

const NAME_MAX = 20;

// Codes für private Spiele: gut lesbar, darum ohne 0/O und 1/I
const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LAENGE = 4;

// Die möglichen Zustände eines angemeldeten Spielers.
// Jeder Spieler ist immer in genau einem davon.
const IDLE = 'idle';             // angemeldet, macht gerade nichts (Lobby)
const WARTEND = 'wartend';       // in der Warteschlange oder im eigenen privaten Raum
const IM_SPIEL = 'imSpiel';      // spielt gerade

// Zeiten lassen sich per Umgebungsvariable ändern (z. B. kürzer im Lasttest)
function zahlAusUmgebung(name, standard) {
  const wert = Number(process.env[name]);
  return Number.isFinite(wert) && wert > 0 ? wert : standard;
}

// Erstellt einen kompletten Hex-Server (noch ohne zu starten).
// Die Tests erzeugen damit eigene Server mit kurzen Zeiten.
function erstelleServer(optionen = {}) {
  const einstellungen = {
    maxEventsProSekunde: 20,     // Rate-Limit pro Socket
    lobbyVerzoegerungMs: 100,    // Lobby-Updates werden kurz gesammelt
    privatAblaufMs: zahlAusUmgebung('HEX_PRIVAT_MS', 10 * 60 * 1000), // Code gilt 10 Minuten
    zeitMs: zahlAusUmgebung('HEX_ZEIT_MS', 3 * 60 * 1000),            // Bedenkzeit je Spieler
    ...optionen,
  };

  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,  // keine riesigen Nachrichten annehmen
  });

  // ---------- Zustand im Speicher ----------
  const spielerListe = new Map();  // Spieler-ID → Spieler
  const warteschlange = [];        // FIFO: wer zuerst kommt, spielt zuerst
  const partien = new Map();       // Spiel-ID → Partie
  const privateRaeume = new Map(); // Code → { code, ersteller, timer }
  const aktiveTimer = new Set();   // alle laufenden setTimeout (zur Kontrolle)
  let naechsteSpielId = 1;
  let fehlerAnzahl = 0;
  let lobbyTimer = null;

  // ---------- Hilfsfunktionen ----------

  // Führt eine Funktion aus und fängt jeden Fehler ab,
  // damit ein Fehler niemals den ganzen Server abstürzen lässt.
  function sicher(beschreibung, funktion) {
    return (...argumente) => {
      try {
        funktion(...argumente);
      } catch (fehler) {
        fehlerAnzahl++;
        console.error(`Fehler bei "${beschreibung}":`, fehler);
      }
    };
  }

  // setTimeout mit Buchführung: so sieht man, ob noch Timer hängen.
  function starteTimer(ms, beschreibung, funktion) {
    const timer = setTimeout(() => {
      aktiveTimer.delete(timer);
      sicher(beschreibung, funktion)();
    }, ms);
    aktiveTimer.add(timer);
    return timer;
  }

  function stoppeTimer(timer) {
    if (!timer) return;
    clearTimeout(timer);
    aktiveTimer.delete(timer);
  }

  function istObjekt(wert) {
    return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
  }

  // Namen prüfen und säubern: Steuerzeichen und unsichtbare Zeichen entfernen,
  // Leerzeichen zusammenfassen, 1–20 Zeichen. Ungültig → null.
  function pruefeName(name) {
    if (typeof name !== 'string' || name.length > 200) return null;
    const sauber = name
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (sauber.length < 1 || sauber.length > NAME_MAX) return null;
    return sauber;
  }

  // ---------- Lobby ----------

  // Was alle angemeldeten Spieler in der Lobby live sehen
  function lobbyDaten() {
    return {
      online: spielerListe.size,
      games: partien.size,
    };
  }

  // Lobby-Update an alle Angemeldeten (Raum "lobby"). Viele Änderungen kurz
  // hintereinander werden zu einer Nachricht gebündelt.
  function lobbyAktualisieren() {
    if (lobbyTimer) return;
    lobbyTimer = starteTimer(einstellungen.lobbyVerzoegerungMs, 'lobby', () => {
      lobbyTimer = null;
      io.to('lobby').emit('lobby', lobbyDaten());
    });
  }

  // ---------- Spielablauf ----------

  // Restzeit beider Uhren in Millisekunden (jetzt gerade)
  function uhrenVon(spiel) {
    const jetzt = Date.now();
    return { red: spiel.restzeit('red', jetzt), blue: spiel.restzeit('blue', jetzt) };
  }

  // Zustand, den alle im Spielraum bekommen (Spieler und später Zuschauer)
  function zustandFuer(partie) {
    const spiel = partie.spiel;
    return {
      board: spiel.brett,
      turn: spiel.beendet ? null : spiel.amZug,
      moves: spiel.zuege.map(z => ({ color: z.farbe, row: z.row, col: z.col, swap: z.tausch })),
      clock: uhrenVon(spiel),
      swapAvailable: spiel.swapMoeglich(),   // darf Blau gerade tauschen?
    };
  }

  function sendeZustand(partie) {
    io.to(partie.raum).emit('state', zustandFuer(partie));
  }

  function namenVon(partie) {
    return { red: partie.spieler.red.name, blue: partie.spieler.blue.name };
  }

  // Zwei Spieler in eine neue Partie setzen. Farben werden zufällig verteilt,
  // außer bei der Revanche (festeFarben: a spielt Rot, b spielt Blau).
  function starteSpiel(a, b, { privat = false, festeFarben = false } = {}) {
    const [rot, blau] = festeFarben || Math.random() < 0.5 ? [a, b] : [b, a];
    beendeNachSpiel(a);   // alte Revanche-Angebote sind damit erledigt
    beendeNachSpiel(b);
    const id = naechsteSpielId++;
    const partie = {
      id,
      raum: `spiel-${id}`,          // eigener Socket.io-Raum pro Spiel
      privat,                       // private Spiele tauchen nirgends öffentlich auf
      spiel: new HexSpiel({ zeitMs: einstellungen.zeitMs, jetzt: Date.now() }),
      spieler: { red: rot, blue: blau },
      uhrTimer: null,               // feuert, wenn die Zeit des Spielers am Zug abläuft
    };
    partien.set(id, partie);

    for (const farbe of ['red', 'blue']) {
      const sp = partie.spieler[farbe];
      const gegner = partie.spieler[farbe === 'red' ? 'blue' : 'red'];
      sp.zustand = IM_SPIEL;
      sp.partie = partie;
      sp.farbe = farbe;
      sp.socket.join(partie.raum);
      sp.socket.emit('gameStart', {
        gameId: id,
        color: farbe,
        you: sp.name,
        opponent: gegner.name,
        players: namenVon(partie),
        private: privat,
        timeMs: einstellungen.zeitMs,
      });
    }
    sendeZustand(partie);
    planeUhr(partie);
    lobbyAktualisieren();
  }

  // Schachuhr: Ein Server-Timer feuert genau dann, wenn die Restzeit des
  // Spielers am Zug abläuft. Nach jedem Zug wird er neu gestellt.
  function planeUhr(partie) {
    stoppeTimer(partie.uhrTimer);
    partie.uhrTimer = null;
    const spiel = partie.spiel;
    if (spiel.beendet || !spiel.zeitkonto) return;
    const rest = spiel.restzeit(spiel.amZug, Date.now());
    partie.uhrTimer = starteTimer(rest + 5, 'uhr', () => {
      partie.uhrTimer = null;
      if (!partien.has(partie.id)) return;
      if (spiel.pruefeZeit(Date.now())) {
        sendeZustand(partie);          // zeigt die abgelaufene Uhr (0:00)
        beendePartie(partie);
      } else {
        planeUhr(partie);              // Timer kam einen Hauch zu früh
      }
    });
  }

  // Spielende an alle im Raum melden und aufräumen
  function beendePartie(partie) {
    const spiel = partie.spiel;
    stoppeTimer(partie.uhrTimer);
    partie.uhrTimer = null;
    io.to(partie.raum).emit('gameOver', {
      winner: spiel.gewinner,
      reason: spiel.grund,
      path: spiel.gewinnPfad,
      moveCount: spiel.zuege.length,
      players: namenVon(partie),
      clock: uhrenVon(spiel),
    });
    for (const sp of Object.values(partie.spieler)) {
      if (sp.partie !== partie) continue;
      sp.zustand = IDLE;
      sp.partie = null;
      sp.farbe = null;
      if (sp.socket) sp.socket.leave(partie.raum);
    }
    // Revanche vorbereiten: Beide merken sich den Gegner und ihre Farbe.
    // Hat jemand das Spiel verlassen, gibt es keine Revanche.
    if (spiel.grund !== 'disconnect') {
      const { red: rot, blue: blau } = partie.spieler;
      rot.nachSpiel = { gegner: blau, farbe: 'red', revanche: false, privat: partie.privat };
      blau.nachSpiel = { gegner: rot, farbe: 'blue', revanche: false, privat: partie.privat };
    }
    partien.delete(partie.id);
    lobbyAktualisieren();
  }

  // ---------- Revanche ----------

  // Der Spieler verlässt den Spielende-Bildschirm (neues Spiel, Lobby, Abmelden …):
  // Ein Revanche-Angebot ist damit hinfällig – der Gegner erfährt es sofort.
  function beendeNachSpiel(sp) {
    const nach = sp.nachSpiel;
    if (!nach) return;
    sp.nachSpiel = null;
    const gegner = nach.gegner;
    if (gegner.nachSpiel && gegner.nachSpiel.gegner === sp) {
      gegner.nachSpiel = null;
      if (gegner.socket) gegner.socket.emit('rematchCancelled', { reason: `${sp.name} ist nicht mehr da – keine Revanche möglich.` });
    }
  }

  // Revanche wünschen. Wollen beide, startet sofort ein Spiel mit getauschten Farben.
  function wuenscheRevanche(sp) {
    const nach = sp.nachSpiel;
    if (!nach || nach.revanche) return;           // kein Gegner oder schon gefragt
    const gegner = nach.gegner;
    const gegnerDa = gegner.nachSpiel && gegner.nachSpiel.gegner === sp &&
                     gegner.zustand === IDLE && gegner.socket;
    if (!gegnerDa) {
      sp.nachSpiel = null;
      sp.socket.emit('rematchCancelled', { reason: 'Dein Gegner ist nicht mehr da – keine Revanche möglich.' });
      return;
    }
    if (gegner.nachSpiel.revanche) {
      // Wer zuletzt Rot war, spielt jetzt Blau – und umgekehrt
      const [rot, blau] = nach.farbe === 'red' ? [gegner, sp] : [sp, gegner];
      sp.nachSpiel = null;
      gegner.nachSpiel = null;
      starteSpiel(rot, blau, { privat: nach.privat, festeFarben: true });
      return;
    }
    nach.revanche = true;
    gegner.socket.emit('rematchOffered', { from: sp.name });
    sp.socket.emit('rematchWaiting', { opponent: gegner.name });
  }

  // Warteschlange: Sobald zwei Spieler warten, startet ein Spiel.
  function stelleInWarteschlange(sp) {
    sp.zustand = WARTEND;
    warteschlange.push(sp);
    sp.socket.emit('waiting', { mode: 'queue' });
    while (warteschlange.length >= 2) {
      const a = warteschlange.shift();
      const b = warteschlange.shift();
      starteSpiel(a, b);
    }
  }

  function entferneAusWarteschlange(sp) {
    const index = warteschlange.indexOf(sp);
    if (index !== -1) warteschlange.splice(index, 1);
  }

  // ---------- Private Spiele ----------

  // Zufälliger, noch nicht vergebener Code (32^4 ≈ 1 Million Möglichkeiten)
  function neuerCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < CODE_LAENGE; i++) code += CODE_ZEICHEN[crypto.randomInt(CODE_ZEICHEN.length)];
    } while (privateRaeume.has(code));
    return code;
  }

  // Code aus der Eingabe säubern: Leerzeichen weg, Großbuchstaben. Ungültig → null.
  function pruefeCode(code) {
    if (typeof code !== 'string' || code.length > 20) return null;
    const sauber = code.replace(/\s/g, '').toUpperCase();
    if (sauber.length !== CODE_LAENGE) return null;
    if (![...sauber].every(zeichen => CODE_ZEICHEN.includes(zeichen))) return null;
    return sauber;
  }

  // Privaten Raum öffnen: Der Ersteller wartet, bis jemand mit dem Code beitritt.
  // Nach einiger Zeit läuft der Code ab.
  function erstellePrivatRaum(sp) {
    const code = neuerCode();
    const raum = { code, ersteller: sp, timer: null };
    raum.timer = starteTimer(einstellungen.privatAblaufMs, 'privat-ablauf', () => {
      if (privateRaeume.get(code) !== raum) return;
      schliessePrivatRaum(sp);
      sp.zustand = IDLE;
      if (sp.socket) sp.socket.emit('privateExpired');
    });
    privateRaeume.set(code, raum);
    sp.zustand = WARTEND;
    sp.privatCode = code;
    sp.socket.emit('waiting', { mode: 'private', code, expiresInMs: einstellungen.privatAblaufMs });
  }

  function schliessePrivatRaum(sp) {
    const raum = privateRaeume.get(sp.privatCode);
    if (raum && raum.ersteller === sp) {
      stoppeTimer(raum.timer);
      privateRaeume.delete(raum.code);
    }
    sp.privatCode = null;
  }

  // Beendet, was der Spieler gerade tut (warten / spielen) → danach IDLE.
  // grund: 'resign' (aufgegeben) oder 'disconnect' (Verbindung weg / abgemeldet)
  function verlasseAktivitaet(sp, grund) {
    if (sp.zustand === WARTEND) {
      if (sp.privatCode) schliessePrivatRaum(sp);
      else entferneAusWarteschlange(sp);
    } else if (sp.zustand === IM_SPIEL) {
      const partie = sp.partie;
      partie.spiel.beendeDurch(sp.farbe, grund, Date.now());
      beendePartie(partie);
    }
    sp.zustand = IDLE;
  }

  // ---------- Verbindungen ----------

  io.on('connection', socket => {
    // Rate-Limit: höchstens N Ereignisse pro Sekunde, der Rest wird verworfen
    let fensterStart = 0;
    let anzahl = 0;
    socket.use((paket, weiter) => {
      const jetzt = Date.now();
      if (jetzt - fensterStart >= 1000) {
        fensterStart = jetzt;
        anzahl = 0;
      }
      anzahl++;
      if (anzahl <= einstellungen.maxEventsProSekunde) weiter();
    });

    // Kurzschreibweise: Ereignis-Handler, der nie abstürzt
    const an = (ereignis, handler) => socket.on(ereignis, sicher(ereignis, handler));
    const spieler = () => socket.data.spieler || null;

    // Anmelden mit Namen
    an('join', daten => {
      if (spieler()) return;                          // doppeltes join ignorieren
      const name = pruefeName(istObjekt(daten) ? daten.name : undefined);
      if (!name) {
        socket.emit('joinError', { reason: `Bitte gib einen Namen mit 1–${NAME_MAX} Zeichen ein.` });
        return;
      }
      const sp = {
        id: crypto.randomUUID(),
        name,
        socket,
        zustand: IDLE,
        partie: null,
        farbe: null,
        privatCode: null,     // Code des eigenen privaten Raums (nur beim Warten)
        nachSpiel: null,      // nach Spielende: { gegner, farbe, revanche, privat }
      };
      spielerListe.set(sp.id, sp);
      socket.data.spieler = sp;
      socket.join('lobby');
      socket.emit('joined', { name });
      socket.emit('lobby', lobbyDaten());
      lobbyAktualisieren();
    });

    // In die Warteschlange ("Schnelles Spiel" / "Neuer Gegner")
    an('queue', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      beendeNachSpiel(sp);
      stelleInWarteschlange(sp);
    });

    // Privates Spiel erstellen → Code bekommen und warten
    an('createPrivate', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      beendeNachSpiel(sp);
      erstellePrivatRaum(sp);
    });

    // Revanche: gleicher Gegner, Farben getauscht – erst wenn beide zustimmen
    an('rematch', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      wuenscheRevanche(sp);
    });

    // Spielende-Bildschirm verlassen ("Zur Lobby") → keine Revanche mehr
    an('leaveGame', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      beendeNachSpiel(sp);
    });

    // Privatem Spiel beitreten: { code }
    an('joinPrivate', daten => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      const code = pruefeCode(istObjekt(daten) ? daten.code : undefined);
      if (!code) {
        socket.emit('privateError', { reason: 'Ein Code besteht aus 4 Zeichen (Buchstaben A–Z ohne I/O, Ziffern 2–9).' });
        return;
      }
      const raum = privateRaeume.get(code);
      if (!raum) {
        socket.emit('privateError', { reason: 'Kein offenes Spiel mit diesem Code – er ist ungültig, abgelaufen oder schon vergeben.' });
        return;
      }
      // Code ist nur einmal gültig: Raum schließen und sofort spielen
      const ersteller = raum.ersteller;
      schliessePrivatRaum(ersteller);
      starteSpiel(ersteller, sp, { privat: true });
    });

    // Warten abbrechen (Warteschlange oder eigener privater Raum)
    an('cancel', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== WARTEND) return;
      verlasseAktivitaet(sp, 'disconnect');
      socket.emit('cancelled');
    });

    // Ein Zug: { row, col }
    an('move', daten => {
      const sp = spieler();
      if (!sp || sp.zustand !== IM_SPIEL) return;     // nicht im Spiel → ignorieren
      const partie = sp.partie;
      if (!istObjekt(daten)) {
        socket.emit('invalid', { reason: 'Ungültige Zugdaten.' });
        return;
      }
      const ergebnis = partie.spiel.setzeStein(sp.farbe, daten.row, daten.col, Date.now());
      nachAktion(partie, ergebnis);
    });

    // Swap-Regel: Blau übernimmt den ersten roten Stein (gespiegelt)
    an('swap', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IM_SPIEL) return;
      const partie = sp.partie;
      nachAktion(partie, partie.spiel.tausche(sp.farbe, Date.now()));
    });

    // Gemeinsamer Abschluss für Zug und Tausch
    function nachAktion(partie, ergebnis) {
      if (!ergebnis.ok) {
        socket.emit('invalid', { reason: ergebnis.grund });   // nur an den Absender
        if (partie.spiel.beendet) {                           // Zeit war schon abgelaufen
          sendeZustand(partie);
          beendePartie(partie);
        }
        return;
      }
      sendeZustand(partie);                                   // an beide Spieler
      if (partie.spiel.beendet) beendePartie(partie);
      else planeUhr(partie);
    }

    // Aufgeben: Der Gegner gewinnt sofort
    an('resign', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IM_SPIEL) return;
      verlasseAktivitaet(sp, 'resign');
    });

    // Abmelden: alles verlassen, Name vergessen (Socket bleibt verbunden)
    an('logout', () => {
      const sp = spieler();
      if (!sp) return;
      verlasseAktivitaet(sp, 'disconnect');
      beendeNachSpiel(sp);
      spielerListe.delete(sp.id);
      socket.data.spieler = null;
      socket.leave('lobby');
      socket.emit('loggedOut');
      lobbyAktualisieren();
    });

    // Verbindung weg (Tab zu, WLAN weg …): vollständig aufräumen
    socket.on('disconnect', sicher('disconnect', () => {
      const sp = spieler();
      if (!sp) return;
      verlasseAktivitaet(sp, 'disconnect');
      beendeNachSpiel(sp);
      sp.socket = null;
      spielerListe.delete(sp.id);
      lobbyAktualisieren();
    }));
  });

  // ---------- Steuerung und Kontrolle ----------

  // Server starten. Port 0 = freien Port wählen (für Tests).
  function starte(port = 3000, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        resolve(httpServer.address().port);
      });
    });
  }

  // Server stoppen: alle Verbindungen trennen, alle Timer beenden
  function stoppe() {
    for (const timer of aktiveTimer) clearTimeout(timer);
    aktiveTimer.clear();
    lobbyTimer = null;
    return new Promise(resolve => io.close(() => resolve()));
  }

  // Überblick über alles, was im Speicher liegt (für Tests und Lasttest)
  function diagnose() {
    const spielRaeume = [...io.of('/').adapter.rooms.keys()].filter(r => r.startsWith('spiel-'));
    return {
      spieler: spielerListe.size,
      warteschlange: warteschlange.length,
      partien: partien.size,
      privateRaeume: privateRaeume.size,
      raeume: spielRaeume.length,
      timer: aktiveTimer.size,
      fehler: fehlerAnzahl,
    };
  }

  return { app, httpServer, io, starte, stoppe, diagnose };
}

// Alle IPv4-Adressen dieses Rechners im lokalen Netz (für Mitspieler)
function netzwerkAdressen() {
  const adressen = [];
  for (const liste of Object.values(os.networkInterfaces())) {
    for (const a of liste || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) adressen.push(a.address);
    }
  }
  return adressen;
}

// Nur wenn die Datei direkt gestartet wird (npm start), nicht in Tests
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = erstelleServer();
  server.starte(port, '0.0.0.0')
    .then(() => {
      console.log(`Hex-Server läuft auf http://localhost:${port}`);
      for (const ip of netzwerkAdressen()) console.log(`Mitspieler öffnen: http://${ip}:${port}`);
    })
    .catch(fehler => {
      if (fehler.code === 'EADDRINUSE') console.error(`Port ${port} ist schon belegt. Anderer Port: PORT=3001 npm start`);
      else console.error('Server konnte nicht starten:', fehler);
      process.exit(1);
    });
}

module.exports = { erstelleServer };
