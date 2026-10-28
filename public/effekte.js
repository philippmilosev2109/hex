// effekte.js – Konfetti beim Sieg (Canvas, ohne Bibliothek)
// Kleine Rechtecke fliegen von unten nach oben, drehen sich und fallen mit
// Schwerkraft wieder herunter. Nach etwa 3 Sekunden ist alles vorbei.

export function konfetti() {
  // Wer im System "weniger Bewegung" eingestellt hat, bekommt kein Konfetti
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const leinwand = document.createElement('canvas');
  leinwand.className = 'konfetti';
  leinwand.setAttribute('aria-hidden', 'true');
  document.body.appendChild(leinwand);
  const ctx = leinwand.getContext('2d');
  const pixel = window.devicePixelRatio || 1;
  leinwand.width = window.innerWidth * pixel;
  leinwand.height = window.innerHeight * pixel;
  ctx.scale(pixel, pixel);

  // Farben aus den CSS-Variablen (Rot, Blau, Gold)
  const stil = getComputedStyle(document.documentElement);
  const farben = ['--rot', '--blau', '--fokus', '--text'].map(v => stil.getPropertyValue(v).trim());

  const teile = Array.from({ length: 140 }, () => ({
    x: window.innerWidth * (0.2 + Math.random() * 0.6),
    y: window.innerHeight + 10,
    vx: (Math.random() - 0.5) * 9,
    vy: -(11 + Math.random() * 9),
    breite: 6 + Math.random() * 6,
    hoehe: 4 + Math.random() * 4,
    winkel: Math.random() * Math.PI,
    drehung: (Math.random() - 0.5) * 0.3,
    farbe: farben[Math.floor(Math.random() * farben.length)],
  }));

  const start = performance.now();
  function bild(jetzt) {
    const vergangen = jetzt - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - vergangen / 3000);
    for (const t of teile) {
      t.vy += 0.32;            // Schwerkraft
      t.vx *= 0.99;            // Luftwiderstand
      t.x += t.vx;
      t.y += t.vy;
      t.winkel += t.drehung;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.winkel);
      ctx.fillStyle = t.farbe;
      ctx.fillRect(-t.breite / 2, -t.hoehe / 2, t.breite, t.hoehe);
      ctx.restore();
    }
    if (vergangen < 3000) requestAnimationFrame(bild);
    else leinwand.remove();
  }
  requestAnimationFrame(bild);
}
