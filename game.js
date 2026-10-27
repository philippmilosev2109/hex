// game.js – Reine Spiellogik für Hex
// Enthält KEIN Socket.io und kein Netzwerk: nur Brett, Zugprüfung, Sieg-Erkennung,
// Swap-Regel und Schachuhr. Dadurch lässt sich alles mit Jest testen.
// Nur der Server benutzt diese Datei – der Browser rechnet nie selbst.

'use strict';

const GROESSE = 11;     // 11×11 Felder
const ROT = 'red';      // Rot verbindet oben ↔ unten
const BLAU = 'blue';    // Blau verbindet links ↔ rechts

// Die 6 Nachbarn eines Feldes als Verschiebung [Zeile, Spalte].
// Passend zur Geometrie des Bretts: Jede Zeile ist um eine halbe Feldbreite
// nach rechts verschoben (Rautenform). Dadurch liegen die Nachbarn
// oberhalb bei Spalte c und c+1, unterhalb bei Spalte c-1 und c.
const RICHTUNGEN = [
  [0, -1], [0, 1],    // links, rechts
  [-1, 0], [-1, 1],   // oben links, oben rechts
  [1, -1], [1, 0],    // unten links, unten rechts
];

// Leeres Brett: 2D-Array, jedes Feld ist null (frei), 'red' oder 'blue'
function erstelleBrett(groesse = GROESSE) {
  return Array.from({ length: groesse }, () => Array(groesse).fill(null));
}

// Liegt (row, col) auf dem Brett? Prüft auch, dass es ganze Zahlen sind.
function istAufBrett(row, col, groesse = GROESSE) {
  return Number.isInteger(row) && Number.isInteger(col) &&
         row >= 0 && row < groesse && col >= 0 && col < groesse;
}

// Alle Nachbarfelder von (row, col), die auf dem Brett liegen
function nachbarn(row, col, groesse = GROESSE) {
  const liste = [];
  for (const [dr, dc] of RICHTUNGEN) {
    if (istAufBrett(row + dr, col + dc, groesse)) liste.push([row + dr, col + dc]);
  }
  return liste;
}

function gegnerVon(farbe) {
  return farbe === ROT ? BLAU : ROT;
}

// Swap-Regel: Der rote Stein wird an der langen Diagonale gespiegelt,
// d. h. Zeile und Spalte werden vertauscht (wie in den offiziellen Hex-Regeln).
// Dadurch wird aus "oben/unten" für Rot genau "links/rechts" für Blau.
function spiegeln(row, col) {
  return { row: col, col: row };
}

// Sieg-Erkennung per Breitensuche (BFS).
// Rot: Start in der obersten Zeile, Ziel in der untersten Zeile.
// Blau: Start in der linken Spalte, Ziel in der rechten Spalte.
// Rückgabe: Gewinnpfad als Liste von Feldern [{row, col}, ...] oder null.
// Weil BFS Feld für Feld "in Wellen" sucht, ist der gefundene Pfad
// automatisch eine kürzeste Kette – ohne Sackgassen.
function findeGewinnPfad(brett, farbe) {
  const n = brett.length;
  const istStart = (r, c) => (farbe === ROT ? r === 0 : c === 0);
  const istZiel = (r, c) => (farbe === ROT ? r === n - 1 : c === n - 1);

  // vorgaenger[r][c]: undefined = noch nicht besucht,
  // null = Startfeld, sonst das Feld, von dem wir gekommen sind
  const vorgaenger = brett.map(zeile => zeile.map(() => undefined));
  const warteschlange = [];

  // 1. Alle eigenen Steine am Startrand in die Warteschlange
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (istStart(r, c) && brett[r][c] === farbe) {
        vorgaenger[r][c] = null;
        warteschlange.push({ row: r, col: c });
      }
    }
  }

  // 2. Breitensuche: immer das älteste Feld aus der Warteschlange nehmen
  for (let kopf = 0; kopf < warteschlange.length; kopf++) {
    const feld = warteschlange[kopf];

    // 3. Zielrand erreicht → Pfad über die Vorgänger rückwärts aufbauen
    if (istZiel(feld.row, feld.col)) {
      const pfad = [];
      for (let f = feld; f !== null; f = vorgaenger[f.row][f.col]) pfad.unshift(f);
      return pfad;
    }

    // 4. Eigene, noch nicht besuchte Nachbarn hinten anstellen
    for (const [r, c] of nachbarn(feld.row, feld.col, n)) {
      if (brett[r][c] === farbe && vorgaenger[r][c] === undefined) {
        vorgaenger[r][c] = feld;
        warteschlange.push({ row: r, col: c });
      }
    }
  }
  return null; // keine Verbindung
}

// Ein einzelnes Spiel: Brett, wer am Zug ist, Zugliste, Ergebnis und Uhren.
// Alle Methoden, die mit Zeit rechnen, bekommen "jetzt" (Millisekunden) übergeben –
// so kann man die Uhr in Tests genau steuern.
class HexSpiel {
  constructor({ zeitMs = null, swapRegel = true, jetzt = Date.now() } = {}) {
    this.brett = erstelleBrett();
    this.amZug = ROT;            // Rot beginnt
    this.zuege = [];             // Zugliste: { farbe, row, col, tausch }
    this.gewinner = null;        // 'red' | 'blue' | null
    this.gewinnPfad = null;      // Felder der Gewinnkette (nur bei grund 'connect')
    this.grund = null;           // 'connect' | 'resign' | 'timeout' | 'disconnect'
    this.swapRegel = swapRegel;
    // Schachuhr: Restzeit pro Farbe (null = ohne Zeitlimit)
    this.zeitkonto = zeitMs ? { [ROT]: zeitMs, [BLAU]: zeitMs } : null;
    this.zugBeginn = jetzt;      // seit wann denkt der Spieler am Zug nach?
  }

  get beendet() {
    return this.gewinner !== null;
  }

  // Wie viele Steine hat jede Farbe auf dem Brett?
  steine() {
    const anzahl = { [ROT]: 0, [BLAU]: 0 };
    for (const zeile of this.brett) {
      for (const feld of zeile) if (feld) anzahl[feld]++;
    }
    return anzahl;
  }

  // Prüft einen Zug, ohne ihn auszuführen.
  // Rückgabe: null, wenn der Zug erlaubt ist – sonst der Grund als Text.
  pruefeZug(farbe, row, col) {
    if (this.beendet) return 'Das Spiel ist bereits beendet.';
    if (farbe !== this.amZug) return 'Du bist nicht am Zug.';
    if (!istAufBrett(row, col)) return 'Dieses Feld gibt es nicht.';
    if (this.brett[row][col] !== null) return 'Das Feld ist bereits belegt.';
    return null;
  }

  // Setzt einen Stein. Rückgabe: { ok: true } oder { ok: false, grund }
  setzeStein(farbe, row, col, jetzt = Date.now()) {
    if (this.pruefeZeit(jetzt)) return { ok: false, grund: 'Die Zeit ist abgelaufen.' };
    const fehler = this.pruefeZug(farbe, row, col);
    if (fehler) return { ok: false, grund: fehler };

    this.bucheZeit(jetzt);
    this.brett[row][col] = farbe;
    this.zuege.push({ farbe, row, col, tausch: false });

    // Nach jedem Zug: Hat dieser Stein die beiden Ränder verbunden?
    const pfad = findeGewinnPfad(this.brett, farbe);
    if (pfad) {
      this.gewinner = farbe;
      this.gewinnPfad = pfad;
      this.grund = 'connect';
    } else {
      this.amZug = gegnerVon(farbe);
    }
    return { ok: true };
  }

  // Swap-Regel: Nur Blau, nur direkt nach dem allerersten Zug von Rot.
  swapMoeglich() {
    return this.swapRegel && !this.beendet && this.zuege.length === 1 && this.amZug === BLAU;
  }

  // Blau übernimmt den roten Eröffnungsstein – gespiegelt und in Blau.
  // Das zählt als Zug von Blau, danach ist wieder Rot dran.
  tausche(farbe, jetzt = Date.now()) {
    if (this.pruefeZeit(jetzt)) return { ok: false, grund: 'Die Zeit ist abgelaufen.' };
    if (farbe !== BLAU || !this.swapMoeglich()) {
      return { ok: false, grund: 'Tauschen ist jetzt nicht erlaubt.' };
    }
    this.bucheZeit(jetzt);
    const erster = this.zuege[0];
    const ziel = spiegeln(erster.row, erster.col);
    this.brett[erster.row][erster.col] = null;
    this.brett[ziel.row][ziel.col] = BLAU;
    this.zuege.push({ farbe: BLAU, row: ziel.row, col: ziel.col, tausch: true });
    this.amZug = ROT;
    return { ok: true };
  }

  // Aufgeben oder Verlassen: Der andere Spieler gewinnt sofort.
  beendeDurch(verlierer, grund, jetzt = Date.now()) {
    if (this.beendet) return false;
    this.bucheZeit(jetzt);
    this.gewinner = gegnerVon(verlierer);
    this.grund = grund;
    return true;
  }

  // ---- Schachuhr ----

  // Restzeit einer Farbe in Millisekunden. Die Uhr läuft nur für den Spieler am Zug.
  restzeit(farbe, jetzt = Date.now()) {
    if (!this.zeitkonto) return null;
    let rest = this.zeitkonto[farbe];
    if (!this.beendet && farbe === this.amZug) rest -= jetzt - this.zugBeginn;
    return Math.max(0, rest);
  }

  // Verbrauchte Bedenkzeit vom Konto des Spielers am Zug abziehen
  // und die Uhr für den nächsten Zug neu starten.
  bucheZeit(jetzt) {
    if (this.zeitkonto && !this.beendet) {
      this.zeitkonto[this.amZug] = this.restzeit(this.amZug, jetzt);
    }
    this.zugBeginn = jetzt;
  }

  // Ist die Zeit des Spielers am Zug abgelaufen? Dann gewinnt der Gegner.
  // Rückgabe: true, wenn das Spiel genau durch diesen Aufruf endet.
  pruefeZeit(jetzt = Date.now()) {
    if (!this.zeitkonto || this.beendet) return false;
    if (this.restzeit(this.amZug, jetzt) > 0) return false;
    this.zeitkonto[this.amZug] = 0;
    this.gewinner = gegnerVon(this.amZug);
    this.grund = 'timeout';
    return true;
  }
}

module.exports = {
  GROESSE, ROT, BLAU, RICHTUNGEN,
  erstelleBrett, istAufBrett, nachbarn, gegnerVon, spiegeln, findeGewinnPfad,
  HexSpiel,
};
