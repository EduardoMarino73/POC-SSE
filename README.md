# Top 50 · Live Chart Terminal

Prototipo que muestra el Top 50 de Spotify en vivo, enviando cambios al
navegador por **Server-Sent Events (SSE)**. 

No tiene dependencias adicionales, unicamente corre con node.js

## Cómo funciona

Spotify no ofrece push/streaming de datos, así que el patrón es:

```
[Spotify Web API] <--polling cada 45s-- [server.js] --SSE--> [navegador]
```

## Correrlo

```bash
node server.js
```

## Conectarlo a Spotify 

1. Copiá `.env`. 
2. Creá una app en el [dashboard de Spotify for Developers](https://developer.spotify.com/dashboard)
   y pegá el `Client ID` / `Client Secret` en `.env`.
3. Reiniciá `node server.js` — el log te va a confirmar Modo: Spotify API.

## Limitaciones a tener en cuenta (API de Spotify, 2026 con cambios raros)

- **`preview_url`** (30s de audio) puede no venir disponible para apps nuevas.
- Desde **feb-2026**, el modo "Developer Mode" de Spotify limita a 5 usuarios
  de prueba y exige cuenta Premium del desarrollador.
- Lo que funciona sin restricciones: `Get Playlist`, `Get Playlist Items`,
  `Get Track(s)`, `Get Artist(s)`

## Estructura

```
server.js          servidor HTTP + SSE + polling + auth Spotify
public/index.html  layout
public/style.css   tema "terminal de chart en vivo"
public/app.js       cliente EventSource + render
.env.example        variables de entorno
```

## Ajustar

- `POLL_INTERVAL_MS` en `.env`: frecuencia de polling 
- `SPOTIFY_PLAYLIST_ID`: cambiar de Top 50 Global a Top 50 de tu país.
