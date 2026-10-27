// Server-Tests: echte Socket.io-Verbindungen gegen einen Test-Server
const { starteTestServer, TestClient, pause, warteBis } = require('./helfer');

let server;
let clients;

beforeEach(async () => {
  server = await starteTestServer();
  clients = [];
});

afterEach(async () => {
  clients.forEach(c => c.trennen());
  // Kein Handler darf einen Fehler geworfen haben
  expect(server.diagnose().fehler).toBe(0);
  await server.stoppe();
});

async function neuerClient() {
  const client = new TestClient(server.url);
  clients.push(client);
  await client.verbunden();
  return client;
}

async function anmelden(name) {
  const client = await neuerClient();
  client.emit('join', { name });
  await client.warteAuf('joined');
  return client;
}

// Zwei Spieler anmelden, nacheinander in die Warteschlange stellen → Spiel startet
async function spielStarten(nameA = 'Anna', nameB = 'Ben') {
  const a = await anmelden(nameA);
  const b = await anmelden(nameB);
  a.emit('queue');
  await a.warteAuf('waiting');
  b.emit('queue');
  const [startA, startB] = await Promise.all([a.warteAuf('gameStart'), b.warteAuf('gameStart')]);
  const [zustandA] = await Promise.all([a.warteAuf('state'), b.warteAuf('state')]);
  const rot = startA.color === 'red' ? a : b;
  const blau = rot === a ? b : a;
  return { a, b, startA, startB, zustandA, rot, blau };
}

// Zug senden und warten, bis BEIDE Spieler den neuen Zustand bekommen haben
async function zug(amZug, gegner, row, col) {
  amZug.emit('move', { row, col });
  const [zustand] = await Promise.all([amZug.warteAuf('state'), gegner.warteAuf('state')]);
  return zustand;
}

describe('Anmelden', () => {
  test('gültiger Name wird getrimmt angenommen', async () => {
    const client = await neuerClient();
    client.emit('join', { name: '   Milo  ' });
    expect(await client.warteAuf('joined')).toEqual({ name: 'Milo' });
    expect(server.diagnose().spieler).toBe(1);
  });

  test('ungültige Namen werden abgelehnt', async () => {
    const client = await neuerClient();
    const kaputt = [{ name: '' }, { name: '    ' }, { name: 'x'.repeat(21) }, { name: 42 },
      { name: null }, {}, null, 'Milo', [1, 2], { name: '\u0000\u0007' }];
    for (const daten of kaputt) {
      client.emit('join', daten);
      await client.warteAuf('joinError');
    }
    expect(server.diagnose().spieler).toBe(0);
  });

  test('doppeltes join wird ignoriert', async () => {
    const client = await anmelden('Milo');
    client.emit('join', { name: 'Nico' });
    await pause(100);
    expect(client.hat('joined')).toBe(false);
    expect(server.diagnose().spieler).toBe(1);
  });
});

describe('Warteschlange und Matching', () => {
  test('zwei Spieler werden gematcht, Farben verschieden, Rot beginnt', async () => {
    const { startA, startB, zustandA } = await spielStarten('Anna', 'Ben');
    expect([startA.color, startB.color].sort()).toEqual(['blue', 'red']);
    expect(startA.gameId).toBe(startB.gameId);
    expect(startA.opponent).toBe('Ben');
    expect(startB.opponent).toBe('Anna');
    expect(startA.you).toBe('Anna');
    expect(startA.players[startA.color]).toBe('Anna');
    expect(zustandA.turn).toBe('red');
    expect(zustandA.moves).toEqual([]);
    expect(zustandA.board.flat().every(feld => feld === null)).toBe(true);
  });

  test('FIFO: die ersten beiden spielen, der dritte wartet', async () => {
    const a = await anmelden('A');
    const b = await anmelden('B');
    const c = await anmelden('C');
    for (const client of [a, b, c]) {
      client.emit('queue');
      await client.warteAuf('waiting');
    }
    await Promise.all([a.warteAuf('gameStart'), b.warteAuf('gameStart')]);
    await pause(50);
    expect(c.hat('gameStart')).toBe(false);
    expect(server.diagnose().warteschlange).toBe(1);

    const d = await anmelden('D');
    d.emit('queue');
    const [startC, startD] = await Promise.all([c.warteAuf('gameStart'), d.warteAuf('gameStart')]);
    expect(startC.opponent).toBe('D');
    expect(startD.opponent).toBe('C');
  });

  test('Abbrechen entfernt aus der Warteschlange', async () => {
    const a = await anmelden('A');
    a.emit('queue');
    await a.warteAuf('waiting');
    a.emit('cancel');
    await a.warteAuf('cancelled');
    expect(server.diagnose().warteschlange).toBe(0);

    const b = await anmelden('B');
    const c = await anmelden('C');
    b.emit('queue');
    c.emit('queue');
    await Promise.all([b.warteAuf('gameStart'), c.warteAuf('gameStart')]);
    expect(a.hat('gameStart')).toBe(false);
  });

  test('parallele Spiele beeinflussen sich nicht', async () => {
    const spiel1 = await spielStarten('A1', 'B1');
    const spiel2 = await spielStarten('A2', 'B2');
    expect(spiel1.startA.gameId).not.toBe(spiel2.startA.gameId);

    await zug(spiel1.rot, spiel1.blau, 3, 3);
    await pause(50);
    expect(spiel2.rot.hat('state')).toBe(false);
    expect(spiel2.blau.hat('state')).toBe(false);

    const zustand = await zug(spiel2.rot, spiel2.blau, 7, 7);
    expect(zustand.board[3][3]).toBeNull();
    expect(zustand.board[7][7]).toBe('red');
  });
});

describe('Züge', () => {
  test('gültiger Zug geht als state an beide Spieler', async () => {
    const { rot, blau } = await spielStarten();
    const zustand = await zug(rot, blau, 4, 3);
    expect(zustand.board[4][3]).toBe('red');
    expect(zustand.turn).toBe('blue');
    expect(zustand.moves).toEqual([{ color: 'red', row: 4, col: 3, swap: false }]);
  });

  test('ungültige Züge: invalid nur an den Absender, Brett unverändert', async () => {
    const { rot, blau } = await spielStarten();

    blau.emit('move', { row: 0, col: 0 });
    expect((await blau.warteAuf('invalid')).reason).toMatch(/nicht am Zug/);

    await zug(rot, blau, 5, 5);
    blau.emit('move', { row: 5, col: 5 });
    expect((await blau.warteAuf('invalid')).reason).toMatch(/belegt/);

    const kaputt = [null, 'x', 5, [], { row: '1', col: 1 }, { row: 1.5, col: 1 }, { row: -1, col: 0 },
      { row: 0, col: 11 }, { row: 1 }, { col: 1 }, { row: 1e9, col: 1 }, { row: NaN, col: 2 }];
    for (const daten of kaputt) {
      blau.emit('move', daten);
      await blau.warteAuf('invalid');
    }
    await pause(50);
    expect(rot.hat('invalid')).toBe(false);
    expect(rot.hat('state')).toBe(false);

    // Danach geht es ganz normal weiter
    const zustand = await zug(blau, rot, 0, 0);
    expect(zustand.moves).toHaveLength(2);
  });

  test('Sieg: gameOver mit Gewinnpfad an beide, danach ist alles aufgeräumt', async () => {
    const { rot, blau } = await spielStarten();
    for (let r = 0; r < 11; r++) {
      await zug(rot, blau, r, 0);
      if (r < 10) await zug(blau, rot, r, 5);
    }
    const [endeRot, endeBlau] = await Promise.all([rot.warteAuf('gameOver'), blau.warteAuf('gameOver')]);
    expect(endeRot).toEqual(endeBlau);
    expect(endeRot.winner).toBe('red');
    expect(endeRot.reason).toBe('connect');
    expect(endeRot.moveCount).toBe(21);
    expect(endeRot.path).toHaveLength(11);
    expect(endeRot.path[0]).toEqual({ row: 0, col: 0 });
    expect(endeRot.path[10]).toEqual({ row: 10, col: 0 });

    const diagnose = server.diagnose();
    expect(diagnose.partien).toBe(0);
    expect(diagnose.raeume).toBe(0);

    // Brett ist gesperrt: weitere Züge werden ignoriert
    rot.emit('move', { row: 9, col: 9 });
    await pause(50);
    expect(rot.hat('state')).toBe(false);
    expect(rot.hat('invalid')).toBe(false);
  });

  test('Rate-Limit: höchstens 20 Ereignisse pro Sekunde werden verarbeitet', async () => {
    const { blau } = await spielStarten();
    await pause(1100); // neues Zeitfenster
    for (let i = 0; i < 60; i++) blau.emit('move', { row: 0, col: 0 });
    await pause(300);
    const antworten = blau.alle('invalid').length;
    expect(antworten).toBeGreaterThan(0);
    expect(antworten).toBeLessThanOrEqual(20);
  });
});

describe('Spielende durch Aufgeben oder Verlassen', () => {
  test('Aufgeben: der Gegner gewinnt', async () => {
    const { rot, blau } = await spielStarten();
    await zug(rot, blau, 2, 2);
    rot.emit('resign');
    const [endeRot, endeBlau] = await Promise.all([rot.warteAuf('gameOver'), blau.warteAuf('gameOver')]);
    expect(endeRot.winner).toBe('blue');
    expect(endeRot.reason).toBe('resign');
    expect(endeRot.path).toBeNull();
    expect(endeBlau.winner).toBe('blue');
  });

  test('Verbindungsabbruch: der verbleibende Spieler gewinnt, Server räumt auf', async () => {
    const { rot, blau } = await spielStarten();
    blau.trennen();
    const ende = await rot.warteAuf('gameOver');
    expect(ende.winner).toBe('red');
    expect(ende.reason).toBe('disconnect');
    await warteBis(() => server.diagnose().spieler === 1);
    expect(server.diagnose()).toMatchObject({ partien: 0, raeume: 0, warteschlange: 0 });
  });

  test('Abmelden im Spiel zählt als Verlassen', async () => {
    const { rot, blau } = await spielStarten();
    rot.emit('logout');
    await rot.warteAuf('loggedOut');
    const ende = await blau.warteAuf('gameOver');
    expect(ende.winner).toBe('blue');
    expect(ende.reason).toBe('disconnect');
  });

  test('nach dem Spiel: "Nochmal spielen" führt wieder in die Warteschlange', async () => {
    const { rot, blau } = await spielStarten();
    rot.emit('resign');
    await Promise.all([rot.warteAuf('gameOver'), blau.warteAuf('gameOver')]);
    rot.emit('queue');
    blau.emit('queue');
    const [s1, s2] = await Promise.all([rot.warteAuf('gameStart'), blau.warteAuf('gameStart')]);
    expect(s1.gameId).toBe(s2.gameId);
  });
});

describe('Robustheit', () => {
  test('Ereignisse im falschen Zustand werden ignoriert', async () => {
    const gast = await neuerClient();
    for (const ereignis of ['queue', 'cancel', 'move', 'resign', 'logout']) gast.emit(ereignis, { row: 0, col: 0 });

    const client = await anmelden('Milo');
    client.emit('move', { row: 0, col: 0 });  // nicht im Spiel
    client.emit('cancel');                    // wartet nicht
    client.emit('resign');                    // spielt nicht
    client.emit('queue');
    client.emit('queue');                     // doppelt
    await pause(100);
    expect(client.alle('waiting')).toHaveLength(1);
    expect(client.hat('invalid')).toBe(false);
    expect(gast.eingang).toEqual([]);
    expect(server.diagnose().warteschlange).toBe(1);
  });

  test('kaputte Daten und unbekannte Ereignisse bringen den Server nicht zum Absturz', async () => {
    const boese = await anmelden('Mallory');
    const werte = [undefined, null, 0, -1, 'text', '', [], {}, { row: {}, col: [] },
      { __proto__: { row: 1 } }, { name: { toString: 1 } }, 'x'.repeat(5000)];
    for (const ereignis of ['join', 'queue', 'cancel', 'move', 'resign', 'gibtEsNicht', 'constructor', '__proto__']) {
      for (const wert of werte) boese.emit(ereignis, wert);
      await pause(1050); // Rate-Limit nicht auslösen, damit wirklich alles ankommt
    }
    // Eine riesige Nachricht trennt nur diesen einen Client
    const riese = await neuerClient();
    riese.emit('join', { name: 'x'.repeat(100000) });
    await warteBis(() => !riese.socket.connected, 3000);

    // Der Server funktioniert weiterhin
    const { rot, blau } = await spielStarten();
    const zustand = await zug(rot, blau, 1, 1);
    expect(zustand.board[1][1]).toBe('red');
  }, 20000);

  test('nach dem Trennen aller Clients ist der Speicher leer', async () => {
    const { rot, blau } = await spielStarten();
    await zug(rot, blau, 1, 1);
    const wartend = await anmelden('Wartend');
    wartend.emit('queue');
    await wartend.warteAuf('waiting');
    clients.forEach(c => c.trennen());
    await warteBis(() => server.diagnose().spieler === 0);
    expect(server.diagnose()).toEqual({
      spieler: 0, warteschlange: 0, partien: 0, raeume: 0, timer: 0, fehler: 0,
    });
  });
});
