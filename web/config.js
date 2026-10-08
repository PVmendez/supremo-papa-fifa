// En producción la API vive en el mismo dominio (CloudFront enruta /api/* a la Lambda).
// Para desarrollo local podés apuntar a otra URL, ej: "https://xxxx.lambda-url.us-east-1.on.aws/api".
window.APP_CONFIG = {
  apiBase: "/api",
  pollMs: 15000,
  totalGuests: 16
};
