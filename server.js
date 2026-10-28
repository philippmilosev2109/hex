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

// Die möglichen Zustände eines angemeldeten Spielers.
// Jeder Spieler ist immer in genau einem davon.
const IDLE = 'idle';             // angemeldet, macht gerade nichts
const WARTEND = 'wartend';       // in der Warteschlange
const IM_SPIEL = 'imSpiel';      // spielt gerade

// Erstellt einen kompletten Hex-Server (noch ohne zu starten).
// Die Tests erzeugen damit eigene Server mit kurzen Zeiten.
function erstelleServer(optionen = {}) {
  const einstellungen = {
    maxEventsProSekunde: 20,     // Rate-Limit pro Socket
    lobbyVerzoegerungMs: 100,    // Lobby-Updates werden kurz gesammelt
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

  // Zustand, den alle im Spielraum bekommen (Spieler und später Zuschauer)
  function zustandFuer(partie) {
    const spiel = partie.spiel;
    return {
      board: spiel.brett,
      turn: spiel.beendet ? null : spiel.amZug,
      moves: spiel.zuege.map(z => ({ color: z.farbe, row: z.row, col: z.col, swap: z.tausch })),
    };
  }

  function sendeZustand(partie) {
    io.to(partie.raum).emit('state', zustandFuer(partie));
  }

  function namenVon(partie) {
    return { red: partie.spieler.red.name, blue: partie.spieler.blue.name };
  }

  // Zwei Spieler in eine neue Partie setzen. Farben werden zufällig verteilt.
  function starteSpiel(a, b) {
    const [rot, blau] = Math.random() < 0.5 ? [a, b] : [b, a];
    const id = naechsteSpielId++;
    const partie = {
      id,
      raum: `spiel-${id}`,          // eigener Socket.io-Raum pro Spiel
      spiel: new HexSpiel(),
      spieler: { red: rot, blue: blau },
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
      });
    }
    sendeZustand(partie);
    lobbyAktualisieren();
  }

  // Spielende an alle im Raum melden und aufräumen
  function beendePartie(partie) {
    const spiel = partie.spiel;
    io.to(partie.raum).emit('gameOver', {
      winner: spiel.gewinner,
      reason: spiel.grund,
      path: spiel.gewinnPfad,
      moveCount: spiel.zuege.length,
      players: namenVon(partie),
    });
    for (const sp of Object.values(partie.spieler)) {
      if (sp.partie !== partie) continue;
      sp.zustand = IDLE;
      sp.partie = null;
      sp.farbe = null;
      if (sp.socket) sp.socket.leave(partie.raum);
    }
    partien.delete(partie.id);
    lobbyAktualisieren();
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

  // Beendet, was der Spieler gerade tut (warten / spielen) → danach IDLE.
  // grund: 'resign' (aufgegeben) oder 'disconnect' (Verbindung weg / abgemeldet)
  function verlasseAktivitaet(sp, grund) {
    if (sp.zustand === WARTEND) {
      entferneAusWarteschlange(sp);
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
      };
      spielerListe.set(sp.id, sp);
      socket.data.spieler = sp;
      socket.join('lobby');
      socket.emit('joined', { name });
      socket.emit('lobby', lobbyDaten());
      lobbyAktualisieren();
    });

    // In die Warteschlange ("Spielen" / "Nochmal spielen")
    an('queue', () => {
      const sp = spieler();
      if (!sp || sp.zustand !== IDLE) return;
      stelleInWarteschlange(sp);
    });

    // Warten abbrechen
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
      if (!ergebnis.ok) {
        socket.emit('invalid', { reason: ergebnis.grund });   // nur an den Absender
        return;
      }
      sendeZustand(partie);                                   // an beide Spieler
      if (partie.spiel.beendet) beendePartie(partie);
    });

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
