# El Supremo Papá del FIFA 2026

Web del torneo de despedida (domingo 29 de noviembre, 18:00 hrs, Salto 997 apto. 207).

Los 12 convocados aparecen de incógnito. Cada uno recibe un link personal (`/?c=CODIGO`). Al entrar, elige **Asistiré** o **No asistiré**. Su card gira y se revela para todos: a color con el sello CONFIRMADO y confeti, o en blanco y negro y tachada con RECHAZADO. La página se actualiza sola cada 15 s.

## Stack

Todo en Cloudflare, plan gratuito:

```
navegador ──► Cloudflare Pages ──┬── /*      ──► web/ (estático)
                                 └── /api/*  ──► functions/api/[[path]].js ──► D1 (SQLite)
```

| Ruta | Qué hay |
|------|---------|
| `web/` | Sitio: `index.html`, `sorteo.html`, `torneo.html`, `styles.css`, `app.js`, `sorteo.js`, `torneo.js`, `common.js`, `effects.js` (animaciones GSAP), `img/NN.jpg` |
| `lib/tournament.js` | Formato del torneo: liga por casillas, tabla, playoff y llave (sin dependencias) |
| `functions/api/[[path]].js` | La API (Pages Function) |
| `schema.sql` | Tabla `guests` |
| `scripts/guests.json` | Lista de invitados |
| `scripts/seed.mjs` | Carga los invitados en D1 e imprime los links personales |
| `wrangler.toml` | Config de Pages y binding de D1 |

### API

| Método | Ruta | Uso |
|--------|------|-----|
| `GET`  | `/api/rsvps` | Estado público. Nombre y foto **solo** de quienes ya respondieron |
| `GET`  | `/api/me?c=CODE` | Datos del invitado dueño del código |
| `POST` | `/api/rsvp` | `{ "code": "ABC234", "status": "yes" \| "no" }`. Se puede cambiar la respuesta |
| `POST` | `/api/admin/reset` | `{ "num": 3 }` + header `x-admin-token`. Vuelve un invitado a pendiente |
| `POST` | `/api/admin/check` | Valida el código del organizador (header `x-admin-token`) |

| `GET`  | `/api/draw` | Sorteo: equipos, quién tiene cada uno, la fila, las casillas del fixture y a quién le toca |
| `POST` | `/api/draw/start` | (organizador) Arma la fila al azar y una casilla vacía por confirmado |
| `POST` | `/api/draw/shoot` | `{ "zone": "tl", "expect": 3 }`. Patea el primero de la fila |
| `POST` | `/api/draw/pick` | `{ "team": "rma", "expect": 3 }`. El que hizo el gol elige equipo |
| `POST` | `/api/admin/draw/place` | `{ "slot": 4, "expect": 3 }`. Con todos los equipos elegidos, ubica en una casilla al que le toca |
| `POST` | `/api/admin/draw/absent` | `{ "num": 7 }`. El que no vino sale de la fila |
| `POST` | `/api/admin/draw/remove-slot` | `{ "slot": 5 }`. Saca una casilla vacía que sobra |
| `POST` | `/api/admin/draw/auto` | (pruebas) Termina el sorteo al azar: equipos libres a los de la fila y casillas libres a los que no tienen |
| `POST` | `/api/admin/draw/reset` | Borra el sorteo |
| `GET`  | `/api/tournament` | Tabla de la liga, partidos, playoff, llave y campeón |
| `POST` | `/api/admin/tournament/start` | Arma la liga con las casillas del sorteo |
| `POST` | `/api/admin/tournament/result` | `{ "id": 5, "hg": 2, "ag": 1, "pen_winner"?: 3 }`. Con `null` borra el resultado |
| `POST` | `/api/admin/tournament/reset` | Borra el torneo |

Todas las rutas `/api/admin/*` piden el header `x-admin-token`. `shoot` y `pick` aceptan el del organizador o el código del jugador que patea (`x-guest-code`).

Los códigos nunca llegan al front público: solo se resuelven en la Function.

## Sorteo y torneo

**`/sorteo` · La tanda de penales.** Entran los que confirmaron. El organizador toca "Empezar sorteo": se sortea el orden de la fila y se crea el fixture, una casilla vacía por jugador, y se sortean los cruces: qué casilla juega contra cuál (3 partidos por casilla si son pares, 2 si son impares; `randomPairs` en `lib/tournament.js`, guardados en `fixture_pairs`). Patea el primero: elige uno de los 5 lugares del arco y el arquero se tira al azar (`lib/penalty.js`; cualquier lugar es gol 2 de cada 3 veces). Con gol elige uno de los 12 equipos de FC 27 que quedan; si falla, pasa al final de la fila. Cuando todos tienen equipo, se eligen las casillas en el mismo orden en que eligieron equipo: el fixture sube arriba de la página y el organizador toca la casilla libre que dice cada uno; en todas las pantallas se resalta dónde quedó. Cada penal y cada elección se anima en una tarjeta centrada en todas las pantallas. Patea el organizador o el propio jugador desde su celular, si abrió `/sorteo` con su link. Si alguien llega tarde se agrega una casilla al final: patea, elige equipo y elige casilla último; si alguien no vino, el organizador lo saca de la fila (✕) y saca la casilla vacía que sobra. Los equipos están en `TEAMS`, en `functions/api/[[path]].js`.

**Sorteo de salas.** Se juega en dos consolas a la vez: Sala 1 y Sala 2. Cuando todos tienen equipo y casilla, el organizador toca "Sortear salas" en `/sorteo` (o "Armar la liga" en `/torneo`): se arman los partidos de la liga, se reparten en turnos de dos partidos sin jugadores repetidos (y evitando que alguien juegue dos turnos seguidos) y en cada turno se sortea qué partido va a cada sala. El sorteo se anima en todas las pantallas. Los cruces de playoff y llave también se reparten de a dos por turno, con la sala sorteada. En la base, `matches.ord` es el turno y `matches.console` la sala.

**`/torneo`.** Tiempos de 3 minutos (~8 minutos por partido). "Ahora se juega" muestra, para cada sala, el partido actual y el que sigue; si alguien todavía está jugando en la otra sala, avisa que hay que esperarlo. Los partidos salen de las casillas (`lib/tournament.js`):

| Jugadores | Formato | Partidos | Turnos (2 salas) |
|-----------|---------|----------|------------------|
| 4-7 | Todos contra todos; final entre el 1º y el 2º | 7 a 22 | 4 a 12 |
| 8-9 | Liga de 3 partidos c/u (2 si son 9); 1º y 2º a semis; playoff 3º vs 6º y 4º vs 5º | 17 / 14 | 9 / 8 |
| 10-12 | Liga de 3 partidos c/u (2 si son 11); 1º a 6º a cuartos; playoff 7º vs 10º y 8º vs 9º | 24 / 20 / 27 | 13 / 11 / 14 |

Cuartos: 1º vs ganador de 8º-9º, 2º vs ganador de 7º-10º, 3º vs 6º, 4º vs 5º. Tabla: puntos, resultado entre ellos, diferencia de gol, goles a favor y al azar. Playoff y llave a un partido; si hay empate, se elige quién ganó por penales. Liga: los cruces entre casillas se sortean al empezar el sorteo (una ronda al azar y, si son pares, una pareja más al azar sin repetir): 3 partidos cada uno si son pares, 2 si son impares. Si se agrega o se saca una casilla, los cruces se sortean de nuevo. Con 12 jugadores son 14 turnos: cerca de 1 h 50.

Para manejarlo, en `/sorteo` o `/torneo` tocá "🔑 Soy el organizador" e ingresá el código del organizador (el `ADMIN_TOKEN`). Se valida en el momento y queda guardado en ese dispositivo hasta tocar "Salir". Así cualquiera puede manejar el sorteo desde su celular si le pasás el código.

## Verla en tu máquina

```bash
npm install
npm run db:init:local
npm run seed:local          # imprime los 12 links a http://localhost:8788/?c=...
echo 'ADMIN_TOKEN="algo-local"' > .dev.vars
npm run dev                 # http://localhost:8788
```

Abrí uno de los links impresos para probar el flujo de confirmación.

## Publicar en Cloudflare

Necesitás una cuenta gratuita de Cloudflare.

```bash
npx wrangler login

# 1. Base de datos: copiá el database_id que imprime y pegalo en wrangler.toml
npx wrangler d1 create supremo-papa-fifa
npm run db:init

# 2. Proyecto de Pages y primer deploy
npx wrangler pages project create supremo-papa-fifa --production-branch main
npm run deploy               # queda en https://supremo-papa-fifa.pages.dev

# 3. Token de admin (lo pide por consola; guardalo)
npx wrangler pages secret put ADMIN_TOKEN

# 4. Invitados y links
SITE_URL=https://supremo-papa-fifa.pages.dev npm run seed
```

Los links quedan en `scripts/links.local.txt` (ignorado por git). Si el nombre `supremo-papa-fifa` ya está tomado en Pages, usá otro y ajustá `name` en `wrangler.toml` y la `SITE_URL`.

Para publicar cambios: `npm run deploy`.

## Tareas comunes

**Cambiar la lista de convocados** (máximo 12):
1. Editá `scripts/guests.json`. El `num` identifica a cada uno y puede tener huecos; en la web se muestran numerados en orden.
2. Si es alguien nuevo, guardá su ilustración en `web/img/NN.jpg` (vertical, fondo blanco, ~600 px de ancho).
3. `npm run deploy` y `SITE_URL=... npm run seed`. El seed conserva códigos y respuestas, y borra de la base a los que ya no están en la lista.

**Resetear una respuesta:**
```bash
curl -X POST https://supremo-papa-fifa.pages.dev/api/admin/reset \
  -H "x-admin-token: TU_TOKEN" -H "content-type: application/json" \
  -d '{"num": 3}'
```

## Límites del plan gratuito

Pages Functions comparte el límite de Workers (100.000 requests por día) y D1 permite 5 millones de filas leídas y 100.000 escritas por día. Cada actualización de la página lee 12 filas, así que incluso con 50 personas mirando la página durante horas queda muy por debajo.

## Notas

- Las ilustraciones en `web/img/` son públicas para quien conozca la URL. El incógnito es de la página, no de los archivos.
- Los códigos tienen 6 caracteres sin letras ambiguas (sin 0/O ni 1/I/L).
