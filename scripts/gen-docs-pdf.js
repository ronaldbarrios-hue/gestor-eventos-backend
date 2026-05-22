/* Genera GESTEK-Documentacion.pdf — documento completo del proyecto para compartir. */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const C = {
  blue   : '#3B82F6',
  purple : '#8B5CF6',
  dark   : '#0F172A',
  text   : '#1E293B',
  muted  : '#64748B',
  light  : '#F8FAFC',
  border : '#E2E8F0',
  white  : '#FFFFFF',
  code   : '#0F766E',
  success: '#059669',
  bg     : '#FFFFFF',
};

const PAGE = { w: 595, h: 842 };
const M = 55;
const W = PAGE.w - M * 2;

const out = path.join(__dirname, '..', 'docs', 'GESTEK-Documentacion.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: M, bottom: M, left: M, right: M },
  info: {
    Title : 'GESTEK Event OS — Documentación del proyecto',
    Author: 'GESTEK',
    Subject: 'Documentación técnica y de producto.',
  },
  bufferPages: true,
});
doc.pipe(fs.createWriteStream(out));

/* ───── helpers ───── */
const ensureSpace = (n = 80) => { if (doc.y + n > PAGE.h - M - 20) doc.addPage(); };

const h1 = (text) => {
  doc.addPage();
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(10)
    .text('GESTEK Event OS', M, M, { lineBreak: false });
  doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(32)
    .text(text, M, M + 50, { width: W });
  doc.moveTo(M, doc.y + 8).lineTo(M + 80, doc.y + 8).lineWidth(3).strokeColor(C.blue).stroke();
  doc.moveDown(1.5);
};

const h2 = (text) => {
  ensureSpace(80);
  doc.moveDown(0.8);
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(18).text(text, { width: W });
  doc.moveDown(0.4);
};

const h3 = (text) => {
  ensureSpace(50);
  doc.moveDown(0.5);
  doc.fillColor(C.purple).font('Helvetica-Bold').fontSize(13).text(text, { width: W });
  doc.moveDown(0.3);
};

const p = (text, opts = {}) => {
  ensureSpace(40);
  doc.fillColor(opts.color || C.text)
    .font(opts.bold ? 'Helvetica-Bold' : (opts.italic ? 'Helvetica-Oblique' : 'Helvetica'))
    .fontSize(opts.size || 10.5);
  doc.text(text, { align: opts.align || 'left', paragraphGap: 6, lineGap: 3, width: W });
};

const callout = (label, text, color = C.blue) => {
  ensureSpace(60);
  const startY = doc.y;
  doc.font('Helvetica').fontSize(10.5);
  const textH = doc.heightOfString(text, { width: W - 30 });
  const boxH = textH + 30;

  doc.rect(M, startY, 4, boxH).fill(color);
  doc.rect(M + 4, startY, W - 4, boxH).fillOpacity(0.06).fill(color).fillOpacity(1);

  doc.fillColor(color).font('Helvetica-Bold').fontSize(9)
    .text(label.toUpperCase(), M + 16, startY + 10, { width: W - 30 });
  doc.fillColor(C.text).font('Helvetica').fontSize(10.5)
    .text(text, M + 16, doc.y + 2, { width: W - 30, lineGap: 3 });

  doc.y = startY + boxH + 12;
};

function parseInline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: 'n', v: text.slice(last, m.index) });
    const tk = m[0];
    out.push(tk.startsWith('**')
      ? { t: 'b', v: tk.slice(2, -2) }
      : { t: 'c', v: tk.slice(1, -1) });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'n', v: text.slice(last) });
  return out;
}

const bullet = (text) => {
  ensureSpace(28);
  const startY = doc.y;
  doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(11).text('•', M, startY, { lineBreak: false });
  doc.x = M + 14;
  doc.y = startY;
  const tokens = parseInline(text);
  tokens.forEach((tok, i) => {
    const last = i === tokens.length - 1;
    const font = tok.t === 'b' ? 'Helvetica-Bold' : (tok.t === 'c' ? 'Courier' : 'Helvetica');
    const color = tok.t === 'c' ? C.code : C.text;
    const size = tok.t === 'c' ? 9.5 : 10.5;
    doc.fillColor(color).font(font).fontSize(size).text(tok.v, {
      continued: !last, width: W - 14, paragraphGap: 4, lineGap: 3,
    });
  });
};

function table(headers, rows, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => (w / total) * W);
  const headerH = 22;

  ensureSpace(40 + rows.length * 24);
  const startY = doc.y;

  doc.rect(M, startY, W, headerH).fill(C.blue);
  let x = M;
  headers.forEach((h, i) => {
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10)
      .text(h, x + 8, startY + 6, { width: widths[i] - 16, lineBreak: false, ellipsis: true });
    x += widths[i];
  });
  doc.y = startY + headerH;

  rows.forEach((row, idx) => {
    let maxH = 18;
    row.forEach((cell, i) => {
      const txt = String(cell);
      const h = doc.font('Helvetica').fontSize(9.5).heightOfString(txt, { width: widths[i] - 16 });
      if (h + 10 > maxH) maxH = h + 10;
    });

    if (doc.y + maxH > PAGE.h - M - 20) {
      doc.addPage();
      const ry = doc.y;
      doc.rect(M, ry, W, headerH).fill(C.blue);
      let xh = M;
      headers.forEach((h, i) => {
        doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10)
          .text(h, xh + 8, ry + 6, { width: widths[i] - 16, lineBreak: false, ellipsis: true });
        xh += widths[i];
      });
      doc.y = ry + headerH;
    }

    const rowY = doc.y;
    if (idx % 2 === 0) doc.rect(M, rowY, W, maxH).fill(C.light);
    doc.strokeColor(C.border).lineWidth(0.5)
      .moveTo(M, rowY + maxH).lineTo(M + W, rowY + maxH).stroke();

    let cx = M;
    row.forEach((cell, i) => {
      doc.fillColor(C.text).font('Helvetica').fontSize(9.5)
        .text(String(cell), cx + 8, rowY + 6, { width: widths[i] - 16 });
      cx += widths[i];
    });
    doc.y = rowY + maxH;
  });
  doc.strokeColor(C.border).lineWidth(0.6).rect(M, startY, W, doc.y - startY).stroke();
  doc.moveDown(0.8);
}

function codeBlock(text) {
  ensureSpace(40);
  const lines = text.split('\n');
  doc.font('Courier').fontSize(9);
  const lineH = doc.heightOfString('A') + 2;
  const boxH = lines.length * lineH + 14;
  const y = doc.y;
  doc.rect(M, y, W, boxH).fillAndStroke('#F1F5F9', C.border);
  doc.fillColor(C.code).font('Courier').fontSize(9)
    .text(text, M + 10, y + 7, { width: W - 20, lineGap: 2 });
  doc.y = y + boxH + 8;
}

/* ════════════════════════════════════════════════════════════
   PORTADA
   ════════════════════════════════════════════════════════════ */

doc.rect(0, 0, PAGE.w, PAGE.h).fill('#0F172A');

doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(54)
  .text('GESTEK', M, 220, { align: 'center', width: W });
doc.fillColor('#F1F5F9').font('Helvetica').fontSize(20)
  .text('Event OS', { align: 'center', width: W });

doc.moveDown(2);
doc.fillColor('#94A3B8').font('Helvetica').fontSize(14)
  .text('Plataforma SaaS de gestión de eventos\ncon marca blanca para organizadores',
    { align: 'center', width: W, lineGap: 4 });

doc.moveDown(4);
doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(11)
  .text('Documentación del proyecto · Versión post-fase 3', { align: 'center', width: W });
doc.fillColor('#64748B').font('Helvetica').fontSize(11)
  .text('16 de mayo de 2026', { align: 'center', width: W });

/* Línea decorativa abajo */
doc.moveTo(M + W * 0.3, PAGE.h - 100).lineTo(M + W * 0.7, PAGE.h - 100)
  .lineWidth(1).strokeColor(C.blue).stroke();
doc.fillColor('#64748B').font('Helvetica').fontSize(9)
  .text('github.com/Sekkon0906/GestorEventosMarcaBlanca', M, PAGE.h - 85, { align: 'center', width: W });

/* ════════════════════════════════════════════════════════════
   TABLA DE CONTENIDOS
   ════════════════════════════════════════════════════════════ */

h1('Contenido');

const TOC = [
  ['1. ', 'Resumen ejecutivo'],
  ['2. ', 'Qué es GESTEK'],
  ['3. ', 'Stack y arquitectura'],
  ['4. ', 'Estructura del proyecto'],
  ['5. ', 'Modelo de datos'],
  ['6. ', 'Features para organizadores'],
  ['7. ', 'Features para asistentes'],
  ['8. ', 'Planes y monetización'],
  ['9. ', 'Setup local'],
  ['10.', 'Variables de entorno'],
  ['11.', 'Despliegue a producción'],
  ['12.', 'Seguridad'],
  ['13.', 'Estado actual y próximos pasos'],
];
TOC.forEach(([n, t]) => {
  doc.fillColor(C.muted).font('Helvetica').fontSize(11)
    .text(n, M + 40, doc.y, { lineBreak: false, width: 30 });
  doc.fillColor(C.text).font('Helvetica').fontSize(11)
    .text(t, M + 75, doc.y, { width: W - 75, paragraphGap: 4 });
});

/* ════════════════════════════════════════════════════════════
   1. RESUMEN EJECUTIVO
   ════════════════════════════════════════════════════════════ */

h1('1. Resumen ejecutivo');

p('GESTEK es una plataforma SaaS multitenancy que permite a organizadores (empresas, productoras, instituciones) crear, vender y operar eventos de cualquier tamaño bajo su propia marca. Funciona end-to-end: desde la página pública del evento hasta el check-in con QR.');

doc.moveDown(0.5);

callout('Propuesta de valor',
  'Un organizador crea un evento en 2 minutos, recibe pagos directos a su cuenta de Mercado Pago sin comisión de GESTEK, gestiona equipo con roles granulares, comunica con asistentes vía chat y email automático, y hace check-in con cualquier celular escaneando el QR. Todo desde un único panel.');

h2('Públicos objetivo');
[
  '**Organizadores chicos** (talleres, workshops, fiestas, lanzamientos): plan Free cubre todo lo necesario.',
  '**Productoras y agencias** (conferencias, festivales, congresos): plan Pro con white-label, API, dominio propio.',
  '**Instituciones educativas y empresas**: equipos multi-rol, gestión interna de eventos corporativos.',
].forEach(bullet);

h2('Métricas clave del proyecto');
table(
  ['Métrica', 'Valor'],
  [
    ['Líneas de código',                     '~28.000'],
    ['Endpoints API',                        '60+'],
    ['Migrations de DB',                     '20 (0000–0019)'],
    ['Tabs del workspace',                   '11'],
    ['Tipos de bloques editables',           '16'],
    ['Plantillas pre-armadas',               '3 (conferencia, workshop, fiesta)'],
    ['Integraciones',                        'Supabase, Mercado Pago, Resend, Sentry, Web Push (VAPID)'],
  ],
  [40, 60],
);

/* ════════════════════════════════════════════════════════════
   2. QUÉ ES GESTEK
   ════════════════════════════════════════════════════════════ */

h1('2. Qué es GESTEK');

p('GESTEK es un "Event OS" — sistema operativo para eventos. No es solo ticketing ni solo CRM ni solo página de evento: integra todas las funciones operativas en un único producto.');

h2('Diferenciadores');
[
  '**Pagos directos al organizador**: sin comisión sobre ventas. El dinero va a la cuenta MP del organizador, no a la nuestra.',
  '**Workspace por evento**: cada evento es un mini-mundo con sus tabs (chat, tareas, agenda, clientes, check-in, analytics).',
  '**Editor visual de página pública**: 16 tipos de bloques arrastrables, 3 plantillas pre-armadas, branding por evento.',
  '**Multi-rol granular**: organizador, productor, soporte, check-in, comunicaciones — cada uno con permisos específicos.',
  '**Comunicación nativa**: chat interno por canales (texto + imagen + audio), email automático T-7d / T-1d / T-1h, push notifications.',
  '**Mobile-first**: hamburger menu, drawer responsive, check-in con cualquier smartphone.',
].forEach(bullet);

h2('Casos de uso típicos');
table(
  ['Tipo de evento', 'Ejemplo de uso'],
  [
    ['Conferencia técnica', 'Plantilla conferencia + speakers + agenda + sponsors + QR check-in'],
    ['Workshop',            'Plantilla workshop + cupo limitado + recordatorio T-1d + chat con instructor'],
    ['Festival/Fiesta',     'Plantilla fiesta + galería + line-up + pago MP + check-in masivo'],
    ['Corporativo interno', 'Sin precio + invitar por CSV + agenda por sala + chat por área'],
    ['Educativo',           'Free hasta 1000 asistentes + recordatorios automáticos + analytics'],
  ],
  [30, 70],
);

/* ════════════════════════════════════════════════════════════
   3. STACK Y ARQUITECTURA
   ════════════════════════════════════════════════════════════ */

h1('3. Stack y arquitectura');

h2('Tecnologías');
table(
  ['Capa', 'Tecnología'],
  [
    ['Frontend',              'React 18 + Vite + React Router + Tailwind CSS'],
    ['UI utilities',          'dnd-kit (drag&drop), qrcode.react, html5-qrcode, react-toastify'],
    ['Backend',               'Node.js + Express 5'],
    ['Database',              'Postgres (vía Supabase) con Row Level Security'],
    ['Auth',                  'Supabase Auth (email/password + Google OAuth)'],
    ['Storage',               'Supabase Storage (avatars, event-media)'],
    ['Realtime',              'Supabase Realtime (postgres_changes para chat)'],
    ['Email transaccional',   'Resend (via Supabase Edge Function)'],
    ['Pagos',                 'Mercado Pago Checkout Pro (REST API)'],
    ['Notificaciones push',   'Web Push API + VAPID + web-push'],
    ['Monitoreo',             'Sentry'],
    ['Security HTTP',         'helmet + express-rate-limit + sanitización'],
  ],
  [25, 75],
);

h2('Diagrama lógico');
codeBlock(`┌──────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser    │◄───────►│  Frontend    │◄───────►│  Backend    │
│  (asistente  │  HTTPS  │  Vite/React  │  REST   │  Express 5  │
│  / organi-   │         │  Tailwind    │  +JWT   │             │
│  zador)      │         └──────┬───────┘         └──────┬──────┘
└──────────────┘                │                        │
                                │ Supabase JS            │ service_role
                                ▼                        ▼
                         ┌─────────────────────────────────────┐
                         │            Supabase                 │
                         │  Auth · Postgres · Storage · Real-  │
                         │  time · Edge Functions (cron)       │
                         └────────────┬──────────────┬─────────┘
                                      │              │
                              webhook │              │ webhook
                                      ▼              ▼
                              ┌───────────┐  ┌───────────────┐
                              │  Mercado  │  │   Resend      │
                              │   Pago    │  │  (email)      │
                              └───────────┘  └───────────────┘`);

h2('Decisiones arquitectónicas clave');
[
  '**Supabase como source of truth**: auth, DB, storage, realtime, edge functions — todo en una sola plataforma.',
  '**RLS en lugar de validators**: el control de acceso vive en la DB (policies SQL), no en código de aplicación. Esto evita inconsistencias entre clients.',
  '**service_role en backend**: el server usa el rol privilegiado de Supabase para bypassear RLS cuando hace falta (ej. webhooks). Nunca expone esa key al client.',
  '**JWT firmado para QR**: cada ticket lleva un token JWT HS256 con `{ticket_id, evento_id, codigo}`. El staff de check-in valida con clave compartida — no requiere DB lookup para validar firma.',
  '**Idempotencia en webhooks y emails**: tabla `email_log` con unique index (ticket_id, tipo). Tabla `payment_transactions` con unique index sobre payment_id.',
  '**Edge Function + pg_cron para emails**: el cron de Postgres invoca una Edge Function que envía vía Resend. Sin servidores adicionales.',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   4. ESTRUCTURA DEL PROYECTO
   ════════════════════════════════════════════════════════════ */

h1('4. Estructura del proyecto');

p('El repositorio mezcla backend (raíz) y frontend (`frontend/`) en un único monorepo.', { color: C.muted });

codeBlock(`GestorEventosMarcaBlanca/
├── index.js                  ← entry point del backend
├── instrument.js             ← Sentry init (lee DSN de env)
├── config/
│   ├── env.js                ← validación fail-fast de env vars
│   └── security.js           ← helmet + CORS + rate limit + sanitize
├── lib/
│   ├── supabase.js           ← cliente service_role
│   ├── qr.js                 ← sign/verify JWT de tickets
│   ├── mercadopago.js        ← cliente MP REST
│   └── slug.js               ← slugify único de eventos
├── middleware/
│   └── auth.js               ← verifySupabaseJWT, verifySupabaseJWTOptional
├── routes/
│   ├── eventos.js            ← CRUD privado de eventos
│   ├── eventos.publicos.js   ← /explorar, /slug/:slug, /reservar
│   ├── pagos.js              ← MP integration + plan Pro
│   ├── push.js               ← Web Push subscribe/broadcast
│   ├── analytics.js          ← métricas por evento
│   ├── chat.js, agenda.js, tareas.js, tickets.js,
│   ├── equipo.js, roles.js, clientes.js, me.js, categorias.js
├── db/
│   └── migrations/           ← 0000–0019 (orden importante)
├── supabase/
│   └── functions/
│       └── send-reminders/   ← Edge Function (Deno + Resend)
├── docs/
│   ├── RECORDATORIOS.md      ← setup Edge Function + cron
│   ├── ROADMAP.md
│   └── GESTEK-*.pdf
└── frontend/
    ├── public/
    │   └── sw.js             ← Service Worker (push)
    └── src/
        ├── App.jsx           ← router
        ├── api/              ← clientes axios por dominio
        ├── components/
        │   ├── layout/       ← Sidebar, TopBar, AppLayout, PublicLayout
        │   └── ui/           ← componentes reutilizables
        ├── context/          ← AuthContext, ToastContext
        ├── hooks/            ← usePush
        ├── lib/              ← supabase client, permisos
        └── pages/
            ├── public/       ← Landing, Explorar, Planes, EventoPublico, MiTicket
            ├── events/
            │   ├── EventDetailPage.jsx  ← workspace con 11 tabs
            │   ├── EventEditPage.jsx
            │   ├── tabs/                ← Resumen, Chat, Agenda, ...
            │   └── editor/              ← PageBuilder, blocks, templates
            ├── settings/
            └── users/`);

/* ════════════════════════════════════════════════════════════
   5. MODELO DE DATOS
   ════════════════════════════════════════════════════════════ */

h1('5. Modelo de datos');

p('20 migrations construyen el esquema. Cada tabla tiene RLS habilitado.', { color: C.muted });

h2('Tablas principales');
table(
  ['Tabla', 'Propósito'],
  [
    ['profiles',             'Datos del usuario. Sincronizada con auth.users vía trigger.'],
    ['eventos',              'Núcleo. Cada fila es un evento de un organizador (owner_id).'],
    ['event_roles',          'Roles por evento, con permissions jsonb. Seed automático al crear evento.'],
    ['event_members',        'Equipo del evento. Relaciona profiles + event_roles.'],
    ['ticket_types',         'Tipos de boleta de cada evento (general, VIP, early bird).'],
    ['tickets',              'Boletas emitidas. Cada una con codigo + qr_token JWT.'],
    ['chat_channels',        'Canales del chat por evento. Filtrables por rol.'],
    ['chat_messages',        'Mensajes (texto + media_url para imagen/audio).'],
    ['speakers',             'Speakers del evento (referenciables desde agenda_sessions).'],
    ['agenda_sessions',      'Sesiones de la agenda con horario, sala y speaker.'],
    ['tareas',               'Kanban interno con asignación a user/rol.'],
    ['tarea_log',            'Trazabilidad de cambios y comentarios por tarea.'],
    ['payment_transactions', 'Histórico de pagos MP (kind: ticket | plan).'],
    ['email_log',            'Idempotencia de emails enviados (uniq ticket_id+tipo).'],
    ['push_subscriptions',   'PushSubscriptions de cada dispositivo del user.'],
    ['event_views',          'Tracking anónimo de visitas (hash IP+UA+día).'],
    ['categorias',           'Lookup table de categorías de eventos.'],
  ],
  [28, 72],
);

h2('Triggers y funciones SQL importantes');
[
  '**handle_new_user**: al crear usuario en `auth.users`, crea fila en `profiles` con datos del provider (Google OAuth o email).',
  '**sync_profile_from_auth_update**: cuando `user_metadata` cambia (ej. avatar), refleja en `profiles`.',
  '**seed_event_roles**: al insertar evento, crea los 6 roles default (Organizador, Producción, Soporte, Check-in, etc.).',
  '**seed_chat_channels**: al insertar evento, crea 4 canales default (General, Acceso, Logística, Atención).',
  '**find_pending_reminders**: usada por la Edge Function. Detecta tickets pagados que necesitan email de T-7d/T-1d/T-1h, sin duplicar.',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   6. FEATURES PARA ORGANIZADORES
   ════════════════════════════════════════════════════════════ */

h1('6. Features para organizadores');

h2('Workspace por evento');
p('Cada evento tiene 11 tabs:');
table(
  ['Tab', 'Funcionalidad'],
  [
    ['Resumen',         'Info general + equipo + toggle de recordatorios email'],
    ['Página pública',  'Editor visual con 16 bloques + 3 plantillas pre-armadas'],
    ['Equipo y roles',  'Invitar gente, asignar roles, gestionar permisos'],
    ['Chat',            'Canales texto/imagen/audio, filtrables por rol'],
    ['Tickets',         'Tipos de boleta con precio, cupo, early bird'],
    ['Agenda',          'Sesiones + speakers, vistas Lista/Semana/Mes'],
    ['Tareas',          'Kanban + Lista con asignación a user/rol'],
    ['Clientes',        'Lista de tickets emitidos + filtros + import CSV'],
    ['Check-in',        'Scanner QR + ingreso por código corto fallback'],
    ['Pagos',           'Vista de transacciones (futuro)'],
    ['Analytics',       'Visitas, conversión, ingresos, fuentes, daily chart'],
  ],
  [20, 80],
);

h2('Editor visual de página pública');
[
  '**16 tipos de bloques**: hero, texto, info, descripción, galería, tickets, ubicación con mapa, countdown, speakers, sponsors, redes, FAQ, CTA, cita, video, separador.',
  '**Drag & drop** con dnd-kit. Reordenamiento + duplicar + ocultar.',
  '**Multi-página**: tabs en el editor permiten múltiples páginas (Inicio + Speakers + Agenda + FAQ separadas, por ejemplo).',
  '**3 plantillas pre-armadas**: conferencia profesional, workshop práctico, fiesta/experiencia. Reemplazan bloques manteniendo los datos del evento.',
  '**Bloques de sistema**: leen automáticamente de los datos del evento (fecha, ubicación, tickets, galería) — no requieren configuración manual.',
].forEach(bullet);

h2('Pagos: dos modos');
[
  '**Modo integrado (recomendado)**: el organizador conecta su cuenta MP en Settings → Pagos. Los pagos van directo a su cuenta vía Checkout Pro. Webhook confirma automáticamente.',
  '**Modo manual** (organizadores chicos): pega su llave/alias MP o sube un QR. El asistente paga off-platform y el organizador confirma manualmente. Advertencia explícita de que no hay verificación automática.',
].forEach(bullet);

h2('Comunicación con asistentes');
[
  '**Email automático**: T-7d / T-1d / T-1h antes del evento. Toggle on/off por evento.',
  '**Web Push**: organizadores y team se suscriben desde Settings. Broadcast a todo el equipo desde el workspace (Pro).',
  '**Chat interno**: canales por rol, mensajes texto/imagen/audio.',
].forEach(bullet);

h2('Import / Export');
[
  '**Import CSV** de asistentes desde la tab Clientes: parser con auto-detección de separador, dedupe por email, generación de QR firmado.',
  '**Plantilla CSV descargable** con los campos esperados.',
  '**Export**: pendiente (en roadmap).',
].forEach(bullet);

h2('Analytics');
[
  '**Tracking anónimo** de visitas a `/explorar/:slug` (hash IP+UA+día, no PII).',
  '**KPIs**: visitas, visitantes únicos, conversión, ingresos, tasa de asistencia.',
  '**Breakdown** por fuente (direct / search / social / email), top referrers, ventas por tipo de boleta.',
  '**Chart** visitas vs tickets por día (7 / 30 / 90 días).',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   7. FEATURES PARA ASISTENTES
   ════════════════════════════════════════════════════════════ */

h1('7. Features para asistentes');

h2('Flujo de descubrimiento');
[
  '**Landing pública** con hero, marquee de eventos, planes y FAQ.',
  '**Explorar**: lista pública de todos los eventos publicados con filtros por ciudad y categoría.',
  '**Página de evento** (`/explorar/:slug`): renderiza los bloques que el organizador armó en el editor. Branding por evento.',
].forEach(bullet);

h2('Compra de boleta');
[
  '**Reservar gratis**: formulario simple (nombre, email, teléfono opcional). Ticket emitido en estado "pagado" con QR.',
  '**Pago con MP** (integrado): redirect a Checkout Pro de Mercado Pago. Al volver, ticket confirmado vía webhook.',
  '**Pago manual** (modo simple): se muestra la llave/QR del organizador con advertencia. El ticket queda en "emitido" hasta validación manual.',
].forEach(bullet);

h2('Mi boleta');
p('Cada ticket es accesible en `/mi-ticket/:codigo` sin necesidad de login.');
[
  '**QR grande** para escaneo en la entrada.',
  '**Código corto** alternativo (8 chars) por si el scanner falla.',
  '**Información del evento** (fecha, lugar, organizador) embebida.',
  '**Estado del ticket** (emitido / pagado / usado / cancelado).',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   8. PLANES
   ════════════════════════════════════════════════════════════ */

h1('8. Planes y monetización');

h2('Plan Free');
[
  'Eventos ilimitados.',
  'Asistentes ilimitados.',
  'Página pública con editor visual.',
  'QR check-in y check-out.',
  'Recordatorios email automáticos.',
  'Notificaciones push (al organizador y team).',
  'Multi-usuario y roles granulares.',
  'Import CSV de asistentes.',
  'Analytics básico.',
  'Mercado Pago integrado sin comisión de GESTEK.',
].forEach(bullet);

h2('Plan Pro — USD 19.99 / 30 días');
p('Pago único de 30 días vía Mercado Pago. Sin renovación automática.');
[
  'Todo lo del plan Free.',
  '**White-label completo** (sin marca GESTEK en públicas).',
  '**API REST + Webhooks** con HMAC y reintentos (en roadmap).',
  '**Dominio personalizado** (en roadmap).',
  '**Web push broadcast** a todo el equipo del evento.',
  '**Plantillas pro** de página pública.',
  '**Soporte prioritario**.',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   9. SETUP LOCAL
   ════════════════════════════════════════════════════════════ */

h1('9. Setup local');

h3('Requisitos');
[
  '**Node.js 18+** (necesario para fetch nativo en `lib/mercadopago.js`).',
  '**Cuenta Supabase** (free tier suficiente).',
  '**Opcional**: cuenta Resend (emails), cuenta Mercado Pago (pagos), Sentry (monitoreo).',
].forEach(bullet);

h3('Pasos');
p('1. Clonar el repo:');
codeBlock(`git clone https://github.com/Sekkon0906/GestorEventosMarcaBlanca.git
cd GestorEventosMarcaBlanca
npm install
cd frontend && npm install && cd ..`);

p('2. Crear proyecto en Supabase y aplicar migrations en orden:');
codeBlock(`# En el SQL editor de Supabase, ejecutar uno por uno:
db/migrations/0000_drop_legacy.sql
db/migrations/0001_init.sql
...
db/migrations/0019_pago_simple.sql`);

p('3. Configurar `.env` en raíz y `frontend/.env.local` (ver siguiente sección).');

p('4. Levantar backend y frontend:');
codeBlock(`# Terminal 1
node index.js

# Terminal 2
cd frontend && npm run dev`);

p('Backend en `http://localhost:3000`, frontend en `http://localhost:5173`.');

/* ════════════════════════════════════════════════════════════
   10. VARIABLES DE ENTORNO
   ════════════════════════════════════════════════════════════ */

h1('10. Variables de entorno');

h2('Backend (`.env` en raíz)');
table(
  ['Variable', 'Requerida', 'Descripción'],
  [
    ['SUPABASE_URL',              'Sí',     'URL del proyecto Supabase'],
    ['SUPABASE_SERVICE_KEY',      'Sí',     'Service role key (NO la anon)'],
    ['QR_JWT_SECRET',             'Sí',     'Secret para firmar QR de tickets'],
    ['FRONTEND_URL',              'Sí',     'http://localhost:5173 (dev) o tu dominio'],
    ['API_PUBLIC_URL',            'Pagos',  'URL pública del backend (cloudflared/dominio)'],
    ['MP_PLATFORM_ACCESS_TOKEN',  'Plan Pro','Access token MP de la cuenta GESTEK'],
    ['PLAN_PRO_PRICE',            'No',     'Precio del plan Pro (default 79900 COP)'],
    ['VAPID_PUBLIC_KEY',          'Push',   'Generar con web-push generateVAPIDKeys()'],
    ['VAPID_PRIVATE_KEY',         'Push',   'Generar con web-push generateVAPIDKeys()'],
    ['VAPID_CONTACT',             'Push',   'Email del admin (mailto:...)'],
    ['SENTRY_DSN',                'No',     'DSN de Sentry (si no, Sentry deshabilitado)'],
    ['ALLOW_DEV_PRO_ACTIVATION',  'Dev',    'true en dev para activar Pro sin MP'],
  ],
  [32, 18, 50],
);

h2('Frontend (`frontend/.env.local`)');
table(
  ['Variable', 'Descripción'],
  [
    ['VITE_SUPABASE_URL',       'Misma que el backend'],
    ['VITE_SUPABASE_ANON_KEY',  'Anon key del proyecto (NO service key)'],
    ['VITE_API_URL',            'URL del backend (default http://localhost:3000)'],
  ],
  [40, 60],
);

/* ════════════════════════════════════════════════════════════
   11. DESPLIEGUE
   ════════════════════════════════════════════════════════════ */

h1('11. Despliegue a producción');

h2('Recomendaciones por componente');
table(
  ['Componente', 'Proveedor recomendado'],
  [
    ['Backend',         'Railway / Render / Fly.io (Node 18+ con dotenv)'],
    ['Frontend',        'Vercel / Netlify (build estático de Vite)'],
    ['DB / Auth',       'Supabase (lo que ya usamos)'],
    ['Edge Functions',  'Supabase (con CLI: supabase functions deploy)'],
    ['Cron',            'Supabase pg_cron + pg_net'],
    ['Email',           'Resend (3K emails/mes free, USD 20 hasta 50K)'],
    ['Pagos',           'Mercado Pago (cuenta del organizador para tickets, GESTEK para plan Pro)'],
    ['Monitoreo',       'Sentry (free tier)'],
    ['Tunnel dev',      'cloudflared quick (gratis pero URL cambia)'],
  ],
  [25, 75],
);

h2('Checklist pre-launch');
[
  '☐ Migrations 0000–0019 aplicadas en Supabase.',
  '☐ Storage buckets `avatars` y `event-media` creados con policies de 0004/0005.',
  '☐ `ALLOW_DEV_PRO_ACTIVATION=false` en prod.',
  '☐ `MP_PLATFORM_ACCESS_TOKEN` de producción (no TEST-).',
  '☐ VAPID keys generadas con `node -e "console.log(require(\'web-push\').generateVAPIDKeys())"`.',
  '☐ `QR_JWT_SECRET` aleatorio ≥32 chars.',
  '☐ Edge Function `send-reminders` deployada + secret Resend configurado.',
  '☐ `pg_cron` schedule de recordatorios activado.',
  '☐ Dominio propio o tunnel estable para webhooks MP.',
  '☐ Sentry DSN configurado.',
  '☐ Términos, privacidad y aviso de cookies publicados.',
].forEach(bullet);

/* ════════════════════════════════════════════════════════════
   12. SEGURIDAD
   ════════════════════════════════════════════════════════════ */

h1('12. Seguridad');

h2('Stack incluido por defecto');
[
  '**helmet**: security headers (X-Frame-Options DENY, X-Content-Type-Options nosniff, HSTS en prod, referrer-policy).',
  '**CORS** con whitelist configurable por env. Permite requests sin Origin para webhooks MP.',
  '**Rate limiting**: 300 req/15min global + 20 req/15min en `/pagos/*` (más estricto). Skip en `/webhooks/*`.',
  '**Sanitización de body**: strip de caracteres de control Unicode, limit de 50K chars por campo string.',
  '**trust proxy: 1** para que rate limit funcione correctamente detrás de Cloudflare / Vercel.',
  '**RLS de Supabase** en TODAS las tablas. El frontend usa anon key + RLS, el backend usa service_role solo cuando hace falta.',
  '**QR tokens firmados** con JWT HS256. Validables sin DB lookup.',
  '**Idempotencia** en webhooks MP (unique payment_id) y emails (unique ticket_id+tipo).',
].forEach(bullet);

callout('Importante en producción',
  'Verificar la firma del webhook de Mercado Pago (header x-signature) antes de procesar el pago. Sin esto, cualquiera podría llamar a /webhooks/mercadopago y activar tickets falsos. Pendiente en roadmap.',
  '#DC2626',
);

/* ════════════════════════════════════════════════════════════
   13. ESTADO ACTUAL Y PRÓXIMOS PASOS
   ════════════════════════════════════════════════════════════ */

h1('13. Estado actual y próximos pasos');

p('La plataforma está **operativa end-to-end**: un organizador puede crear evento, configurar pagos, vender boletas, comunicarse con asistentes y hacer check-in. Quedan features de pulido y diferenciadores Pro.');

h2('Sprint recomendado (próximas ~9 horas de trabajo)');
table(
  ['#', 'Tarea', 'Tiempo', 'Por qué'],
  [
    ['1',  'White-label en públicas',                  '30 min', 'Alto impacto visual diferenciador'],
    ['2',  'Notificaciones in-app realtime',           '1.5h',   'Los usuarios esperan eso'],
    ['3',  'Webhook MP signature verification',        '30 min', 'Security crítico antes de prod'],
    ['4',  'Exportar CSV',                             '30 min', 'Cualquier organizador lo pide'],
    ['5',  'Code splitting + lazy load',               '1h',     'Performance perceptible'],
    ['6',  'Términos + Privacidad + Cookies',          '1h',     'Requisito legal'],
    ['7',  'Listas de espera',                         '1.5h',   'Feature Free pendiente'],
    ['8',  'manifest.json + íconos PWA',               '30 min', 'Habilita instalación móvil'],
    ['9',  'README + DEPLOYMENT docs',                 '1h',     'Onboarding de colaboradores'],
    ['10', 'Eliminar mocks + limpieza',                '45 min', 'Reduce confusión'],
  ],
  [6, 50, 14, 30],
);

h2('Features grandes pendientes');
[
  '**API REST pública** + Webhooks con HMAC y reintentos (diferenciador Pro).',
  '**Agente IA** que crea eventos según contexto (diferenciador Pro).',
  '**Dominio personalizado** por organizador (diferenciador Pro).',
  '**Listas de espera** automáticas (plan Free).',
  '**Gamificación**: puntos, badges, ranking (tablas existen, sin UI).',
  '**Auditoría** completa de acciones del equipo.',
  '**Suite de tests** con Vitest + Playwright.',
].forEach(bullet);

doc.moveDown(2);
p('—', { align: 'center', color: C.muted });
p('Documento generado automáticamente desde el código fuente.', { align: 'center', color: C.muted, italic: true, size: 9 });
p('github.com/Sekkon0906/GestorEventosMarcaBlanca', { align: 'center', color: C.muted, italic: true, size: 9 });

/* ════════════════════════════════════════════════════════════
   FOOTER en todas las páginas (excepto portada)
   ════════════════════════════════════════════════════════════ */

const range = doc.bufferedPageRange();
for (let i = 1; i < range.count; i++) { // skip portada (i=0)
  doc.switchToPage(i);
  doc.fillColor(C.muted).font('Helvetica').fontSize(8);
  doc.text(`GESTEK Event OS — Documentación`, M, PAGE.h - 30, { lineBreak: false, width: W / 2 });
  doc.text(`${i + 1} / ${range.count}`, M + W / 2, PAGE.h - 30, { lineBreak: false, width: W / 2, align: 'right' });
}

doc.end();
console.log('OK →', out);
