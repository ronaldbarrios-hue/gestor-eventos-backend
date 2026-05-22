# Seguridad — guía operativa

Resumen de los controles de seguridad implementados (Sección 3) y procedimientos.

## Controles activos

| Control | Dónde | Notas |
|---|---|---|
| **Helmet** (headers) | `config/security.js` | HSTS en prod, X-Frame-Options DENY, nosniff, referrer-policy. |
| **CSP** | `frontend/index.html` (SPA) + helmet (API) | API: `default-src 'none'`. SPA: whitelist de Supabase/MP/fonts. |
| **CORS whitelist** | `config/security.js` | Orígenes desde `FRONTEND_URL` (coma-separado). |
| **Rate limiting** | `config/security.js` | 300/15min global, 20/15min en `/pagos/*`. Skip en `/webhooks/*`. |
| **Sanitización de body** | `config/security.js` | Strip de control chars, límite 50K/campo. |
| **Webhook MP firmado** | `routes/pagos.js` | HMAC-SHA256 con `MP_WEBHOOK_SECRET`, ventana anti-replay 5 min. |
| **Captcha anti-bot** | Turnstile en reservar/comprar/waitlist | Graceful: sin `TURNSTILE_SECRET_KEY` no se exige. |
| **Límite tickets/email** | reservar + comprar | `MAX_TICKETS_POR_EMAIL` (default 5) por evento. |
| **Sanitización de URLs** | `lib/urls.js` | avatar_url / cover_url / pago_qr_url: solo http(s) o data:image. |
| **Storage policies** | migrations 0004/0005/0026 | Escritura escopada por carpeta = `auth.uid()`. |
| **RLS** | todas las tablas | Acceso a nivel de fila; backend usa service_role solo cuando hace falta. |

## Variables de entorno de seguridad

```
# Captcha (opcional — si se omiten, no se exige captcha)
TURNSTILE_SECRET_KEY=        # backend (Cloudflare Turnstile)
# y en frontend/.env.local:
VITE_TURNSTILE_SITE_KEY=

# Webhook Mercado Pago
MP_WEBHOOK_SECRET=           # del panel del webhook en MP

# Anti-abuso
MAX_TICKETS_POR_EMAIL=5

# QR de tickets
QR_JWT_SECRET=               # >=32 chars aleatorios
```

## Procedimiento: rotar `QR_JWT_SECRET`

`QR_JWT_SECRET` firma los tokens QR de las boletas (HS256). Rotarlo invalida
**todos los QR ya emitidos** — pero NO bloquea el acceso, porque el check-in
acepta también el **código corto de 8 caracteres** que está impreso en cada
boleta y guardado en `tickets.codigo`.

### Cuándo rotar
- Si el secret se filtró (commit accidental, log, captura).
- Rotación preventiva periódica (ej. anual).

### Pasos
1. Generar un secret nuevo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Reemplazar `QR_JWT_SECRET` en el `.env` de producción.
3. Reiniciar el backend.
4. **Impacto**: los QR viejos dejan de validar por firma. Mitigación inmediata:
   - El staff puede hacer check-in con el **código corto** (siempre funciona,
     no depende del secret).
   - Opcional: regenerar y reenviar QR. Endpoint para regenerar masivamente
     no existe aún; si se necesita, correr un script que vuelva a firmar
     `tickets.qr_token` con el nuevo secret para tickets `estado in
     ('pagado','emitido')` de eventos futuros.
5. Comunicar a los organizadores con eventos próximos que pueden usar el
   código corto si un QR viejo no escanea.

### Mitigación de raíz
- Nunca commitear `.env` (ya está en `.gitignore`).
- En producción, inyectar el secret vía el secret manager del host
  (Railway/Render/Vercel env vars), no en archivos.

## Pendiente / mejoras futuras
- Regeneración masiva de QR tras rotación (script CLI).
- 2FA para cuentas de organizador.
- Logs de seguridad centralizados (intentos de login fallidos, rate-limit hits).
- Revisión periódica de dependencias (`npm audit` en CI).
