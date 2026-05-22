'use strict';

/**
 * instrument.js — Sentry SDK initialization.
 * Debe ser el PRIMER require de index.js.
 * El DSN se lee de SENTRY_DSN env var; si no está, Sentry queda deshabilitado.
 */

require('dotenv').config();
const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii  : false,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    environment     : process.env.NODE_ENV || 'development',
  });
} else {
  console.warn('[Sentry] SENTRY_DSN no configurado — monitoreo deshabilitado.');
}
