// board.js – Das Spielbrett als SVG
// Zeichnet die 121 Sechsecke, die farbigen Ränder und die Steine.
// Wichtig: Das Brett setzt NIE selbst einen Stein. Ein Klick wird nur gemeldet,
// gezeichnet wird erst, wenn der Server den Zug bestätigt (neuer "state").

export const GROESSE = 11;          // 11×11 Felder
const R = 24;                       // Radius eines Sechsecks (Mitte → Ecke)
const BREITE = Math.sqrt(3) * R;    // Breite eines Sechsecks (Spitze nach oben)
const RAND = 30;                    // Platz um das Brett herum
const STEIN_RADIUS = R * 0.62;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Mittelpunkt des Feldes in Zeile r, Spalte c.
// Jede Zeile wird um eine halbe Feldbreite nach rechts geschoben,
// dadurch entsteht die Rautenform.
export function mittelpunkt(r, c) {
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
function svgElement(name, attribute = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const key in attribute) el.setAttribute(key, attribute[key]);
  return el;
}

// Die Ecken eines Feldes, die am Brettrand liegen (für die farbigen Ränder)
function randEcken(r, c, eckenNummern) {
  const m = mittelpunkt(r, c);
  const punkte = ecken(m.x, m.y);
  return eckenNummern.map(k => punkte[k]);
}

// Eine durchgehende Zickzack-Linie für eine ganze Brettseite
function randLinie(punkte, klasse) {
  return svgElement('polyline', { points: alsPunktString(punkte), class: klasse });
}

// Glänzender Farbverlauf für die Steine (heller Fleck oben links)
function steinVerlauf(id, hell, mittel, dunkel) {
  const verlauf = svgElement('radialGradient', { id, cx: '35%', cy: '30%', r: '75%' });
  verlauf.appendChild(svgElement('stop', { offset: '0%', 'stop-color': hell }));
  verlauf.appendChild(svgElement('stop', { offset: '45%', 'stop-color': mittel }));
  verlauf.appendChild(svgElement('stop', { offset: '100%', 'stop-color': dunkel }));
  return verlauf;
}

export class Brett {
  // container: HTML-Element, in das das SVG kommt
  // onFeldKlick(row, col): wird bei Klick auf ein freies Feld aufgerufen
  constructor(container, onFeldKlick) {
    this.onFeldKlick = onFeldKlick;
    this.aktiv = false;
    this.felder = [];   // Polygone [r][c]
    this.steine = [];   // Stein-Elemente [r][c] oder null
    this.svg = this.zeichne();
    container.appendChild(this.svg);

    // Ein einziger Klick-Handler für alle Felder (Event-Delegation)
    this.svg.addEventListener('click', event => {
      const feld = event.target.closest('.feld');
      if (!feld || !this.aktiv) return;
      const row = Number(feld.dataset.r);
      const col = Number(feld.dataset.c);
      if (this.steine[row][col]) return;   // belegt – gar nicht erst senden
      this.onFeldKlick(row, col);
    });
  }

  zeichne() {
    // Größe der Zeichenfläche: Breite + halbe Verschiebung durch die Rautenform
    const breite = RAND * 2 + BREITE * (GROESSE + (GROESSE - 1) / 2);
    const hoehe = RAND * 2 + R * 2 + 1.5 * R * (GROESSE - 1);
    const svg = svgElement('svg', {
      viewBox: `0 0 ${breite.toFixed(1)} ${hoehe.toFixed(1)}`,
      role: 'img',
      'aria-label': 'Spielbrett mit 11 mal 11 Feldern. Rot verbindet oben und unten, Blau links und rechts.',
    });

    const defs = svgElement('defs');
    defs.appendChild(steinVerlauf('verlauf-red', '#ff8a96', '#e2001a', '#8c0010'));
    defs.appendChild(steinVerlauf('verlauf-blue', '#8fb3ff', '#2563eb', '#123a91'));
    svg.appendChild(defs);

    const felderGruppe = svgElement('g', { class: 'felder' });
    const raender = svgElement('g', { class: 'raender' });
    this.steinGruppe = svgElement('g', { class: 'steine' });
    this.pfadGruppe = svgElement('g', { class: 'pfad' });

    for (let r = 0; r < GROESSE; r++) {
      this.felder.push([]);
      this.steine.push(Array(GROESSE).fill(null));
      for (let c = 0; c < GROESSE; c++) {
        const m = mittelpunkt(r, c);
        const p = ecken(m.x, m.y);

        const feld = svgElement('polygon', {
          points: alsPunktString(p),
          class: 'feld frei',
          'data-r': r,
          'data-c': c,
        });
        felderGruppe.appendChild(feld);
        this.felder[r].push(feld);
      }
    }

    // Ränder: Rot oben/unten, Blau links/rechts – jeweils die außen liegenden
    // Kanten der Randfelder (Ecke 4 = oben, 1 = unten, siehe ecken()).
    // Die schrägen Kanten in den stumpfen Ecken gehören zu Rot.
    const oben = [], unten = [], links = [], rechts = [];
    const letzte = GROESSE - 1;
    for (let i = 0; i < GROESSE; i++) {
      oben.push(...randEcken(0, i, [3, 4, 5]));
      unten.push(...randEcken(letzte, i, [2, 1, 0]));
      links.push(...randEcken(i, 0, i === letzte ? [3, 2] : [3, 2, 1]));
      rechts.push(...randEcken(i, letzte, i === 0 ? [5, 0] : [4, 5, 0]));
    }
    raender.append(
      randLinie(oben, 'rand-rot'), randLinie(unten, 'rand-rot'),
      randLinie(links, 'rand-blau'), randLinie(rechts, 'rand-blau'),
    );

    svg.append(felderGruppe, raender, this.pfadGruppe, this.steinGruppe);
    return svg;
  }

  // Darf der Spieler gerade klicken? farbe = eigene Farbe (für den Hover-Effekt)
  setzeInteraktiv(aktiv, farbe = null) {
    this.aktiv = aktiv;
    this.svg.classList.toggle('aktiv', aktiv);
    this.svg.classList.toggle('hover-red', aktiv && farbe === 'red');
    this.svg.classList.toggle('hover-blue', aktiv && farbe === 'blue');
  }

  // Steine an den Zustand vom Server anpassen (board[r][c] = null | 'red' | 'blue')
  zeigeZustand(board) {
    for (let r = 0; r < GROESSE; r++) {
      for (let c = 0; c < GROESSE; c++) {
        const soll = board[r][c];
        const stein = this.steine[r][c];
        if (stein && stein.dataset.farbe === soll) continue;   // unverändert
        if (stein) stein.remove();                            // z. B. beim Tausch
        this.steine[r][c] = soll ? this.neuerStein(r, c, soll) : null;
        this.felder[r][c].classList.toggle('frei', !soll);
      }
    }
  }

  neuerStein(r, c, farbe) {
    const m = mittelpunkt(r, c);
    const stein = svgElement('circle', {
      cx: m.x.toFixed(1),
      cy: m.y.toFixed(1),
      r: STEIN_RADIUS.toFixed(1),
      class: `stein ${farbe}`,
      fill: `url(#verlauf-${farbe})`,
    });
    stein.dataset.farbe = farbe;
    this.steinGruppe.appendChild(stein);
    return stein;
  }

  // Gewinnpfad hervorheben: Linie durch die Steine + leuchtende Steine
  zeigeGewinnPfad(pfad) {
    this.pfadGruppe.replaceChildren();
    if (!pfad || pfad.length === 0) return;
    const punkte = pfad.map(f => mittelpunkt(f.row, f.col));
    this.pfadGruppe.appendChild(svgElement('polyline', {
      points: alsPunktString(punkte),
      class: 'gewinn-linie',
    }));
    for (const f of pfad) this.steine[f.row][f.col]?.classList.add('gewinn');
  }

  // Leeres Brett für ein neues Spiel
  zuruecksetzen() {
    this.steinGruppe.replaceChildren();
    this.pfadGruppe.replaceChildren();
    for (let r = 0; r < GROESSE; r++) {
      for (let c = 0; c < GROESSE; c++) {
        this.steine[r][c] = null;
        this.felder[r][c].classList.add('frei');
      }
    }
    this.setzeInteraktiv(false);
  }
}
