# El Supremo Papá del FIFA 2026

Web del torneo de apertura de la nueva casa (sábado 24 de octubre, 18:00 hrs).

Los 16 convocados aparecen de incógnito. Cada uno recibe un link personal (`/?c=CODIGO`). Al entrar, elige **Asistiré** o **No asistiré**. Su card gira y se revela para todos: a color con el sello CONFIRMADO y confeti, o en blanco y negro y tachada con RECHAZADO. La página se actualiza sola cada 15 s.

## Stack

Todo en Cloudflare, plan gratuito:

```
navegador ──► Cloudflare Pages ──┬── /*      ──► web/ (estático)
                                 └── /api/*  ──► functions/api/[[path]].js ──► D1 (SQLite)
```

| Ruta | Qué hay |
|------|---------|
| `web/` | Sitio: `index.html`, `styles.css`, `app.js`, `effects.js` (animaciones GSAP), `img/NN.jpg` |
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

Los códigos nunca llegan al front público: solo se resuelven en la Function.

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
