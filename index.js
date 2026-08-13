require('./instrument.js');
require('dotenv').config();

const express = require('express');
const Sentry  = require('@sentry/node');
const env     = require('./config/env.js');
const { applySecurity, authLimiter } = require('./config/security.js');
const { iniciarCronRecordatorios } = require('./lib/recordatorios.js');

const app = express();

/* Body parsers ANTES de applySecurity para que sanitizeBody tenga req.body */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* Security stack: helmet + CORS + rate limit + sanitize */
applySecurity(app);

/* DEBUG: log de cada request entrante */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

/* ── Rutas públicas SIN auth — deben ir PRIMERO de todo,
   antes de cualquier router montado en '/' con auth global ── */
app.get('/', (_req, res) => {
  res.json({
    producto: 'GESTEK Event OS',
    version : '0.2.0-fase-a',
    estado  : 'operativo',
    endpoints: {
      privados: [
        'GET    /me',
        'PATCH  /me',
        'GET    /eventos',
        'GET    /eventos/:id',
        'POST   /eventos',
        'PATCH  /eventos/:id',
        'DELETE /eventos/:id',
        'POST   /eventos/:id/estado',
      ],
      publicos: [
        'GET /categorias',
        'GET /eventos/publicos',
        'GET /eventos/publicos/slug/:slug',
      ],
    },
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* Rutas */
app.use('/api/v1',           require('./routes/api.js'));
/* Conector MCP: GESTEK dentro de Claude. Mismo token gtk_live_ que la API
   pública, mismas herramientas que el asistente del panel. */
app.use('/',                 require('./routes/mcp.js'));
app.use('/',                 require('./routes/conexiones.js'));
/* PÚBLICOS primero: estos routers no requieren auth. Deben ir ANTES de
   los routers montados en '/' que aplican router.use(verifySupabaseJWT),
   porque al estar montados en '/' interceptan TODA petición (incluida
   /eventos/publicos y /categorias) y devolverían 401 sin token. */
app.use('/categorias',       require('./routes/categorias.js'));
/* Panel del expositor (público, auth por código de su boleta-Stand). Antes de
   eventos.publicos para que /expositor/:codigo/* tenga prioridad. */
app.use('/eventos/publicos/expositor', require('./routes/expositor.js'));
/* Inscripción a sub-eventos: va ANTES del router general de publicos para que
   /slug/:slug/sesiones no lo capture la ruta de /slug/:slug. */
app.use('/eventos/publicos', require('./routes/sesiones.js').publico);
app.use('/eventos/publicos', require('./routes/legal.js').publico);
app.use('/eventos/publicos', require('./routes/eventos.publicos.js'));
app.use('/me',               require('./routes/me.js'));
app.use('/me',               require('./routes/integraciones.js'));
app.use('/me',               require('./routes/sugerencias.js'));
/* Pagos y Push usan auth POR RUTA (no router.use global) y tienen rutas
   públicas (compra anónima, webhook MP, vapid-key) → van antes del bloque
   con auth global para que esas rutas públicas no sean interceptadas. */
app.use('/', authLimiter,    require('./routes/pagos.js'));
app.use('/',                 require('./routes/wompi.js'));
app.use('/',                 require('./routes/google.js'));
app.use('/',                 require('./routes/webhooks.js'));
app.use('/',                 require('./routes/push.js'));
/* Promociones aplica auth POR RUTA y expone la validación pública de cupón
   (checkout anónimo) → debe ir aquí, antes del grupo con auth global.
   Emails también usa auth por ruta (servicio de correo del evento). */
app.use('/',                 require('./routes/promociones.js'));
app.use('/',                 require('./routes/emails.js'));
/* Routers con router.use(verifySupabaseJWT) GLOBAL montados en '/':
   van AL FINAL del grupo '/' para no bloquear lo público de arriba. */
app.use('/',                 require('./routes/agente.js'));
app.use('/',                 require('./routes/notificaciones.js'));
app.use('/',                 require('./routes/solicitudes.js'));
app.use('/',                 require('./routes/recompensas.js'));
app.use('/',                 require('./routes/loyalty.js'));
app.use('/',                 require('./routes/vacantes.js'));
/* Estos routers se montan en /eventos y definen sus paths con :eventoId
   internamente (evita issues con path-to-regexp v6 al usar param en mount
   path). Van ANTES del router general de /eventos para que sus rutas más
   específicas matcheen primero. */
app.use('/eventos',          require('./routes/equipo.js'));
app.use('/eventos',          require('./routes/roles.js'));
app.use('/eventos',          require('./routes/tickets.js'));
app.use('/eventos',          require('./routes/clientes.js'));
app.use('/eventos',          require('./routes/chat.js'));
app.use('/eventos',          require('./routes/agenda.js'));
app.use('/eventos',          require('./routes/sesiones.js').panel);
app.use('/eventos',          require('./routes/legal.js').panel);
app.use('/eventos',          require('./routes/tareas.js'));
app.use('/eventos',          require('./routes/waitlist.js'));
app.use('/eventos',          require('./routes/auditoria.js'));
app.use('/eventos',          require('./routes/analytics.js'));
app.use('/eventos',          require('./routes/networking.js'));
app.use('/eventos',          require('./routes/torneos.js'));
app.use('/eventos',          require('./routes/interacciones.js'));
app.use('/eventos',          require('./routes/eventos.js'));

if (process.env.NODE_ENV !== 'production') {
  app.get('/debug-sentry', () => { throw new Error('Prueba Sentry'); });
}

// ── 7. Sentry error handler ──────────────────────────────────
Sentry.setupExpressErrorHandler(app);

app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.originalUrl} — NINGUNA RUTA MATCHEA`);
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

/* Introspección real de las rutas registradas en Express */
function listarRutas() {
  const rutas = [];
  function walk(stack, prefix = '') {
    stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join('|');
        rutas.push(`${methods.padEnd(7)} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const src = layer.regexp?.source || '';
        const match = src.match(/^\^\\\/([^\\]+(?:\\\/[^\\]+)*)/);
        const mountPrefix = match ? '/' + match[1].replace(/\\\//g, '/') : '';
        walk(layer.handle.stack, prefix + mountPrefix);
      }
    });
  }
  walk(app._router?.stack || app.router?.stack || []);
  return rutas;
}

iniciarCronRecordatorios();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n┌──────────────────────────────────────────────────────────┐`);
  console.log(`│  GESTEK API  v0.10.0-mp                                  │`);
  console.log(`│  http://localhost:${PORT}                                    │`);
  console.log(`├──────────────────────────────────────────────────────────┤`);
  console.log(`│  Rutas montadas:                                         │`);
  console.log(`│    GET    /  /health  /categorias                        │`);
  console.log(`│    GET    /me  ·  PATCH /me                              │`);
  console.log(`│    GET    /eventos/publicos                              │`);
  console.log(`│    GET    /eventos/publicos/slug/:slug                   │`);
  console.log(`│    CRUD   /eventos  ·  /eventos/:id  ·  /:id/estado      │`);
  console.log(`│    CRUD   /eventos/:id/equipo  (invitar, listar, etc)    │`);
  console.log(`│    CRUD   /eventos/:id/roles   (definir roles)           │`);
  console.log(`│    CRUD   /eventos/:id/tickets (tipos de boleta)         │`);
  console.log(`│    GET    /eventos/:id/clientes (tickets emitidos)       │`);
  console.log(`│    POST   /eventos/publicos/slug/:slug/reservar          │`);
  console.log(`│    CHAT   /eventos/:id/chat/channels(/messages)          │`);
  console.log(`└──────────────────────────────────────────────────────────┘\n`);

  console.log('[DEBUG] Rutas REALES registradas en Express:');
  const rutas = listarRutas();
  rutas.forEach(r => console.log('  ' + r));
  console.log(`  Total: ${rutas.length}\n`);
});
