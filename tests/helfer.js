// Hilfsmittel für die Server-Tests: Test-Server starten und Test-Clients steuern.
const { io: ioClient } = require('socket.io-client');
const { erstelleServer } = require('../server');

// Startet einen Server auf einem freien Port
async function starteTestServer(optionen = {}) {
  const server = erstelleServer(optionen);
  const port = await server.starte(0, '127.0.0.1');
  server.url = `http://127.0.0.1:${port}`;
  return server;
}

// Ein Test-Client merkt sich ALLE empfangenen Ereignisse in einem Eingang.
// warteAuf() nimmt das nächste passende Ereignis heraus – auch wenn es schon
// angekommen ist, bevor der Test danach fragt.
class TestClient {
  constructor(url, optionen = {}) {
    this.socket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...optionen,
    });
    this.eingang = [];
    this.wartende = [];
    this.socket.onAny((ereignis, daten) => {
      const index = this.wartende.findIndex(w => w.ereignis === ereignis);
      if (index !== -1) {
        const [w] = this.wartende.splice(index, 1);
        clearTimeout(w.timer);
        w.resolve(daten);
      } else {
        this.eingang.push({ ereignis, daten });
      }
    });
  }

  verbunden() {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
    });
  }

  emit(ereignis, daten) {
    this.socket.emit(ereignis, daten);
  }

  warteAuf(ereignis, ms = 2000) {
    const index = this.eingang.findIndex(e => e.ereignis === ereignis);
    if (index !== -1) return Promise.resolve(this.eingang.splice(index, 1)[0].daten);
    return new Promise((resolve, reject) => {
      const eintrag = { ereignis, resolve };
      eintrag.timer = setTimeout(() => {
        this.wartende.splice(this.wartende.indexOf(eintrag), 1);
        reject(new Error(`Ereignis "${ereignis}" kam nicht innerhalb von ${ms} ms`));
      }, ms);
      this.wartende.push(eintrag);
    });
  }

  // Wurde ein Ereignis empfangen (und noch nicht abgeholt)?
  hat(ereignis) {
    return this.eingang.some(e => e.ereignis === ereignis);
  }

  // Alle noch nicht abgeholten Ereignisse dieses Namens herausnehmen
  alle(ereignis) {
    const treffer = this.eingang.filter(e => e.ereignis === ereignis).map(e => e.daten);
    this.eingang = this.eingang.filter(e => e.ereignis !== ereignis);
    return treffer;
  }

  trennen() {
    this.socket.disconnect();
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Wartet, bis eine Bedingung erfüllt ist (z. B. Server hat aufgeräumt)
async function warteBis(bedingung, ms = 2000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return;
    await pause(10);
  }
  throw new Error('Bedingung wurde nicht rechtzeitig erfüllt');
}

module.exports = { starteTestServer, TestClient, pause, warteBis };
