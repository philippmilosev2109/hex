// Tests für die reine Spiellogik (game.js)
const {
  GROESSE, ROT, BLAU,
  erstelleBrett, istAufBrett, nachbarn, gegnerVon, spiegeln, findeGewinnPfad,
  HexSpiel,
} = require('../game');

// Brett aus einem Text-Bild bauen: 'R' = Rot, 'B' = Blau, '.' = frei.
// Leerzeichen werden ignoriert – so kann man die Rautenform einrücken.
function brettAus(zeilen) {
  const brett = erstelleBrett();
  zeilen.forEach((zeile, r) => {
    [...zeile.replace(/\s/g, '')].forEach((zeichen, c) => {
      if (zeichen === 'R') brett[r][c] = ROT;
      if (zeichen === 'B') brett[r][c] = BLAU;
    });
  });
  return brett;
}

// Prüft, dass ein Gewinnpfad wirklich gültig ist:
// lückenlos benachbart, nur eigene Steine, berührt beide Ränder der Farbe.
function erwarteGueltigenPfad(brett, pfad, farbe) {
  expect(pfad).not.toBeNull();
  const n = brett.length;
  const erstes = pfad[0];
  const letztes = pfad[pfad.length - 1];
  if (farbe === ROT) {
    expect(erstes.row).toBe(0);
    expect(letztes.row).toBe(n - 1);
  } else {
    expect(erstes.col).toBe(0);
    expect(letztes.col).toBe(n - 1);
  }
  pfad.forEach((feld, i) => {
    expect(brett[feld.row][feld.col]).toBe(farbe);
    if (i > 0) {
      const vorher = pfad[i - 1];
      const benachbart = nachbarn(vorher.row, vorher.col)
        .some(([r, c]) => r === feld.row && c === feld.col);
      expect(benachbart).toBe(true);
    }
  });
}

// Spielt eine Liste von Zügen abwechselnd (Rot beginnt)
function spieleZuege(spiel, zuege) {
  zuege.forEach(([row, col]) => {
    const ergebnis = spiel.setzeStein(spiel.amZug, row, col);
    expect(ergebnis).toEqual({ ok: true });
  });
}

describe('Brett und Nachbarn', () => {
  test('neues Brett ist 11×11 und leer', () => {
    const brett = erstelleBrett();
    expect(brett).toHaveLength(GROESSE);
    brett.forEach(zeile => {
      expect(zeile).toHaveLength(GROESSE);
      zeile.forEach(feld => expect(feld).toBeNull());
    });
  });

  test('istAufBrett akzeptiert nur ganze Zahlen von 0 bis 10', () => {
    expect(istAufBrett(0, 0)).toBe(true);
    expect(istAufBrett(10, 10)).toBe(true);
    expect(istAufBrett(-1, 0)).toBe(false);
    expect(istAufBrett(0, 11)).toBe(false);
    expect(istAufBrett(1.5, 2)).toBe(false);
    expect(istAufBrett('3', 4)).toBe(false);
    expect(istAufBrett(null, 4)).toBe(false);
    expect(istAufBrett(NaN, 4)).toBe(false);
    expect(istAufBrett(Infinity, 4)).toBe(false);
  });

  test('ein Feld in der Mitte hat genau 6 Nachbarn', () => {
    const liste = nachbarn(5, 5);
    expect(liste).toHaveLength(6);
    expect(liste).toEqual(expect.arrayContaining([
      [5, 4], [5, 6], [4, 5], [4, 6], [6, 4], [6, 5],
    ]));
  });

  test('Ecken und Ränder haben weniger Nachbarn', () => {
    expect(nachbarn(0, 0)).toHaveLength(2);    // spitze Ecke oben links
    expect(nachbarn(10, 10)).toHaveLength(2);  // spitze Ecke unten rechts
    expect(nachbarn(0, 10)).toHaveLength(3);   // stumpfe Ecke oben rechts
    expect(nachbarn(10, 0)).toHaveLength(3);   // stumpfe Ecke unten links
    expect(nachbarn(0, 5)).toHaveLength(4);    // oberer Rand
    expect(nachbarn(5, 0)).toHaveLength(4);    // linker Rand
  });

  test('Nachbarn passen zur Geometrie des gezeichneten Bretts', () => {
    // Gleiche Formel wie im Browser (board.js): Zeile r ist um r/2 Feldbreiten verschoben.
    const R = 24;
    const BREITE = Math.sqrt(3) * R;
    const mitte = (r, c) => ({ x: BREITE * (c + r / 2), y: 1.5 * R * r });

    for (let r = 0; r < GROESSE; r++) {
      for (let c = 0; c < GROESSE; c++) {
        // Geometrische Nachbarn: Mittelpunkte genau eine Feldbreite entfernt
        const geometrisch = [];
        for (let r2 = 0; r2 < GROESSE; r2++) {
          for (let c2 = 0; c2 < GROESSE; c2++) {
            const a = mitte(r, c);
            const b = mitte(r2, c2);
            const abstand = Math.hypot(a.x - b.x, a.y - b.y);
            if (Math.abs(abstand - BREITE) < 0.01) geometrisch.push([r2, c2]);
          }
        }
        expect(nachbarn(r, c).sort()).toEqual(geometrisch.sort());
      }
    }
  });

  test('gegnerVon und spiegeln', () => {
    expect(gegnerVon(ROT)).toBe(BLAU);
    expect(gegnerVon(BLAU)).toBe(ROT);
    expect(spiegeln(2, 7)).toEqual({ row: 7, col: 2 });
  });
});

describe('Sieg-Erkennung (BFS)', () => {
  test('Rot gewinnt mit einer geraden Kette von oben nach unten', () => {
    const brett = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) brett[r][5] = ROT;
    const pfad = findeGewinnPfad(brett, ROT);
    erwarteGueltigenPfad(brett, pfad, ROT);
    expect(pfad).toHaveLength(11);
    expect(findeGewinnPfad(brett, BLAU)).toBeNull();
  });

  test('Blau gewinnt mit einer Kette von links nach rechts', () => {
    const brett = erstelleBrett();
    for (let c = 0; c < GROESSE; c++) brett[6][c] = BLAU;
    const pfad = findeGewinnPfad(brett, BLAU);
    erwarteGueltigenPfad(brett, pfad, BLAU);
    expect(pfad).toHaveLength(11);
    expect(findeGewinnPfad(brett, ROT)).toBeNull();
  });

  test('eine einzige Lücke bedeutet: kein Sieg', () => {
    const brett = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) if (r !== 7) brett[r][3] = ROT;
    expect(findeGewinnPfad(brett, ROT)).toBeNull();
    brett[7][3] = BLAU; // Lücke vom Gegner besetzt
    expect(findeGewinnPfad(brett, ROT)).toBeNull();
    brett[7][3] = ROT;  // Lücke geschlossen
    erwarteGueltigenPfad(brett, findeGewinnPfad(brett, ROT), ROT);
  });

  test('Steine nur an einem Rand reichen nicht', () => {
    const brett = erstelleBrett();
    for (let c = 0; c < GROESSE; c++) brett[0][c] = ROT; // ganze obere Zeile rot
    expect(findeGewinnPfad(brett, ROT)).toBeNull();
  });

  test('Kette entlang des Brettrands zählt (Ecken und Ränder)', () => {
    const rot = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) rot[r][0] = ROT;          // linke Spalte
    erwarteGueltigenPfad(rot, findeGewinnPfad(rot, ROT), ROT);

    const blau = erstelleBrett();
    for (let c = 0; c < GROESSE; c++) blau[10][c] = BLAU;       // unterste Zeile
    erwarteGueltigenPfad(blau, findeGewinnPfad(blau, BLAU), BLAU);
  });

  test('kurze Diagonale verbindet, lange Diagonale nicht', () => {
    // (0,10) → (10,0): jeweils Nachbarn "unten links" → lückenlos
    const kurz = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) kurz[r][10 - r] = ROT;
    erwarteGueltigenPfad(kurz, findeGewinnPfad(kurz, ROT), ROT);

    // (0,0) → (10,10): diese Felder berühren sich im Sechseckgitter NICHT
    const lang = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) lang[r][r] = ROT;
    expect(findeGewinnPfad(lang, ROT)).toBeNull();
  });

  test('Zickzack-Pfad, der zwischendurch nach oben läuft', () => {
    const brett = brettAus([
      '. . . . . . . . R . .',
      '. . . . . . . . R . .',
      '. . R R R . . . R . .',
      '. . R . R . . . R . .',
      '. . R . R R R R R . .',
      '. . R . . . . . . . .',
      '. . R . . . . . . . .',
      '. . R . . . . . . . .',
      '. . R . . . . . . . .',
      '. . R . . . . . . . .',
      '. . R . . . . . . . .',
    ]);
    const pfad = findeGewinnPfad(brett, ROT);
    erwarteGueltigenPfad(brett, pfad, ROT);
    // Der Pfad muss zwischendurch "rückwärts" (nach oben) gehen
    const gehtNachOben = pfad.some((feld, i) => i > 0 && feld.row < pfad[i - 1].row);
    expect(gehtNachOben).toBe(true);
  });

  test('Blau im Zickzack gegen rote Mauer', () => {
    const brett = brettAus([
      'B . . . . . . . . . .',
      'B B B B R . . . . . .',
      '. . . B R . . . . . .',
      '. . . B R B B B B B B',
      '. . . B R B . . . . .',
      '. . . B B B . . . . .',
      '. . . . R . . . . . .',
      '. . . . . . . . . . .',
      '. . . . . . . . . . .',
      '. . . . . . . . . . .',
      '. . . . . . . . . . .',
    ]);
    erwarteGueltigenPfad(brett, findeGewinnPfad(brett, BLAU), BLAU);
    expect(findeGewinnPfad(brett, ROT)).toBeNull();
  });

  test('Gewinnpfad ist die kürzeste Kette (keine Umwege)', () => {
    const brett = erstelleBrett();
    for (let r = 0; r < GROESSE; r++) brett[r][5] = ROT;       // gerade Kette
    for (let c = 0; c < 5; c++) brett[4][c] = ROT;             // Seitenarm (Sackgasse)
    for (let r = 0; r < GROESSE; r++) brett[r][0] = ROT;       // zweite, gleich lange Kette
    const pfad = findeGewinnPfad(brett, ROT);
    erwarteGueltigenPfad(brett, pfad, ROT);
    expect(pfad).toHaveLength(11);
  });

  test('volles Brett: immer genau ein Sieger (kein Remis)', () => {
    // Zufällig gefüllte Bretter – das funktioniert nur mit den richtigen 6 Nachbarn
    for (let runde = 0; runde < 200; runde++) {
      const brett = erstelleBrett().map(zeile => zeile.map(() => (Math.random() < 0.5 ? ROT : BLAU)));
      const rotGewinnt = findeGewinnPfad(brett, ROT) !== null;
      const blauGewinnt = findeGewinnPfad(brett, BLAU) !== null;
      expect(rotGewinnt).not.toBe(blauGewinnt);
    }
  });
});

describe('Züge im Spiel', () => {
  test('Rot beginnt, danach wird abgewechselt', () => {
    const spiel = new HexSpiel();
    expect(spiel.amZug).toBe(ROT);
    expect(spiel.setzeStein(ROT, 5, 5)).toEqual({ ok: true });
    expect(spiel.amZug).toBe(BLAU);
    expect(spiel.brett[5][5]).toBe(ROT);
    expect(spiel.setzeStein(BLAU, 4, 4)).toEqual({ ok: true });
    expect(spiel.amZug).toBe(ROT);
    expect(spiel.zuege).toHaveLength(2);
    expect(spiel.steine()).toEqual({ red: 1, blue: 1 });
  });

  test('ungültige Züge werden abgelehnt und ändern nichts', () => {
    const spiel = new HexSpiel();
    expect(spiel.setzeStein(BLAU, 0, 0).ok).toBe(false);          // nicht am Zug
    spiel.setzeStein(ROT, 3, 3);
    expect(spiel.setzeStein(BLAU, 3, 3)).toEqual({ ok: false, grund: 'Das Feld ist bereits belegt.' });
    for (const [r, c] of [[-1, 0], [0, 11], [11, 11], [1.5, 2], ['3', 3], [null, 1], [undefined, 2], [NaN, 0]]) {
      expect(spiel.setzeStein(BLAU, r, c).ok).toBe(false);
    }
    expect(spiel.zuege).toHaveLength(1);
    expect(spiel.amZug).toBe(BLAU);
  });

  test('nach dem Sieg ist kein Zug mehr möglich', () => {
    const spiel = new HexSpiel();
    // Rot spielt Spalte 0 von oben nach unten, Blau spielt Spalte 5
    for (let r = 0; r < GROESSE; r++) {
      spiel.setzeStein(ROT, r, 0);
      if (!spiel.beendet) spiel.setzeStein(BLAU, r, 5);
    }
    expect(spiel.gewinner).toBe(ROT);
    expect(spiel.grund).toBe('connect');
    expect(spiel.zuege).toHaveLength(21);   // 11 rote + 10 blaue Steine
    erwarteGueltigenPfad(spiel.brett, spiel.gewinnPfad, ROT);
    expect(spiel.setzeStein(BLAU, 10, 10).ok).toBe(false);
  });

  test('Blau kann gewinnen', () => {
    const spiel = new HexSpiel();
    const zuege = [];
    for (let i = 0; i < GROESSE; i++) zuege.push([10, i], [0, i]); // Rot unten, Blau oben
    spieleZuege(spiel, zuege.slice(0, 21));
    expect(spiel.beendet).toBe(false);
    spiel.setzeStein(BLAU, 0, 10);
    expect(spiel.gewinner).toBe(BLAU);
    erwarteGueltigenPfad(spiel.brett, spiel.gewinnPfad, BLAU);
  });

  test('Aufgeben: der Gegner gewinnt sofort', () => {
    const spiel = new HexSpiel();
    spiel.setzeStein(ROT, 5, 5);
    expect(spiel.beendeDurch(ROT, 'resign')).toBe(true);
    expect(spiel.gewinner).toBe(BLAU);
    expect(spiel.grund).toBe('resign');
    expect(spiel.gewinnPfad).toBeNull();
    expect(spiel.beendeDurch(BLAU, 'resign')).toBe(false); // nur einmal möglich
    expect(spiel.gewinner).toBe(BLAU);
  });
});

describe('Swap-Regel', () => {
  test('Blau darf direkt nach dem ersten roten Zug tauschen', () => {
    const spiel = new HexSpiel();
    expect(spiel.swapMoeglich()).toBe(false);       // vor dem ersten Zug
    spiel.setzeStein(ROT, 2, 7);
    expect(spiel.swapMoeglich()).toBe(true);
    expect(spiel.tausche(BLAU)).toEqual({ ok: true });
    // Roter Stein auf (2,7) wird zu blauem Stein auf (7,2)
    expect(spiel.brett[2][7]).toBeNull();
    expect(spiel.brett[7][2]).toBe(BLAU);
    expect(spiel.steine()).toEqual({ red: 0, blue: 1 });
    expect(spiel.amZug).toBe(ROT);
    expect(spiel.zuege[1]).toEqual({ farbe: BLAU, row: 7, col: 2, tausch: true });
    expect(spiel.swapMoeglich()).toBe(false);       // nur einmal
  });

  test('Stein auf der langen Diagonale bleibt auf seinem Feld', () => {
    const spiel = new HexSpiel();
    spiel.setzeStein(ROT, 5, 5);
    spiel.tausche(BLAU);
    expect(spiel.brett[5][5]).toBe(BLAU);
  });

  test('Tauschen ist sonst nicht erlaubt', () => {
    const spiel = new HexSpiel();
    expect(spiel.tausche(BLAU).ok).toBe(false);     // noch kein roter Zug
    spiel.setzeStein(ROT, 1, 1);
    expect(spiel.tausche(ROT).ok).toBe(false);      // Rot darf nicht tauschen
    spiel.setzeStein(BLAU, 2, 2);
    expect(spiel.tausche(BLAU).ok).toBe(false);     // zu spät
    expect(spiel.brett[1][1]).toBe(ROT);

    const ohne = new HexSpiel({ swapRegel: false });
    ohne.setzeStein(ROT, 1, 1);
    expect(ohne.swapMoeglich()).toBe(false);
    expect(ohne.tausche(BLAU).ok).toBe(false);
  });

  test('nach dem Tausch kann normal weitergespielt werden', () => {
    const spiel = new HexSpiel();
    spiel.setzeStein(ROT, 0, 3);
    spiel.tausche(BLAU);                            // Blau auf (3,0)
    expect(spiel.setzeStein(ROT, 3, 0).ok).toBe(false); // belegt
    expect(spiel.setzeStein(ROT, 0, 3).ok).toBe(true);  // altes Feld ist wieder frei
  });
});

describe('Schachuhr (Zeitkonto)', () => {
  test('die Uhr läuft nur für den Spieler am Zug', () => {
    const spiel = new HexSpiel({ zeitMs: 60000, jetzt: 0 });
    expect(spiel.restzeit(ROT, 10000)).toBe(50000);
    expect(spiel.restzeit(BLAU, 10000)).toBe(60000);

    spiel.setzeStein(ROT, 0, 0, 10000);             // Rot hat 10 s verbraucht
    expect(spiel.restzeit(ROT, 25000)).toBe(50000); // Rots Uhr steht jetzt
    expect(spiel.restzeit(BLAU, 25000)).toBe(45000);

    spiel.setzeStein(BLAU, 1, 1, 30000);            // Blau hat 20 s verbraucht
    expect(spiel.restzeit(BLAU, 99999)).toBe(40000);
    expect(spiel.restzeit(ROT, 31000)).toBe(49000);
  });

  test('Zeit abgelaufen: der Gegner gewinnt (timeout)', () => {
    const spiel = new HexSpiel({ zeitMs: 60000, jetzt: 0 });
    spiel.setzeStein(ROT, 0, 0, 10000);
    expect(spiel.pruefeZeit(69999)).toBe(false);    // Blau hat noch 1 ms
    expect(spiel.pruefeZeit(70000)).toBe(true);
    expect(spiel.gewinner).toBe(ROT);
    expect(spiel.grund).toBe('timeout');
    expect(spiel.restzeit(BLAU, 80000)).toBe(0);
    expect(spiel.pruefeZeit(90000)).toBe(false);    // schon beendet
  });

  test('ein Zug nach Ablauf der Zeit wird abgelehnt', () => {
    const spiel = new HexSpiel({ zeitMs: 5000, jetzt: 0 });
    const ergebnis = spiel.setzeStein(ROT, 5, 5, 6000);
    expect(ergebnis.ok).toBe(false);
    expect(spiel.brett[5][5]).toBeNull();
    expect(spiel.gewinner).toBe(BLAU);
    expect(spiel.grund).toBe('timeout');
  });

  test('der Tausch kostet Bedenkzeit von Blau', () => {
    const spiel = new HexSpiel({ zeitMs: 60000, jetzt: 0 });
    spiel.setzeStein(ROT, 2, 3, 1000);
    spiel.tausche(BLAU, 8000);
    expect(spiel.restzeit(BLAU, 8000)).toBe(53000);
    expect(spiel.restzeit(ROT, 9000)).toBe(58000);
  });

  test('nach Spielende bleiben die Uhren stehen', () => {
    const spiel = new HexSpiel({ zeitMs: 60000, jetzt: 0 });
    spiel.setzeStein(ROT, 0, 0, 5000);
    spiel.beendeDurch(BLAU, 'resign', 12000);       // Blau gibt nach 7 s auf
    expect(spiel.restzeit(BLAU, 50000)).toBe(53000);
    expect(spiel.restzeit(ROT, 50000)).toBe(55000);
  });

  test('ohne Zeitlimit gibt es keine Uhr', () => {
    const spiel = new HexSpiel();
    expect(spiel.restzeit(ROT)).toBeNull();
    expect(spiel.pruefeZeit()).toBe(false);
  });
});
