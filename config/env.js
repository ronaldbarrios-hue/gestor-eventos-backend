'use strict';

/**
 * config/env.js — single source of truth de env vars.
 * Validates critical vars at startup. Fail-fast en producción si falta algo.
 *
 * Usage: const env = require('./config/env');
 */

const REQUIRED_IN_PRODUCTION = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'QR_JWT_SECRET'];
const IS_PROD = process.env.NODE_ENV === 'production';

for (const key of REQUIRED_IN_PRODUCTION) {
  if (!process.env[key]) {
    if (IS_PROD) {
      console.error(`\n[FATAL] Variable de entorno "${key}" no está configurada.`);
      console.error('[FATAL] El servidor no puede iniciar sin esta variable en producción.\n');
      process.exit(1);
    } else {
      console.warn(`[WARN]  Variable "${key}" no configurada (entorno: ${process.env.NODE_ENV || 'development'}).`);
    }
  }
}

if (!process.env.QR_JWT_SECRET) {
  console.warn('[WARN]  QR_JWT_SECRET no configurado. Los QR de tickets usarán un secreto débil de dev.');
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD,
  IS_DEV  : !IS_PROD,

  PORT: parseInt(process.env.PORT, 10) || 3000,

  /* Auth: Supabase es el source of truth — no JWT propio. */
  SUPABASE_URL        : process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  QR_JWT_SECRET       : process.env.QR_JWT_SECRET || 'DEV_ONLY_QR_SECRET_NOT_FOR_PRODUCTION',

  /* URLs */
  FRONTEND_URL   : process.env.FRONTEND_URL || null,
  API_PUBLIC_URL : process.env.API_PUBLIC_URL || null,

  /* Features opcionales */
  ENABLE_SOCKETS: process.env.ENABLE_SOCKETS === 'true',
  SENTRY_DSN    : process.env.SENTRY_DSN || null,

  /* Mercado Pago — plataforma (cuenta GESTEK) para el plan Pro */
  MP_PLATFORM_ACCESS_TOKEN: process.env.MP_PLATFORM_ACCESS_TOKEN || null,
  MP_PLATFORM_PUBLIC_KEY  : process.env.MP_PLATFORM_PUBLIC_KEY   || null,
  PLAN_PRO_PRICE          : Number(process.env.PLAN_PRO_PRICE)         || 79900,
  PLAN_PRO_CURRENCY       :        process.env.PLAN_PRO_CURRENCY       || 'COP',
  PLAN_PRO_PRICE_USD      : Number(process.env.PLAN_PRO_PRICE_USD)     || 19.99,
  PLAN_PRO_DURATION_DAYS  : Number(process.env.PLAN_PRO_DURATION_DAYS) || 30,
  ALLOW_DEV_PRO_ACTIVATION: process.env.ALLOW_DEV_PRO_ACTIVATION === 'true',

  /* Web Push VAPID */
  VAPID_PUBLIC_KEY : process.env.VAPID_PUBLIC_KEY  || null,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || null,
  VAPID_CONTACT    : process.env.VAPID_CONTACT     || 'mailto:hello@gestek.io',

  /* Rate limiting (configurable por entorno) */
  RATE_LIMIT_AUTH_MAX   : parseInt(process.env.RATE_LIMIT_AUTH_MAX,    10) || 20,
  RATE_LIMIT_AUTH_WINDOW: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW, 10) || 15,
  RATE_LIMIT_API_MAX    : parseInt(process.env.RATE_LIMIT_API_MAX,     10) || 300,
  RATE_LIMIT_API_WINDOW : parseInt(process.env.RATE_LIMIT_API_WINDOW,  10) || 15,
};
