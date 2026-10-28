// design.js – Helles oder dunkles Design
// Wird schon im <head> geladen (kein Modul, kein defer), damit die Seite sofort in
// der richtigen Farbe erscheint und nicht erst kurz dunkel aufblitzt.
// Die Farben selbst stehen in style.css; hier wird nur data-theme="hell" bzw.
// data-theme="dunkel" am <html>-Element gesetzt.
// Ohne eigene Wahl richtet sich das Design nach der Einstellung des Betriebssystems.

'use strict';

(function () {
  const SPEICHER_SCHLUESSEL = 'hex-design';
  const systemHell = window.matchMedia('(prefers-color-scheme: light)');

  // localStorage kann gesperrt sein (z. B. privater Modus) → immer mit try/catch
  function gespeichert() {
    try {
      return localStorage.getItem(SPEICHER_SCHLUESSEL);
    } catch {
      return null;
    }
  }

  function speichern(design) {
    try {
      localStorage.setItem(SPEICHER_SCHLUESSEL, design);
    } catch {
      // Dann gilt die Wahl eben nur bis zum Neuladen
    }
  }

  // Eigene Wahl hat Vorrang, sonst gilt die Systemeinstellung
  function startDesign() {
    const wahl = gespeichert();
    if (wahl === 'hell' || wahl === 'dunkel') return wahl;
    return systemHell.matches ? 'hell' : 'dunkel';
  }

  // Knopf und Farbe der Browserleiste (Handy) an das aktuelle Design anpassen
  function oberflaecheAnpassen() {
    const hell = document.documentElement.dataset.theme === 'hell';
    const knopf = document.getElementById('knopf-design');
    if (knopf) {
      knopf.setAttribute('aria-pressed', String(hell));
      knopf.title = hell ? 'Dunkles Design' : 'Helles Design';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  }

  function setzeDesign(design) {
    document.documentElement.dataset.theme = design;
    oberflaecheAnpassen();
  }

  // Sofort beim Laden setzen (die Seite ist hier noch nicht gezeichnet)
  document.documentElement.dataset.theme = startDesign();

  // Ändert sich die Systemeinstellung und hat man nie selbst gewählt → mitgehen
  systemHell.addEventListener('change', () => {
    if (!gespeichert()) setzeDesign(startDesign());
  });

  // Knopf in der Kopfzeile: erst verfügbar, wenn das HTML fertig geladen ist
  document.addEventListener('DOMContentLoaded', () => {
    oberflaecheAnpassen();
    document.getElementById('knopf-design').addEventListener('click', () => {
      const neu = document.documentElement.dataset.theme === 'hell' ? 'dunkel' : 'hell';
      speichern(neu);
      setzeDesign(neu);
    });
  });
})();
