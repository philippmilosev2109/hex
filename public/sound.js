// sound.js – Soundeffekte mit der Web Audio API
// Alle Töne werden live erzeugt (Oszillator + Lautstärke-Hüllkurve), es gibt keine Audiodateien.
// Browser erlauben Ton erst nach einer Benutzeraktion – darum wird der
// AudioContext beim ersten Klick bzw. Tastendruck "entsperrt".

const SPEICHER_SCHLUESSEL = 'hex-stumm';

let kontext = null;
let stumm = ladeStumm();

// localStorage kann gesperrt sein (z. B. privater Modus) → immer mit try/catch
function ladeStumm() {
  try {
    return localStorage.getItem(SPEICHER_SCHLUESSEL) === 'ja';
  } catch {
    return false;
  }
}

function speichereStumm() {
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, stumm ? 'ja' : 'nein');
  } catch {
    // Speichern nicht möglich – Einstellung gilt dann nur bis zum Neuladen
  }
}

function entsperren() {
  try {
    const AudioKlasse = window.AudioContext || window.webkitAudioContext;
    if (!kontext && AudioKlasse) kontext = new AudioKlasse();
    if (kontext && kontext.state === 'suspended') kontext.resume();
  } catch {
    kontext = null;
  }
}
document.addEventListener('pointerdown', entsperren);
document.addEventListener('keydown', entsperren);

// Ein einzelner Ton: Frequenz in Hz, Start/Dauer in Sekunden.
// Die Lautstärke steigt kurz an und klingt dann exponentiell aus.
function ton(frequenz, start, dauer, { typ = 'sine', lautstaerke = 0.18, zielFrequenz = null } = {}) {
  if (stumm || !kontext || kontext.state !== 'running') return;
  const t0 = kontext.currentTime + start;
  const oszillator = kontext.createOscillator();
  const huelle = kontext.createGain();
  oszillator.type = typ;
  oszillator.frequency.setValueAtTime(frequenz, t0);
  if (zielFrequenz) oszillator.frequency.exponentialRampToValueAtTime(zielFrequenz, t0 + dauer);
  huelle.gain.setValueAtTime(0.0001, t0);
  huelle.gain.exponentialRampToValueAtTime(lautstaerke, t0 + 0.012);
  huelle.gain.exponentialRampToValueAtTime(0.0001, t0 + dauer);
  oszillator.connect(huelle).connect(kontext.destination);
  oszillator.start(t0);
  oszillator.stop(t0 + dauer + 0.05);
}

export const sound = {
  // Eigener Stein: kurzes, holziges "Tock"
  setzen() {
    ton(620, 0, 0.13, { typ: 'triangle', zielFrequenz: 280, lautstaerke: 0.22 });
  },
  // Gegner hat gezogen: tieferer, weicherer Ton
  gegner() {
    ton(330, 0, 0.16, { typ: 'sine', zielFrequenz: 220, lautstaerke: 0.2 });
  },
  // Sieg: aufsteigender Dur-Akkord
  sieg() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => ton(f, i * 0.11, 0.35, { typ: 'triangle', lautstaerke: 0.16 }));
  },
  // Niederlage: absteigende Moll-Töne
  niederlage() {
    [440, 349.23, 293.66].forEach((f, i) => ton(f, i * 0.18, 0.4, { typ: 'sine', lautstaerke: 0.16 }));
  },
  // Zeit knapp: kurzes, helles Ticken
  zeitKnapp() {
    ton(1320, 0, 0.07, { typ: 'square', lautstaerke: 0.05 });
  },

  istStumm() {
    return stumm;
  },
  setzeStumm(wert) {
    stumm = Boolean(wert);
    speichereStumm();
  },
};
