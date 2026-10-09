# El Supremo Papá del FIFA 2026

Web del torneo de apertura de la nueva casa (domingo 18 de octubre, 18:00 hrs).

Los 16 convocados aparecen de incógnito. Cada uno recibe un link personal (`/?c=CODIGO`). Al entrar, elige **Asistiré** o **No asistiré**. Su card gira y se revela para todos: a color con el sello CONFIRMADO y confeti, o en blanco y negro y tachada con RECHAZADO. La página se actualiza sola cada 15 s.

## Stack

Todo en Cloudflare, plan gratuito:

```
navegador ──► Cloudflare Pages ──┬── /*      ──► web/ (estático)
                                 └── /api/*  ──► functions/api/[[path]].js ──► D1 (SQLite)
```

| Ruta | Qué hay |
|------|---------|
| `web/` | Sitio: `index.html`, `sorteo.html`, `torneo.html`, `styles.css`, `app.js`, `sorteo.js`, `torneo.js`, `common.js`, `effects.js` (animaciones GSAP), `img/NN.jpg` |
| `lib/tournament.js` | Formato del torneo, grupos, tablas y llave (sin dependencias) |
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

| `GET`  | `/api/draw` | Sorteo: equipos, quién tiene cada uno, la fila de pateadores y a quién le toca |
| `POST` | `/api/draw/start` | (organizador) Arma la fila al azar con los confirmados |
| `POST` | `/api/draw/shoot` | `{ "zone": "tl", "expect": 3 }`. Patea el primero de la fila |
| `POST` | `/api/draw/pick` | `{ "team": "rma", "expect": 3 }`. El que hizo el gol elige equipo |
| `POST` | `/api/admin/draw/reset` | Borra el sorteo |
| `GET`  | `/api/tournament` | Grupos con tabla, partidos, llave y campeón |
| `POST` | `/api/admin/tournament/start` | Arma grupos y fixture con los que tienen equipo |
| `POST` | `/api/admin/tournament/result` | `{ "id": 5, "hg": 2, "ag": 1, "pen_winner"?: 3 }`. Con `null` borra el resultado |
| `POST` | `/api/admin/tournament/reset` | Borra el torneo |

Todas las rutas `/api/admin/*` piden el header `x-admin-token`. `shoot` y `pick` aceptan el del organizador o el código del jugador que patea (`x-guest-code`).

Los códigos nunca llegan al front público: solo se resuelven en la Function.

## Sorteo y torneo

**`/sorteo` · La tanda de penales.** Entran los que confirmaron. El organizador toca "Empezar sorteo" y se sortea el orden de la fila. Patea el primero: elige uno de los 5 lugares del arco y el arquero se tira al azar (la lógica está en `lib/penalty.js`; cualquier lugar es gol 2 de cada 3 veces). Con gol elige el equipo que quiera de los que quedan; si se la atajan, pega en el palo o se va afuera, pasa al final de la fila. Cada penal y cada elección se anima a pantalla completa en todas las pantallas. Patea el organizador desde su panel o el propio jugador desde su celular, si abrió `/sorteo` con su link (`/sorteo?c=CODIGO`, o el botón "Ir al sorteo" de su invitación). Los 16 equipos están en `TEAMS`, en `functions/api/[[path]].js`.

**`/torneo`.** Pensado para una sola consola y unas 3 horas: ningún formato pasa de 15 partidos (~10 minutos cada uno con tiempos de 4 minutos). Con el sorteo terminado, el organizador toca "Armar grupos" y el formato sale de cuántos jugadores tienen equipo (`lib/tournament.js`):

| Jugadores | Formato | Partidos |
|-----------|---------|----------|
| 4-5 | 1 grupo todos contra todos; final entre el 1º y el 2º | 7 / 11 |
| 6 | 2 grupos de 3; los 2 primeros a semis | 9 |
| 7-8 | 2 grupos (4+3 / 4+4); los 2 primeros a semis | 12 / 15 |
| 9-10 | 3 grupos; los ganadores y el mejor 2º a semis | 12 / 15 |
| 11 | 4 grupos (3+3+3+2, el de 2 juega ida y vuelta); los ganadores a semis | 14 |
| 12 | 4 grupos de 3; los ganadores a semis | 15 |
| 13-16 | Eliminación directa; los mejores bombos pasan directo a cuartos | 12 a 15 |

Los grupos se reparten con un equipo de cada bombo y los partidos se intercalan para que nadie juegue dos seguidos. "Ahora se juega" muestra el partido actual y los dos que siguen. Cuando terminan los grupos se arma la llave sola. En los partidos a todo o nada, si hay empate se elige quién ganó por penales.

Para manejarlo, en `/sorteo` o `/torneo` tocá "🔑 Soy el organizador" e ingresá el código del organizador (el `ADMIN_TOKEN`). Se valida en el momento y queda guardado en ese dispositivo hasta tocar "Salir". Así cualquiera puede manejar el sorteo desde su celular si le pasás el código.

## Verla en tu máquina

```bash
npm install
npm run db:init:local
npm run seed:local          # imprime los 16 links a http://localhost:8788/?c=...
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

**Agregar una ilustración que faltaba** (Jairo #6, Cristian #7, Ezequiel #8, Pichu #16):
1. Guardala como `web/img/06.jpg` (vertical, fondo blanco, ~600 px de ancho).
2. En `scripts/guests.json` cambiá `"photo": null` por `"photo": "img/06.jpg"`.
3. `npm run deploy` y `SITE_URL=... npm run seed`. El seed conserva códigos y respuestas.

**Resetear una respuesta:**
```bash
curl -X POST https://supremo-papa-fifa.pages.dev/api/admin/reset \
  -H "x-admin-token: TU_TOKEN" -H "content-type: application/json" \
  -d '{"num": 3}'
```

## Límites del plan gratuito

Pages Functions comparte el límite de Workers (100.000 requests por día) y D1 permite 5 millones de filas leídas y 100.000 escritas por día. Cada actualización de la página lee 16 filas, así que incluso con 50 personas mirando la página durante horas queda muy por debajo.

## Notas

- Las ilustraciones en `web/img/` son públicas para quien conozca la URL. El incógnito es de la página, no de los archivos.
- Los códigos tienen 6 caracteres sin letras ambiguas (sin 0/O ni 1/I/L).
