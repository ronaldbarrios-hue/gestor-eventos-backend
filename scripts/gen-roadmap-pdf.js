/* Genera GESTEK-Roadmap-Pendientes.pdf con pdfkit (pure JS, sin browser). */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const COLORS = {
  blue   : '#3B82F6',
  purple : '#8B5CF6',
  dark   : '#0F172A',
  text   : '#1E293B',
  muted  : '#64748B',
  bgRow  : '#F8FAFC',
  border : '#E2E8F0',
  white  : '#FFFFFF',
  code   : '#0F766E',
  success: '#059669',
  warning: '#D97706',
  danger : '#DC2626',
};

const PAGE = { w: 595, h: 842 }; // A4 pt
const MARGIN = 50;
const CONTENT_W = PAGE.w - MARGIN * 2;

const out = path.join(__dirname, '..', 'docs', 'GESTEK-Roadmap-Pendientes.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  info: {
    Title: 'GESTEK — Roadmap pendientes',
    Author: 'GESTEK',
    Subject: 'Inventario de pendientes, ideas y consideraciones tras la fase 3.',
  },
});

doc.pipe(fs.createWriteStream(out));

/* ───── helpers ───── */

function ensureSpace(needed = 80) {
  if (doc.y + needed > PAGE.h - MARGIN) {
    doc.addPage();
  }
}

function h1(text) {
  ensureSpace(80);
  doc.moveDown(0.5);
  doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(28).text(text);
  doc.moveDown(0.4);
}

function h2(text, emoji = '') {
  ensureSpace(80);
  doc.moveDown(0.6);
  const full = emoji ? `${emoji}  ${text}` : text;
  doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(18).text(full);
  /* línea decorativa */
  const lineY = doc.y + 4;
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + 60, lineY).lineWidth(2).strokeColor(COLORS.blue).stroke();
  doc.moveDown(0.6);
}

function h3(text) {
  ensureSpace(50);
  doc.moveDown(0.4);
  doc.fillColor(COLORS.purple).font('Helvetica-Bold').fontSize(13).text(text);
  doc.moveDown(0.3);
}

function paragraph(text, opts = {}) {
  ensureSpace(40);
  doc.fillColor(opts.color || COLORS.text)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 10)
    .text(text, { align: opts.align || 'left', paragraphGap: 6, lineGap: 2 });
}

/* Bullet con soporte para **bold** y `code` inline. */
function bullet(text) {
  ensureSpace(30);
  const tokens = parseInline(text);
  const bulletX = MARGIN;
  const textX = MARGIN + 14;
  const startY = doc.y;

  doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(10).text('•', bulletX, startY, { lineBreak: false, continued: false });

  doc.x = textX;
  doc.y = startY;

  tokens.forEach((tok, i) => {
    const isLast = i === tokens.length - 1;
    let font = 'Helvetica';
    let color = COLORS.text;
    let size = 10;
    if (tok.type === 'bold') font = 'Helvetica-Bold';
    if (tok.type === 'code') { font = 'Courier'; color = COLORS.code; size = 9; }
    doc.fillColor(color).font(font).fontSize(size).text(tok.text, {
      continued: !isLast,
      width: CONTENT_W - 14,
      paragraphGap: 4,
      lineGap: 2,
    });
  });
}

function parseInline(text) {
  const out = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'normal', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) });
    else                     out.push({ type: 'code', text: tok.slice(1, -1) });
    last = regex.lastIndex;
  }
  if (last < text.length) out.push({ type: 'normal', text: text.slice(last) });
  return out;
}

/* Tabla con header coloreado y filas alternadas. */
function table(headers, rows, colWidths) {
  /* Normaliza widths a porcentajes de CONTENT_W */
  const totalWeight = colWidths.reduce((a, b) => a + b, 0);
  const widths = colWidths.map(w => (w / totalWeight) * CONTENT_W);

  /* Header */
  ensureSpace(40 + rows.length * 22);
  const headerY = doc.y;
  const headerH = 22;

  doc.rect(MARGIN, headerY, CONTENT_W, headerH).fill(COLORS.blue);

  let x = MARGIN;
  headers.forEach((h, i) => {
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(10)
      .text(h, x + 8, headerY + 6, { width: widths[i] - 16, lineBreak: false, ellipsis: true });
    x += widths[i];
  });

  doc.y = headerY + headerH;

  /* Filas */
  rows.forEach((row, idx) => {
    /* Calcula la altura máxima necesaria para esta fila */
    let maxH = 18;
    row.forEach((cellText, i) => {
      const text = String(cellText);
      const h = doc.font('Helvetica').fontSize(9.5).heightOfString(text, { width: widths[i] - 16 });
      if (h + 10 > maxH) maxH = h + 10;
    });

    /* Salto de página si no entra */
    if (doc.y + maxH > PAGE.h - MARGIN) {
      doc.addPage();
      /* Re-dibuja header en la nueva página */
      const newHeaderY = doc.y;
      doc.rect(MARGIN, newHeaderY, CONTENT_W, headerH).fill(COLORS.blue);
      let xh = MARGIN;
      headers.forEach((h, i) => {
        doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(10)
          .text(h, xh + 8, newHeaderY + 6, { width: widths[i] - 16, lineBreak: false, ellipsis: true });
        xh += widths[i];
      });
      doc.y = newHeaderY + headerH;
    }

    const rowY = doc.y;
    /* Fondo alternado */
    if (idx % 2 === 0) doc.rect(MARGIN, rowY, CONTENT_W, maxH).fill(COLORS.bgRow);

    /* Bordes laterales y inferior */
    doc.strokeColor(COLORS.border).lineWidth(0.5);
    doc.moveTo(MARGIN, rowY + maxH).lineTo(MARGIN + CONTENT_W, rowY + maxH).stroke();

    let cx = MARGIN;
    row.forEach((cellText, i) => {
      const text = String(cellText);
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(9.5)
        .text(text, cx + 8, rowY + 6, { width: widths[i] - 16 });
      cx += widths[i];
    });

    doc.y = rowY + maxH;
  });

  /* Bordes exteriores de la tabla */
  doc.strokeColor(COLORS.border).lineWidth(0.5)
    .rect(MARGIN, headerY, CONTENT_W, doc.y - headerY).stroke();

  doc.moveDown(0.8);
}

/* ───── PORTADA ───── */

doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(42)
  .text('GESTEK Event OS', MARGIN, 180, { align: 'center', width: CONTENT_W });

doc.fillColor(COLORS.purple).font('Helvetica').fontSize(22)
  .text('Roadmap — pendientes, ideas\ny consideraciones', { align: 'center', width: CONTENT_W });

doc.moveDown(2);
doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(11)
  .text('Versión post-fase 3 · 16 de mayo, 2026', { align: 'center' });

doc.moveDown(4);
doc.fillColor(COLORS.text).font('Helvetica').fontSize(11)
  .text(
    'Inventario completo de lo que falta implementar, decisiones operativas pendientes, ' +
    'deuda técnica, ideas de producto y nice-to-haves.',
    MARGIN + 60, doc.y, { align: 'center', width: CONTENT_W - 120, lineGap: 4 },
  );

/* Tabla de contenidos rápida */
doc.moveDown(4);
doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(10).text('CONTENIDO', { align: 'center' });
doc.moveDown(0.5);
const tocItems = [
  '1.  Features del roadmap original que faltan',
  '2.  Cosas operativas pendientes',
  '3.  Seguridad / production hardening',
  '4.  UX / visual gaps',
  '5.  Performance',
  '6.  Tech debt',
  '7.  PWA / mobile',
  '8.  Compliance / legal',
  '9.  Monetización extras',
  '10. Testing y CI',
  '11. Documentación faltante',
  '12. Ideas / nice-to-haves',
  '13. Orden recomendado para próximas sesiones',
];
tocItems.forEach(item => {
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(10)
    .text(item, MARGIN + 120, doc.y, { width: CONTENT_W - 240, lineGap: 4 });
});

/* ───── CONTENIDO ───── */

doc.addPage();

h2('1. Features del roadmap original que faltan', '🚧');

h3('Plan Free (prometido en PlanesPage)');
table(
  ['Feature', 'Prioridad', 'Esfuerzo', 'Estado'],
  [
    ['Listas de espera automáticas',            'Alta',  '~1.5h',   'Tabla no existe'],
    ['Notificaciones in-app realtime',          'Alta',  '~1.5h',   'TopBar tiene mock'],
    ['Exportar asistentes CSV',                 'Alta',  '~30min',  'No empezado'],
    ['Gamificación: puntos / badges / ranking', 'Media', '~3-4h',   'Tablas existen, sin UI'],
    ['Recordatorios in-app',                    'Baja',  '~1h',     'Solo existe por email'],
  ],
  [40, 15, 18, 27],
);

h3('Plan Pro (diferenciadores)');
table(
  ['Feature', 'Prioridad', 'Esfuerzo', 'Estado'],
  [
    ['White-label en páginas públicas',                'Alta',  '~30min', 'Branding se guarda, no se aplica'],
    ['API REST pública + Webhooks HMAC + reintentos',  'Media', '~4h',    'No empezado'],
    ['Auditoría de acciones del equipo',               'Media', '~1.5h',  'Solo hay tarea_log'],
    ['Agente IA crea eventos según contexto',          'Baja',  '~2-3h',  'No empezado'],
    ['Dominio personalizado',                          'Baja',  '~3-4h',  'No empezado'],
    ['Más plantillas de página pública',               'Baja',  '~1h',    'Hay 3 templates'],
  ],
  [40, 15, 18, 27],
);

h2('2. Cosas operativas pendientes', '🛠');
table(
  ['Tarea', 'Bloquea', 'Costo'],
  [
    ['Aplicar migrations 0014–0019 en Supabase',         'Pagos / Analytics / Push / Recordatorios', '5 min'],
    ['Deploy Edge Function send-reminders + Resend + pg_cron', 'Recordatorios email',                '30 min'],
    ['MP credentials de producción (con dominio verificado)',  'Cobros reales',                      'Variable (KYC)'],
    ['Set ALLOW_DEV_PRO_ACTIVATION=false en prod',       'Seguridad',                                '5 seg'],
    ['Named tunnel con dominio (o ngrok pago)',          'Webhooks consistentes en dev',             'Si comprás dominio'],
    ['Verificar VAPID push en Firefox, iOS PWA',         'Push universal',                           '30 min'],
  ],
  [45, 35, 20],
);

h2('3. Seguridad / Production hardening', '🔐');
table(
  ['Issue', 'Riesgo', 'Fix'],
  [
    ['Tunnel cloudflared quick',                   'URL cambia cada restart',                 'Named tunnel con dominio'],
    ['MP_PLATFORM_ACCESS_TOKEN en .env plano',     'Filtración compromete cobros Pro',        'Vault / secret manager en prod'],
    ['CSP desactivado',                            'XSS no mitigado',                         'Configurar CSP en prod'],
    ['Sin rotación de QR_JWT_SECRET',              'Si se filtra, falsificás tickets',        'Documentar rotación'],
    ['Webhook MP sin verificación de firma',       'Spoof activa tickets falsos',             'Validar x-signature header MP'],
    ['Sin captcha en reservas públicas',           'Bots de reserva',                         'hCaptcha o Cloudflare Turnstile'],
    ['Storage policies no auditadas',              'Acceso cross-organizador a galería',      'Revisar policies event-media'],
    ['avatar_url externo sin sanitizar',           'Phishing via URL maliciosa',              'Validar dominios permitidos'],
    ['Sin límite de tickets por email',            'Un email reserva 1000 y rompe aforo',     'Rate limit por email + captcha'],
  ],
  [35, 35, 30],
);

h2('4. UX / Visual gaps', '🎨');

h3('Pendientes claros');
[
  'Confirmación visual cuando MP marca un ticket como pagado.',
  'Empty state en Chat cuando no hay canales.',
  'Loading skeletons en lugar de "Cargando..." en algunas tabs.',
  'Toast de éxito al guardar branding queda apretado.',
  'Indicador visual de evento borrador vs publicado en EventCard.',
].forEach(b => bullet(b));

h3('Mobile UI (deep dive pendiente)');
[
  'PageBuilder en mobile: bloques no scrollean bien.',
  'TareasTab Kanban en mobile (4 columnas en pantalla chica).',
  'AnalyticsTab chart en pantallas <400px.',
  'Modales muy altos (BroadcastModal, ImportModal) bloquean teclado virtual.',
].forEach(b => bullet(b));

h3('Accesibilidad');
[
  'Faltan **aria-label** en muchos botones de icono.',
  'Contraste text-3 contra surface es bajo (WCAG AA falla).',
  'No hay skip-to-content link.',
  'Modales no atrapan focus.',
  'Sin soporte para **prefers-reduced-motion**.',
].forEach(b => bullet(b));

h2('5. Performance', '⚡');
table(
  ['Issue', 'Impacto', 'Fix'],
  [
    ['Bundle JS de 1.25MB',                       'First load lento',                'Code splitting con React.lazy() por ruta'],
    ['Imágenes sin lazy load',                    'Carga lenta con muchos eventos',  'loading="lazy" en <img>'],
    ['Sin caché de queries del backend',          'Cada navegación rehace queries',  'React Query o SWR'],
    ['GLoader anima durante 4s mínimo',           'Sensación de lentitud',           'Reducir min display time'],
    ['Sin imagen optimization',                   'Cover URLs cargan tamaño full',   'Supabase image transforms'],
    ['Sin compresión gzip/br',                    'API responses más grandes',       'compression middleware'],
  ],
  [30, 30, 40],
);

h2('6. Tech debt', '📋');
[
  '**0 tests** (la suite de misael fue removida) → refactors riesgosos.',
  '**No hay logger estructurado** (solo console.log) → difícil debug en prod.',
  '**JWT_SECRET en package.json pero no usado** → confusión.',
  '**Migrations no son idempotentes 100%** → re-correrlas puede fallar.',
  '**page_json jsonb sin validación de schema** → blocks corruptos rompen frontend.',
  '**Bell icon mock en TopBar** → mockup que parece feature real.',
  '**PlaceholderTab.jsx solo usado para Pagos** que ya no es placeholder → inconsistencia.',
  '**Comentarios "Fase X" dispersos en código** → ruido.',
  '**Algunos useEffect sin cleanup** → memory leaks potenciales.',
  '**Duplicación de íconos SVG inline** en cada componente.',
].forEach(b => bullet(b));

h2('7. PWA / Mobile', '📱');
table(
  ['Feature', 'Estado'],
  [
    ['manifest.json',                          'No existe — sin él no se puede instalar como PWA'],
    ['Icons (192/512/maskable)',               'Solo logo SVG, faltan PNGs estándar'],
    ['Service Worker para offline',            'Solo handles push, no cachea assets'],
    ['iOS Safari push',                        'Requiere PWA al home screen (no documentado)'],
    ['Touch gestures (swipe entre tabs)',      'No implementado'],
  ],
  [30, 70],
);

h2('8. Compliance / Legal', '⚖');
table(
  ['Item', 'Crítico para'],
  [
    ['Términos y condiciones',                       'Operar comercialmente'],
    ['Política de privacidad',                       'Habeas Data Colombia, GDPR si tenés EU'],
    ['Aviso de cookies',                             'Cumplimiento europeo'],
    ['Acuerdo de procesamiento de pagos',            'Cuando uses MP en prod'],
    ['Exportar datos del usuario',                   'Habeas Data — derecho ARCO'],
    ['Borrar cuenta + cascada de datos',             'Habeas Data — derecho al olvido'],
    ['Logs de retención configurables',              'GDPR / HD'],
  ],
  [40, 60],
);

h2('9. Monetización extras', '💰');
[
  '**Comisión opcional por venta** (tomar 1-3% de tickets como GESTEK).',
  '**Plan Enterprise** (custom pricing, white-label completo, SLA).',
  '**Add-ons puntuales**: 1.000 emails extra, dominio gratis, etc.',
  '**Anual con descuento** (volver el toggle anual con 30% off).',
  '**Referidos** (organizador trae a otro = mes gratis).',
  '**Marketplace de plantillas** (vender páginas pre-diseñadas).',
].forEach(b => bullet(b));

h2('10. Testing y CI', '🧪');
table(
  ['Tipo', 'Propuesta'],
  [
    ['Unit tests',         'Vitest para lib/ (qr, slug, mercadopago)'],
    ['Integration tests',  'Supertest contra routes/* con Supabase test project'],
    ['E2E',                'Playwright (signup → crear → reservar → check-in)'],
    ['CI',                 'GitHub Actions: lint + tests + build en cada PR'],
    ['Lint',               'ESLint + Prettier (no veo configurado)'],
    ['Type safety',        'Migrar gradualmente a TypeScript (lib/ y routes/ primero)'],
  ],
  [25, 75],
);

h2('11. Documentación faltante', '📚');
[
  '**README** principal con setup completo (hoy está mínimo).',
  '**CONTRIBUTING.md** si va a haber más colaboradores.',
  '**API.md** con todos los endpoints (Swagger / OpenAPI ideal).',
  '**DEPLOYMENT.md** con guía Vercel + Supabase + cloudflared/dominio + MP.',
  '**TROUBLESHOOTING.md** con problemas conocidos (sandbox MP CO, etc).',
  '**CHANGELOG.md** versionado semántico.',
].forEach(b => bullet(b));

h2('12. Ideas / Nice-to-haves', '💡');

h3('Producto');
[
  'Templates de email personalizables por organizador.',
  'Stripe como alternativa a MP (mercados sin MP).',
  'Multi-idioma (i18n) — gran asset para CO + AR + MX.',
  'Modo oscuro/claro toggle (hoy es solo dark).',
  'Búsqueda full-text de eventos públicos (Postgres FTS).',
  'Mapa interactivo de eventos cercanos en /explorar.',
  'Insignias automáticas ("Primer evento", "100 asistentes").',
  'Embeds: organizador embebe widget del evento en su web.',
  'Cancelación de eventos con notificación masiva + reembolso automático.',
  'Reembolsos parciales via MP.',
  'Códigos de descuento (la tabla existe, no hay UI).',
  'Early bird funciona en backend, UI no resalta cuando aplica.',
  'Múltiples sesiones por evento (festival con varios días).',
  'Speakers compartidos entre eventos del mismo owner.',
].forEach(b => bullet(b));

h3('Operacional');
[
  'Health check completo (/health debería chequear DB + Supabase + MP).',
  'Métricas Prometheus / DataDog opcional.',
  'Sentry alerts configuradas con thresholds.',
  'Backup automático de la DB (verificar point-in-time de Supabase).',
  'Modo mantenimiento togglable.',
].forEach(b => bullet(b));

h3('Equipo / colaboración');
[
  'Comentarios en tareas (existe en backend, no en UI completa).',
  'Menciones **@usuario** en chat que disparen notificación.',
  'Reacciones a mensajes del chat.',
  'Pin de mensajes importantes en canales.',
].forEach(b => bullet(b));

h2('13. Orden recomendado para próximas sesiones', '🎯');
paragraph('Por bang-for-buck, si tuviera que elegir el siguiente sprint iría en este orden:', { color: COLORS.muted });
doc.moveDown(0.3);

table(
  ['#', 'Tarea', 'Tiempo', 'Por qué'],
  [
    ['1',  'White-label en páginas públicas',         '30 min', 'Alto impacto visual diferenciador'],
    ['2',  'Notificaciones in-app realtime',          '1.5h',   'Los usuarios esperan eso'],
    ['3',  'Webhook MP signature verification',       '30 min', 'Security crítico antes de prod'],
    ['4',  'Exportar CSV',                            '30 min', 'Cualquier organizador lo pide'],
    ['5',  'Code splitting + lazy load',              '1h',     'Performance perceptible'],
    ['6',  'Términos + Privacidad + Cookies',         '1h',     'Requisito legal para operar'],
    ['7',  'Listas de espera',                        '1.5h',   'Feature Free pendiente'],
    ['8',  'manifest.json + íconos PWA',              '30 min', 'Habilita instalación móvil'],
    ['9',  'README + DEPLOYMENT docs',                '1h',     'Onboarding de colaboradores'],
    ['10', 'Eliminar mocks + limpieza general',       '45 min', 'Reduce confusión'],
  ],
  [6, 50, 14, 30],
);

doc.moveDown(0.5);
paragraph('Total ~9 horas = una semana de sesiones de ~1.5h.', { bold: true, color: COLORS.dark });

/* ───── FIN ───── */

doc.end();
console.log('OK →', out);
