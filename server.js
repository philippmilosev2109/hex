// server.js – Node.js-Server für Hex
// Schritt 1: Express liefert nur den Ordner public/ aus.
// Folgt später:
// - Socket.io verbindet die beiden Spieler (Räume / Matchmaking)
// - Server hält den Spielzustand und prüft Züge + Gewinner

const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Alle Dateien aus public/ (index.html, style.css, client.js) statisch ausliefern
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Hex-Server läuft auf http://localhost:${PORT}`);
});
