# Top 50 · Live Chart Terminal

Prototipo que muestra el Top 50 de Spotify en vivo, empujando cambios al
navegador por **Server-Sent Events (SSE)**. Sin dependencias externas: corre
solo con Node.js.

## Cómo funciona

Spotify no ofrece push/streaming de datos, así que el patrón es:

```
[Spotify Web API] <--polling cada 45s-- [server.js] --SSE--> [navegador]
```

`server.js` autentica con **Client Credentials Flow**, lee el playlist Top 50
(`GET /v1/playlists/{id}/tracks`), compara el resultado con el snapshot
anterior, y si hay cambios (una canción sube, baja, entra o sale del chart)
los transmite por `/api/events` a todos los clientes conectados.

## Correrlo

```bash
node server.js
```

Abrí `http://localhost:3000`. Sin configurar nada, arranca en **modo demo**
con datos simulados para que veas el flujo funcionando de punta a punta.

## Conectarlo a Spotify real

1. Copiá `.env.example` a `.env`. 
2. Creá una app en el [dashboard de Spotify for Developers](https://developer.spotify.com/dashboard)
   y pegá el `Client ID` / `Client Secret` en `.env`.
3. Reiniciá `node server.js` — el log te va a confirmar `Modo: REAL (Spotify API)`.

## Limitaciones a tener en cuenta (API de Spotify, 2026)

- **Audio Features / Audio Analysis** (BPM, energy, danceability, key) están
  deprecados desde nov-2024 para apps nuevas — no se pueden mostrar sin un
  análisis propio (ej. con Essentia) o un servicio de terceros.
- **`preview_url`** (30s de audio) puede no venir disponible para apps nuevas.
- Desde **feb-2026**, el modo "Developer Mode" de Spotify limita a 5 usuarios
  de prueba y exige cuenta Premium del desarrollador. Para un prototipo
  personal no debería ser un problema.
- Lo que sí funciona sin restricciones: `Get Playlist`, `Get Playlist Items`,
  `Get Track(s)`, `Get Artist(s)` — suficiente para nombre, artista, álbum,
  portada y `popularity`, que es lo que usa este prototipo.

## Estructura

```
server.js          servidor HTTP + SSE + polling + auth Spotify
public/index.html  layout
public/style.css   tema "terminal de chart en vivo"
public/app.js       cliente EventSource + render
.env.example        variables de entorno
```

## Ajustar

- `POLL_INTERVAL_MS` en `.env`: frecuencia de polling (cuidado con el rate
  limit de Spotify si lo bajás mucho).
- `SPOTIFY_PLAYLIST_ID`: cambiar de Top 50 Global a Top 50 de tu país.
