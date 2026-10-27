// ui.js – Kleine Helfer für die Oberfläche: Ansichten wechseln, Meldungen zeigen.
// Benutzertexte (Namen usw.) werden IMMER per textContent eingefügt, nie per innerHTML.

export const $ = selektor => document.querySelector(selektor);

// Zeigt genau eine Ansicht (login, warten, spiel) und versteckt die anderen.
// Der Fokus springt auf die Überschrift – wichtig für Tastatur und Screenreader.
export function zeigeAnsicht(name) {
  for (const ansicht of document.querySelectorAll('.ansicht')) {
    ansicht.hidden = ansicht.id !== `ansicht-${name}`;
  }
  const ueberschrift = document.querySelector(`#ansicht-${name} [data-fokus]`);
  if (ueberschrift) ueberschrift.focus({ preventScroll: true });
}

// Kurze Meldung, die nach ein paar Sekunden von selbst verschwindet
export function meldung(text, art = 'info') {
  const box = document.createElement('div');
  box.className = `meldung meldung-${art}`;
  box.textContent = text;
  $('#meldungen').appendChild(box);
  setTimeout(() => box.remove(), 4000);
}

// Name wie auf dem Server prüfen: getrimmt, 1–20 Zeichen
export function pruefeName(name) {
  const sauber = name.replace(/\s+/g, ' ').trim();
  if (sauber.length < 1) return { ok: false, fehler: 'Bitte gib einen Namen ein.' };
  if (sauber.length > 20) return { ok: false, fehler: 'Der Name darf höchstens 20 Zeichen haben.' };
  return { ok: true, name: sauber };
}

export const FARBNAME = { red: 'Rot', blue: 'Blau' };
export const RICHTUNG = { red: 'oben und unten', blue: 'links und rechts' };
