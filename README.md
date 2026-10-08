# El Supremo Papá del FIFA 2026

Web del torneo de apertura de la nueva casa (sábado 24 de octubre, 18:00 hrs).

Los 16 convocados aparecen de incógnito. Cada uno recibe un link personal (`/?c=CODIGO`). Al entrar, elige **Asistiré** o **No asistiré**. Su card se revela para todos: a color con el sello CONFIRMADO, o en blanco y negro y tachada con RECHAZADO. La página se actualiza sola cada 15 s.

## Arquitectura

```
navegador ──► CloudFront ──┬── /*      ──► S3 (web/, privado vía OAC)
                           └── /api/*  ──► Lambda Function URL ──► DynamoDB (Guests)
```

| Carpeta    | Qué hay |
|------------|---------|
| `web/`     | Sitio estático: `index.html`, `styles.css`, `app.js`, `img/NN.jpg` (ilustraciones por número de convocado) |
| `api/`     | `handler.mjs`, la Lambda (Node 20, sin dependencias: usa el AWS SDK v3 del runtime) |
| `infra/`   | Stack CDK en TypeScript: tabla, Lambda, bucket, distribución y deploy del sitio |
| `scripts/` | `guests.json` (lista de invitados) y `seed.mjs` (carga la tabla y genera los links) |

### API

| Método | Ruta | Uso |
|--------|------|-----|
| `GET`  | `/api/rsvps` | Estado público. Nombre y foto **solo** de quienes ya respondieron |
| `GET`  | `/api/me?c=CODE` | Datos del invitado dueño del código |
| `POST` | `/api/rsvp` | `{ "code": "ABC234", "status": "yes" \| "no" }`. Se puede cambiar la respuesta |
| `POST` | `/api/admin/reset` | `{ "num": 3 }` + header `x-admin-token`. Vuelve un invitado a pendiente |

Los códigos nunca llegan al front público: solo se resuelven del lado de la Lambda.

## Deploy

Requisitos: Node 20+, credenciales de AWS configuradas, cuenta con CDK bootstrapeado (`npx cdk bootstrap`).

```bash
# 1. Token de admin (guardalo, lo vas a necesitar para /api/admin/reset)
export ADMIN_TOKEN=$(openssl rand -hex 16)

# 2. Infra + sitio
cd infra
npm install
npx cdk deploy
# Outputs: SupremoPapaFifa.SiteUrl y SupremoPapaFifa.TableName

# 3. Invitados y links personales
cd ../scripts
npm install
TABLE_NAME=<TableName> SITE_URL=<SiteUrl> npm run seed
# Imprime los 16 links y los guarda en scripts/links.local.txt (ignorado por git)
```

Cada `cdk deploy` vuelve a subir `web/` e invalida la caché de CloudFront. Usá siempre el mismo `ADMIN_TOKEN`; si lo cambiás, el nuevo valor reemplaza al anterior en la Lambda.

## Tareas comunes

**Agregar una ilustración que faltaba** (Jairo #6, Cristian #7, Ezequiel #8, Pichu #16):
1. Guardala como `web/img/06.jpg` (vertical, fondo blanco, ~600 px de ancho).
2. En `scripts/guests.json` cambiá `"photo": null` por `"photo": "img/06.jpg"`.
3. `cd infra && npx cdk deploy` y después `cd ../scripts && npm run seed` (con las mismas variables). El seed conserva códigos y respuestas.

**Resetear una respuesta:**
```bash
curl -X POST "$SITE_URL/api/admin/reset" \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"num": 3}'
```

**Bajar todo después del torneo:** `cd infra && npx cdk destroy`. Borra tabla, bucket y distribución.

## Notas

- Las ilustraciones en `web/img/` son públicas para quien conozca la URL. El incógnito es de la página, no de los archivos.
- Los códigos tienen 6 caracteres sin letras ambiguas (sin 0/O ni 1/I/L).
- El costo en AWS para 16 invitados es prácticamente cero: DynamoDB on-demand, Lambda y CloudFront entran en el free tier.
