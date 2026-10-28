// board.js – Das Spielbrett als SVG
// Zeichnet die 121 Sechsecke, die farbigen Ränder, die Koordinaten und die Steine.
// Wichtig: Das Brett setzt NIE selbst einen Stein. Ein Klick wird nur gemeldet,
// gezeichnet wird erst, wenn der Server den Zug bestätigt (neuer "state").

export const GROESSE = 11;          // 11×11 Felder
const R = 24;                       // Radius eines Sechsecks (Mitte → Ecke)
const BREITE = Math.sqrt(3) * R;    // Breite eines Sechsecks (Spitze nach oben)
const RAND = 36;                    // Platz um das Brett (Randlinien + Koordinaten)
const STEIN_RADIUS = R * 0.62;
const PFAD_SCHRITT_MS = 90;         // Gewinnpfad: Verzögerung von Stein zu Stein
const SVG_NS = 'http://www.w3.org/2000/svg';
const SPALTEN = 'ABCDEFGHIJK';

// Koordinate wie in der Hex-Notation: Spalte als Buchstabe, Zeile als Zahl (z. B. "F7")
export function koordinate(row, col) {
  return `${SPALTEN[col]}${row + 1}`;
}

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

// Glänzender Farbverlauf für die Steine (heller Fleck oben links).
// Die Farben selbst stehen in style.css (CSS-Variablen), hier nur die Form.
function steinVerlauf(farbe) {
  const verlauf = svgElement('radialGradient', { id: `verlauf-${farbe}`, cx: '35%', cy: '30%', r: '75%' });
  verlauf.appendChild(svgElement('stop', { offset: '0%', class: 'stop-licht' }));
  verlauf.appendChild(svgElement('stop', { offset: '45%', class: 'stop-mitte' }));
  verlauf.appendChild(svgElement('stop', { offset: '100%', class: 'stop-schatten' }));
  return verlauf;
}

function beschriftung(text, x, y) {
  const el = svgElement('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'koordinate' });
  el.textContent = text;
  return el;
}

export class Brett {
  // container: HTML-Element, in das das SVG kommt
  // onFeldKlick(row, col): wird bei Klick auf ein freies Feld aufgerufen
  constructor(container, onFeldKlick) {
    this.onFeldKlick = onFeldKlick;
    this.aktiv = false;
    this.eigeneFarbe = null;
    this.vorschau = null;   // halbtransparenter Vorschau-Stein
    this.felder = [];       // Polygone [r][c]
    this.steine = [];       // Stein-Elemente [r][c] oder null
    this.svg = this.zeichne();
    container.appendChild(this.svg);

    // Auf schmalen Bildschirmen sind die Koordinaten ausgeblendet (siehe style.css).
    // Dann den leeren Rand wegschneiden, damit die Felder größer werden.
    const schmal = window.matchMedia('(max-width: 520px)');
    const anpassen = () => this.svg.setAttribute('viewBox', schmal.matches ? this.viewBoxKompakt : this.viewBoxNormal);
    schmal.addEventListener('change', anpassen);
    anpassen();

    // Ein einziger Klick-Handler für alle Felder (Event-Delegation)
    this.svg.addEventListener('click', event => {
      const feld = event.target.closest('.feld');
      if (!feld || !this.aktiv) return;
      const row = Number(feld.dataset.r);
      const col = Number(feld.dataset.c);
      if (this.steine[row][col]) return;   // belegt – gar nicht erst senden
      this.onFeldKlick(row, col);
    });

    // Hover-Vorschau: halbtransparenter Stein in der eigenen Farbe auf freien Feldern
    this.svg.addEventListener('pointerover', event => {
      const feld = event.target.closest('.feld');
      if (!this.aktiv || !feld || !feld.classList.contains('frei')) return;
      this.zeigeVorschau(Number(feld.dataset.r), Number(feld.dataset.c), this.eigeneFarbe);
    });
    this.svg.addEventListener('pointerleave', () => this.versteckeVorschau());
  }

  zeichne() {
    // Größe der Zeichenfläche: Breite + halbe Verschiebung durch die Rautenform
    const breite = RAND * 2 + BREITE * (GROESSE + (GROESSE - 1) / 2);
    const hoehe = RAND * 2 + R * 2 + 1.5 * R * (GROESSE - 1);
    const weg = RAND - 10;   // ohne Koordinaten reichen 10 Einheiten Rand
    this.viewBoxNormal = `0 0 ${breite.toFixed(1)} ${hoehe.toFixed(1)}`;
    this.viewBoxKompakt = `${weg} ${weg} ${(breite - 2 * weg).toFixed(1)} ${(hoehe - 2 * weg).toFixed(1)}`;
    const svg = svgElement('svg', {
      viewBox: this.viewBoxNormal,
      role: 'img',
      'aria-label': 'Spielbrett mit 11 mal 11 Feldern. Rot verbindet oben und unten, Blau links und rechts.',
    });

    const defs = svgElement('defs');
    defs.append(steinVerlauf('red'), steinVerlauf('blue'));
    svg.appendChild(defs);

    const felderGruppe = svgElement('g', { class: 'felder' });
    const raender = svgElement('g', { class: 'raender' });
    const koordinaten = svgElement('g', { class: 'koordinaten', 'aria-hidden': 'true' });
    this.pfadGruppe = svgElement('g', { class: 'pfad' });
    this.steinGruppe = svgElement('g', { class: 'steine' });
    this.markierung = svgElement('circle', { r: (STEIN_RADIUS + 3.5).toFixed(1), class: 'letzter-zug' });
    this.markierung.style.display = 'none';

    for (let r = 0; r < GROESSE; r++) {
      this.felder.push([]);
      this.steine.push(Array(GROESSE).fill(null));
      for (let c = 0; c < GROESSE; c++) {
        const m = mittelpunkt(r, c);
        const feld = svgElement('polygon', {
          points: alsPunktString(ecken(m.x, m.y)),
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

    // Koordinaten: Buchstaben A–K über und unter den Spalten, Zahlen 1–11 neben den Zeilen
    for (let i = 0; i < GROESSE; i++) {
      const obenMitte = mittelpunkt(0, i);
      const untenMitte = mittelpunkt(letzte, i);
      const linksMitte = mittelpunkt(i, 0);
      const rechtsMitte = mittelpunkt(i, letzte);
      koordinaten.append(
        beschriftung(SPALTEN[i], obenMitte.x, obenMitte.y - R - 13),
        beschriftung(SPALTEN[i], untenMitte.x, untenMitte.y + R + 14),
        beschriftung(String(i + 1), linksMitte.x - BREITE / 2 - 15, linksMitte.y),
        beschriftung(String(i + 1), rechtsMitte.x + BREITE / 2 + 15, rechtsMitte.y),
      );
    }

    svg.append(felderGruppe, raender, koordinaten, this.pfadGruppe, this.steinGruppe, this.markierung);
    return svg;
  }

  // Darf der Spieler gerade klicken? farbe = eigene Farbe (für Hover und Vorschau)
  setzeInteraktiv(aktiv, farbe = null) {
    this.aktiv = aktiv;
    this.eigeneFarbe = farbe;
    this.svg.classList.toggle('aktiv', aktiv);
    this.svg.classList.toggle('hover-red', aktiv && farbe === 'red');
    this.svg.classList.toggle('hover-blue', aktiv && farbe === 'blue');
    if (!aktiv) this.versteckeVorschau();
  }

  // Steine an den Zustand vom Server anpassen (board[r][c] = null | 'red' | 'blue').
  // animieren: neue Steine "fallen" aufs Brett (nicht beim Wiederherstellen eines Spiels).
  zeigeZustand(board, letzterZug = null, { animieren = true } = {}) {
    this.versteckeTauschVorschau();
    for (let r = 0; r < GROESSE; r++) {
      for (let c = 0; c < GROESSE; c++) {
        const soll = board[r][c];
        const stein = this.steine[r][c];
        if (stein && stein.dataset.farbe === soll) continue;   // unverändert
        if (stein) stein.remove();                            // z. B. beim Tausch
        this.steine[r][c] = soll ? this.neuerStein(r, c, soll, animieren) : null;
        this.felder[r][c].classList.toggle('frei', !soll);
      }
    }
    this.zeigeLetztenZug(letzterZug);
  }

  // Ein Stein ist eine Gruppe aus Kreis und Richtungszeichen:
  // Rot bekommt einen senkrechten Strich (verbindet oben ↕ unten),
  // Blau einen waagrechten (links ↔ rechts). So sind die Farben
  // auch ohne Farbsehen unterscheidbar.
  neuerStein(r, c, farbe, animieren) {
    const m = mittelpunkt(r, c);
    const stein = svgElement('g', {
      class: `stein ${farbe}${animieren ? ' neu' : ''}`,
      transform: `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`,
    });
    const innen = svgElement('g', { class: 'stein-innen' });   // wird animiert
    const k = STEIN_RADIUS * 0.42;
    innen.append(
      svgElement('circle', { r: STEIN_RADIUS.toFixed(1), fill: `url(#verlauf-${farbe})` }),
      svgElement('line', farbe === 'red'
        ? { x1: 0, y1: -k, x2: 0, y2: k, class: 'stein-zeichen' }
        : { x1: -k, y1: 0, x2: k, y2: 0, class: 'stein-zeichen' }),
    );
    stein.appendChild(innen);
    stein.dataset.farbe = farbe;
    stein.dataset.r = r;
    stein.dataset.c = c;
    this.steinGruppe.appendChild(stein);
    return stein;
  }

  // Ring um den zuletzt gesetzten Stein
  zeigeLetztenZug(zug) {
    if (!zug) {
      this.markierung.style.display = 'none';
      return;
    }
    const m = mittelpunkt(zug.row, zug.col);
    this.markierung.setAttribute('cx', m.x.toFixed(1));
    this.markierung.setAttribute('cy', m.y.toFixed(1));
    this.markierung.style.display = '';
  }

  // Halbtransparenter Stein als Vorschau (Hover oder Tausch)
  zeigeVorschau(row, col, farbe) {
    this.versteckeVorschau();
    if (!farbe) return;
    const m = mittelpunkt(row, col);
    this.vorschau = svgElement('circle', {
      cx: m.x.toFixed(1),
      cy: m.y.toFixed(1),
      r: STEIN_RADIUS.toFixed(1),
      class: 'vorschau',
      fill: `url(#verlauf-${farbe})`,
    });
    this.steinGruppe.appendChild(this.vorschau);
  }

  versteckeVorschau() {
    if (this.vorschau) this.vorschau.remove();
    this.vorschau = null;
  }

  // Swap-Vorschau: der rote Stein wird blass, am gespiegelten Feld erscheint Blau
  zeigeTauschVorschau(row, col) {
    this.steine[row][col]?.classList.add('wird-getauscht');
    this.zeigeVorschau(col, row, 'blue');
  }

  versteckeTauschVorschau() {
    this.steinGruppe.querySelectorAll('.wird-getauscht').forEach(s => s.classList.remove('wird-getauscht'));
    this.versteckeVorschau();
  }

  // Gewinnpfad: Linie wird Stein für Stein nachgezeichnet, die Steine leuchten nacheinander auf.
  // Rückgabe: Dauer der Animation in Millisekunden.
  zeigeGewinnPfad(pfad) {
    this.pfadGruppe.replaceChildren();
    if (!pfad || pfad.length === 0) return 0;
    const punkte = pfad.map(f => mittelpunkt(f.row, f.col));
    let laenge = 0;
    for (let i = 1; i < punkte.length; i++) {
      laenge += Math.hypot(punkte[i].x - punkte[i - 1].x, punkte[i].y - punkte[i - 1].y);
    }
    const dauer = pfad.length * PFAD_SCHRITT_MS;
    const linie = svgElement('polyline', { points: alsPunktString(punkte), class: 'gewinn-linie' });
    linie.style.setProperty('--laenge', laenge.toFixed(1));
    linie.style.setProperty('--dauer', `${dauer}ms`);
    this.pfadGruppe.appendChild(linie);
    pfad.forEach((f, i) => {
      const stein = this.steine[f.row][f.col];
      if (!stein) return;
      stein.style.setProperty('--verzoegerung', `${i * PFAD_SCHRITT_MS}ms`);
      stein.classList.add('gewinn');
    });
    return dauer;
  }

  // Leeres Brett für ein neues Spiel
  zuruecksetzen() {
    this.vorschau = null;
    this.steinGruppe.replaceChildren();
    this.pfadGruppe.replaceChildren();
    this.markierung.style.display = 'none';
    for (let r = 0; r < GROESSE; r++) {
      for (let c = 0; c < GROESSE; c++) {
        this.steine[r][c] = null;
        this.felder[r][c].classList.add('frei');
      }
    }
    this.setzeInteraktiv(false);
  }
}
