// client.js – Browser-Logik für Hex
// Schritt 1: Nur das statische 11×11-Brett zeichnen.
// Folgt später:
// - Klicks als Züge an den Server senden
// - Updates vom Server empfangen und anzeigen

const GROESSE = 11;   // 11×11 Felder
const R = 24;         // Radius eines Sechsecks (Mitte → Ecke)
const BREITE = Math.sqrt(3) * R; // Breite eines Sechsecks (Spitze nach oben)
const RAND = 30;      // Platz um das Brett herum

const SVG_NS = 'http://www.w3.org/2000/svg';

// Mittelpunkt des Feldes in Zeile r, Spalte c.
// Jede Zeile wird um eine halbe Feldbreite nach rechts geschoben,
// dadurch entsteht die Rautenform.
function mittelpunkt(r, c) {
  return {
    x: RAND + BREITE / 2 + BREITE * (c + r / 2),
    y: RAND + R + 1.5 * R * r,
  };
}

// Die 6 Eckpunkte eines Sechsecks mit Mittelpunkt (cx, cy).
// Ecke k liegt im Winkel 30° + k·60° (y zeigt im SVG nach unten):
// k=0 rechts unten, 1 unten, 2 links unten, 3 links oben, 4 oben, 5 rechts oben
function ecken(cx, cy) {
  const punkte = [];
  for (let k = 0; k < 6; k++) {
    const winkel = (Math.PI / 180) * (30 + 60 * k);
    punkte.push({ x: cx + R * Math.cos(winkel), y: cy + R * Math.sin(winkel) });
  }
  return punkte;
}

function alsPunktString(punkte) {
  return punkte.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Hilfsfunktion: SVG-Element mit Attributen erzeugen
function svgElement(name, attribute) {
  const el = document.createElementNS(SVG_NS, name);
  for (const key in attribute) el.setAttribute(key, attribute[key]);
  return el;
}

// Farbige Randlinie entlang der angegebenen Ecken eines Feldes
function randLinie(punkte, eckenNummern, klasse) {
  const liste = eckenNummern.map(k => punkte[k]);
  return svgElement('polyline', { points: alsPunktString(liste), class: klasse });
}

function zeichneBrett() {
  // Größe der Zeichenfläche: Breite + halbe Verschiebung durch die Rautenform
  const breite = RAND * 2 + BREITE * (GROESSE + (GROESSE - 1) / 2);
  const hoehe = RAND * 2 + R * 2 + 1.5 * R * (GROESSE - 1);
  const svg = svgElement('svg', { viewBox: `0 0 ${breite} ${hoehe}`, width: breite, height: hoehe });

  const felder = svgElement('g', {});
  const raender = svgElement('g', {});

  for (let r = 0; r < GROESSE; r++) {
    for (let c = 0; c < GROESSE; c++) {
      const m = mittelpunkt(r, c);
      const p = ecken(m.x, m.y);

      felder.appendChild(svgElement('polygon', {
        points: alsPunktString(p),
        class: 'feld',
        'data-r': r,
        'data-c': c,
      }));

      // Ränder: Rot oben/unten, Blau links/rechts
      if (r === 0)           raender.appendChild(randLinie(p, [3, 4, 5], 'rand-rot'));  // oben
      if (r === GROESSE - 1) raender.appendChild(randLinie(p, [0, 1, 2], 'rand-rot'));  // unten
      if (c === 0)           raender.appendChild(randLinie(p, [2, 3], 'rand-blau'));    // links
      if (c === GROESSE - 1) raender.appendChild(randLinie(p, [5, 0], 'rand-blau'));    // rechts
    }
  }

  svg.appendChild(felder);
  svg.appendChild(raender);
  document.getElementById('brett').appendChild(svg);
}

zeichneBrett();
