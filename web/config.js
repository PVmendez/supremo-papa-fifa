// La API vive en el mismo dominio: Cloudflare Pages sirve /api/* con las Functions de functions/api/.
window.APP_CONFIG = {
  apiBase: "/api",
  pollMs: 15000,
  totalGuests: 16
};
