'use strict';

/**
 * config/security.js — security stack HTTP:
 *   - CORS con whitelist por entorno
 *   - Helmet (security headers + CSP)
 *   - Rate limiting (auth-paths + general API)
 *   - Sanitización básica de inputs
 *
 * Usage en index.js:
 *   const { applySecurity, authLimiter } = require('./config/security');
 *   applySecurity(app);
 *
 * Adaptado de la propuesta original para nuestra arquitectura (Supabase Auth,
 * sin endpoints propios /auth — pero dejamos authLimiter por si se agregan webhooks
 * sensibles al rate limit).
 */

const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const env       = require('./env');

/* ── CORS ─────────────────────────────────────────────────── */
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'];

function buildAllowedOrigins() {
  const origins = [...DEV_ORIGINS];
  if (env.FRONTEND_URL) {
    env.FRONTEND_URL.split(',').forEach(u => {
      const t = u.trim();
      if (t && !origins.includes(t)) origins.push(t);
    });
  }
  return origins;
}
const ALLOWED_ORIGINS = buildAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    /* Peticiones sin Origin (curl, mobile, webhooks de MP) — permitir.
       En prod los webhooks de MP llegan sin Origin, así que NO bloqueamos. */
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no autorizado — ${origin}`));
  },
  credentials   : true,
  methods       : ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge        : 86400,
};

/* ── Helmet ──────────────────────────────────────────────── */
const helmetOptions = {
  /* La API solo devuelve JSON — CSP ultra-restrictiva: nada se ejecuta ni se
     embebe desde respuestas del backend. La CSP de la SPA va en frontend/index.html. */
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc  : ["'none'"],
      frameAncestors: ["'none'"],
      baseUri     : ["'none'"],
      formAction  : ["'none'"],
    },
  },
  /* HSTS solo en producción (asume HTTPS) */
  hsts: env.IS_PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  xContentTypeOptions    : true,
  xFrameOptions          : { action: 'deny' },
  referrerPolicy         : { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  /* Embedder policy desactivado: rompe iframes externos (mapa, MP) si está strict */
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};

/* ── Rate Limiters ──────────────────────────────────────── */
function rateLimitHandler(_req, res) {
  res.status(429).json({
    error     : 'Demasiadas solicitudes. Esperá antes de intentar de nuevo.',
    retryAfter: Math.ceil(res.getHeader('Retry-After') || 60),
  });
}

/* Limiter estricto para endpoints sensibles (push test, broadcast, compras) */
const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_AUTH_WINDOW * 60 * 1000,
  max     : env.RATE_LIMIT_AUTH_MAX,
  standardHeaders       : 'draft-7',
  legacyHeaders         : false,
  skipSuccessfulRequests: true,
  handler               : rateLimitHandler,
});

/* Limiter del webhook de pagos.

   `authLimiter` no lo protegía: lleva `skipSuccessfulRequests` y el webhook
   responde 200 SIEMPRE —es lo correcto, un webhook contesta rápido y procesa
   después—, así que ninguna petición gastaba cuota y una inundación pasaba
   entera. Éste cuenta todas.

   El tope es alto a propósito: los avisos legítimos de Mercado Pago llegan
   todos desde sus servidores y en una apertura de ventas pueden venir en
   ráfaga. Lo que se corta es el bombardeo, no la venta. */
const webhookLimiter = rateLimit({
  windowMs       : 60 * 1000,
  max            : 240,
  standardHeaders: 'draft-7',
  legacyHeaders  : false,
  handler        : rateLimitHandler,
});

/* Limiter global para toda la API */
const apiLimiter = rateLimit({
  windowMs       : env.RATE_LIMIT_API_WINDOW * 60 * 1000,
  max            : env.RATE_LIMIT_API_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders  : false,
  handler        : rateLimitHandler,
  /* Webhooks de MP y Supabase no deben gastar cuota */
  skip(req) {
    return req.path.startsWith('/webhooks/');
  },
});

/* ── Sanitización básica de body ─────────────────────────── */
function sanitizeInput(value, maxLength = 50000) {
  if (typeof value !== 'string') return value;
  /* Elimina caracteres de control (mantiene \n \t para descripciones, chat, page_json) */
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength);
}

function sanitizeObject(obj, depth = 0) {
  if (depth > 8 || typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item, depth + 1));
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = typeof v === 'string' ? sanitizeInput(v) : sanitizeObject(v, depth + 1);
  }
  return clean;
}

function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

/* ── Aplicar stack a app ──────────────────────────────────── */
function applySecurity(app) {
  app.set('trust proxy', 1); // necesario detrás de cloudflared / Vercel / Railway

  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));
  app.use(apiLimiter);
  app.use(sanitizeBody);

  if (!env.IS_PROD) {
    console.log('[Security] helmet ✓ | CORS:', ALLOWED_ORIGINS.join(', '));
    console.log(`[Security] Rate limit: ${env.RATE_LIMIT_API_MAX} req/${env.RATE_LIMIT_API_WINDOW}min global, ${env.RATE_LIMIT_AUTH_MAX}/${env.RATE_LIMIT_AUTH_WINDOW}min sensible`);
  }
}

module.exports = { applySecurity, authLimiter, apiLimiter, webhookLimiter, sanitizeBody, ALLOWED_ORIGINS };
