# Hex – Portfolioaufgabe Web-Entwicklung (DHBW, W3WI_110.2)

## Vorgaben (nicht verhandelbar)
- Frontend nur mit HTML, CSS und Vanilla JavaScript – keine Frameworks (kein React, Vue, jQuery o. Ä.)
- Server: Node.js mit Express und Socket.io – keine weiteren großen Libraries
- Muss auf Ubuntu mit `npm install` und `npm start` laufen
- Verteiltes Zwei-Personen-Spiel: zwei Spieler an unterschiedlichen Rechnern/Browsern

## Spielregeln Hex
- 11×11-Brett aus Sechsecken (Rautenform)
- Rot verbindet oben ↔ unten, Blau verbindet links ↔ rechts
- Abwechselnd je ein Stein, Rot beginnt; belegte Felder sind tabu
- Gewinnprüfung per Pfadsuche (BFS/DFS) über benachbarte Felder (6 Nachbarn)

## Projektstruktur
- `server.js` – Express + Socket.io, Räume/Matchmaking, Spielzustand und Zugprüfung (Server ist die "Wahrheit")
- `public/index.html` – Seitenstruktur
- `public/style.css` – Styling
- `public/client.js` – Brett zeichnen, Züge senden, Updates anzeigen

## Arbeitsweise
- In kleinen Schritten arbeiten; nach jedem funktionierenden Schritt committen
- Code verständlich auf Deutsch kommentieren – ich muss das Spiel komplett selbst präsentieren und erklären können
- Keine unnötige Komplexität
