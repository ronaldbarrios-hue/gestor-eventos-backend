/* Genera GESTEK-Roadmap-Pendientes.docx con la lista de pendientes/ideas/etc.
   Uso: node scripts/gen-roadmap-docx.js */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak,
} = require('docx');

const BLUE   = '3B82F6';
const PURPLE = '8B5CF6';
const DARK   = '0F172A';
const GRAY   = '64748B';
const LIGHT  = 'F1F5F9';

/* ───── helpers ───── */
const t = (text, opts = {}) => new TextRun({ text, font: 'Calibri', size: 22, ...opts });
const p = (children, opts = {}) => new Paragraph({ children, spacing: { after: 100 }, ...opts });

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 300, after: 200 },
  children: [new TextRun({ text, font: 'Calibri', size: 36, bold: true, color: BLUE })],
});
const h2 = (text, emoji = '') => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 140 },
  children: [new TextRun({ text: `${emoji} ${text}`, font: 'Calibri', size: 28, bold: true, color: DARK })],
});
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: PURPLE })],
});

const bullet = (text, opts = {}) => new Paragraph({
  bullet: { level: 0 },
  spacing: { after: 60 },
  children: parseInline(text, opts),
});

/* parser sencillo de **bold** y `code` para los bullets */
function parseInline(text, baseOpts = {}) {
  const out = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: 'Calibri', size: 22, ...baseOpts }));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(new TextRun({ text: token.slice(2, -2), font: 'Calibri', size: 22, bold: true, ...baseOpts }));
    } else {
      out.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas', size: 20, color: '0F766E', ...baseOpts }));
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: 'Calibri', size: 22, ...baseOpts }));
  return out.length ? out : [new TextRun({ text, font: 'Calibri', size: 22, ...baseOpts })];
}

const cell = (text, opts = {}) => new TableCell({
  width: { size: opts.width || 0, type: WidthType.AUTO },
  shading: opts.bg ? { type: ShadingType.CLEAR, fill: opts.bg } : undefined,
  children: [new Paragraph({
    children: parseInline(String(text), opts.color ? { color: opts.color } : {}),
    spacing: { before: 60, after: 60 },
  })],
});

const headerCell = (text) => new TableCell({
  shading: { type: ShadingType.CLEAR, fill: BLUE },
  children: [new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 22, bold: true, color: 'FFFFFF' })],
    spacing: { before: 80, after: 80 },
  })],
});

function table(headers, rows, colWidths = []) {
  const totalCols = headers.length;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top   : { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      left  : { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      right : { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical  : { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
    rows: [
      new TableRow({ children: headers.map(h => headerCell(h)), tableHeader: true }),
      ...rows.map((row, i) => new TableRow({
        children: row.map((val, idx) => cell(val, {
          bg: i % 2 === 0 ? 'F8FAFC' : 'FFFFFF',
          width: colWidths[idx],
        })),
      })),
    ],
  });
}

/* ───── contenido ───── */

const children = [];

// Portada
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 1200, after: 200 },
  children: [new TextRun({ text: 'GESTEK Event OS', font: 'Calibri', size: 56, bold: true, color: BLUE })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: 'Roadmap — pendientes, ideas y consideraciones', font: 'Calibri', size: 32, color: PURPLE })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: 'Versión post-fase 3 · 16 de mayo, 2026', font: 'Calibri', size: 22, color: GRAY, italics: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 600, after: 200 },
  children: [new TextRun({
    text: 'Inventario completo de lo que falta implementar, decisiones operativas pendientes, deuda técnica, ideas de producto y nice-to-haves.',
    font: 'Calibri', size: 22, color: GRAY,
  })],
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 1. Roadmap original pendiente ── */
children.push(h2('Features del roadmap original que faltan', '🚧'));

children.push(h3('Plan Free (prometido en PlanesPage)'));
children.push(table(
  ['Feature', 'Prioridad', 'Esfuerzo', 'Estado'],
  [
    ['Listas de espera automáticas',            'Alta',  '~1.5h',   'Tabla no existe'],
    ['Notificaciones in-app realtime',          'Alta',  '~1.5h',   'TopBar tiene mock'],
    ['Exportar asistentes CSV',                 'Alta',  '~30min',  'No empezado'],
    ['Gamificación: puntos / badges / ranking', 'Media', '~3-4h',   'Tablas existen, sin UI'],
    ['Recordatorios in-app',                    'Baja',  '~1h',     'Solo existe por email'],
  ],
));

children.push(h3('Plan Pro (diferenciadores)'));
children.push(table(
  ['Feature', 'Prioridad', 'Esfuerzo', 'Estado'],
  [
    ['White-label en páginas públicas',                'Alta',  '~30min', 'Se guarda branding, no se aplica'],
    ['API REST pública + Webhooks HMAC + reintentos',  'Media', '~4h',    'No empezado'],
    ['Auditoría de acciones del equipo',               'Media', '~1.5h',  'Solo hay tarea_log'],
    ['Agente IA crea eventos según contexto',          'Baja',  '~2-3h',  'No empezado'],
    ['Dominio personalizado (eventos.tudominio.com)',  'Baja',  '~3-4h',  'No empezado'],
    ['Más plantillas de página pública',               'Baja',  '~1h',    'Hay 3 templates'],
  ],
));

/* ── 2. Operativos ── */
children.push(h2('Cosas operativas pendientes', '🛠'));
children.push(table(
  ['Tarea', 'Bloquea', 'Costo'],
  [
    ['Aplicar migrations 0014–0019 en Supabase',         'Pagos/Analytics/Push/Recordatorios', '5 min'],
    ['Deploy Edge Function send-reminders + Resend + pg_cron', 'Recordatorios email',           '30 min'],
    ['MP credentials de producción (con dominio verificado)',  'Cobros reales',                 'Variable (KYC)'],
    ['Set ALLOW_DEV_PRO_ACTIVATION=false en prod',       'Seguridad',                          '5 seg'],
    ['Named tunnel con dominio (o ngrok pago)',          'Webhooks consistentes',              'Si comprás dominio'],
    ['Verificar VAPID push en Firefox, iOS PWA',         'Push universal',                     '30 min'],
  ],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 3. Seguridad ── */
children.push(h2('Seguridad / Production hardening', '🔐'));
children.push(table(
  ['Issue', 'Riesgo', 'Fix'],
  [
    ['Tunnel cloudflared quick',                        'URL cambia cada restart',                     'Named tunnel con dominio'],
    ['MP_PLATFORM_ACCESS_TOKEN en .env plano',          'Filtración compromete cobros Pro',            'Vault / secret manager prod'],
    ['CSP desactivado en config/security.js',           'XSS no mitigado',                             'Configurar CSP en prod'],
    ['Sin rotación de QR_JWT_SECRET',                   'Si se filtra, falsificás tickets',            'Documentar rotación'],
    ['Webhook MP sin verificación de firma',            'Spoof del webhook activa tickets falsos',     'Validar x-signature header MP'],
    ['Sin captcha en reservas públicas',                'Bots de reserva',                             'hCaptcha o Cloudflare Turnstile'],
    ['Storage policies de Supabase no auditadas',       'Acceso cross-organizador a galería',          'Revisar policies event-media'],
    ['avatar_url externo sin sanitizar',                'Phishing via URL maliciosa',                  'Validar dominios permitidos'],
    ['Sin límite de tickets por email',                 'Un asistente reserva 1000 y rompe aforo',     'Rate limit por email + captcha'],
  ],
));

/* ── 4. UX/Visual ── */
children.push(h2('UX / Visual gaps', '🎨'));

children.push(h3('Pendientes claros'));
[
  'Confirmación visual cuando MP marca un ticket como pagado',
  'Empty state en Chat cuando no hay canales',
  'Loading skeletons en lugar de "Cargando..." en algunas tabs',
  'Toast de éxito al guardar branding queda apretado',
  'Indicador visual de evento borrador vs publicado en EventCard',
].forEach(b => children.push(bullet(b)));

children.push(h3('Mobile UI (deep dive pendiente)'));
[
  'PageBuilder en mobile: bloques no scrollean bien',
  'TareasTab Kanban en mobile (4 columnas en pantalla chica)',
  'AnalyticsTab chart en pantallas <400px',
  'Modales muy altos (BroadcastModal, ImportModal) bloquean teclado virtual',
].forEach(b => children.push(bullet(b)));

children.push(h3('Accesibilidad'));
[
  'Faltan aria-label en muchos botones de icono',
  'Contraste text-3 contra surface es bajo (WCAG AA falla)',
  'No hay skip-to-content link',
  'Modales no atrapan focus',
  'Sin soporte para prefers-reduced-motion',
].forEach(b => children.push(bullet(b)));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 5. Performance ── */
children.push(h2('Performance', '⚡'));
children.push(table(
  ['Issue', 'Impacto', 'Fix'],
  [
    ['Bundle JS de 1.25MB',                       'First load lento',                'Code splitting con React.lazy() por ruta'],
    ['Imágenes sin lazy load en EventsListPage',  'Carga lenta con muchos eventos',  'loading="lazy" en <img>'],
    ['Sin caché de queries del backend',          'Cada navegación rehace queries',  'React Query o SWR'],
    ['GLoader anima durante 4s mínimo',           'Sensación de lentitud',           'Reducir min display time'],
    ['Sin imagen optimization',                   'Cover URLs cargan tamaño full',   'Supabase image transforms o Cloudinary'],
    ['Sin compresión gzip/br configurada',        'API responses más grandes',       'compression middleware'],
  ],
));

/* ── 6. Tech debt ── */
children.push(h2('Tech debt', '📋'));
[
  '**0 tests** (la suite de misael fue removida) → refactors riesgosos.',
  '**No hay logger estructurado** (solo `console.log`) → difícil debug en prod.',
  '**`process.env.JWT_SECRET` heredado en package.json pero no usado** → confusión.',
  '**Migrations no son idempotentes 100%** → re-correrlas puede fallar.',
  '**`page_json` jsonb sin validación de schema** → blocks corruptos pueden romper frontend.',
  '**Bell icon mock en TopBar** → mockup que parece feature real.',
  '**`PlaceholderTab.jsx` solo usado para Pagos** que ya no es placeholder → inconsistencia.',
  '**Comentarios `Fase X` dispersos en código** → ruido.',
  '**Algunos `useEffect` sin cleanup** → memory leaks potenciales.',
  '**Duplicación de íconos SVG inline** en cada componente → mejor `<Icon name="..." />` central.',
].forEach(b => children.push(bullet(b)));

/* ── 7. PWA/Mobile ── */
children.push(h2('PWA / Mobile', '📱'));
children.push(table(
  ['Feature', 'Estado'],
  [
    ['manifest.json',                          'No existe — sin él no se puede instalar como PWA'],
    ['Icons (192/512/maskable)',               'Solo logo SVG, faltan PNGs estándar'],
    ['Service Worker para offline',            'Solo handles push, no cachea assets'],
    ['iOS Safari push',                        'Requiere PWA al home screen (no documentado al user)'],
    ['Touch gestures (swipe entre tabs)',      'No implementado'],
  ],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 8. Compliance ── */
children.push(h2('Compliance / Legal', '⚖️'));
children.push(table(
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
));

/* ── 9. Monetización ── */
children.push(h2('Monetización extras', '💰'));
[
  '**Comisión opcional por venta** (1-3% de tickets como GESTEK)',
  '**Plan Enterprise** (custom pricing, white-label completo, SLA)',
  '**Add-ons puntuales**: 1.000 emails extra, dominio gratis, etc.',
  '**Anual con descuento** (volver el toggle anual con 30% off)',
  '**Referidos** (organizador trae a otro = mes gratis)',
  '**Marketplace de plantillas** (vender páginas pre-diseñadas)',
].forEach(b => children.push(bullet(b)));

/* ── 10. Testing/CI ── */
children.push(h2('Testing y CI', '🧪'));
children.push(table(
  ['Tipo', 'Propuesta'],
  [
    ['Unit tests',         'Vitest para lib/ (qr, slug, mercadopago)'],
    ['Integration tests',  'Supertest contra routes/* con Supabase test project'],
    ['E2E',                'Playwright para flujos críticos (signup → crear → reservar → check-in)'],
    ['CI',                 'GitHub Actions: lint + tests + build en cada PR'],
    ['Lint',               'ESLint + Prettier (no veo configurado)'],
    ['Type safety',        'Migrar gradualmente a TypeScript (lib/ y routes/ primero)'],
  ],
));

/* ── 11. Documentación ── */
children.push(h2('Documentación faltante', '📚'));
[
  '**README** principal con setup completo (hoy está mínimo)',
  '**CONTRIBUTING.md** si va a haber más colaboradores',
  '**API.md** con todos los endpoints (Swagger/OpenAPI ideal)',
  '**DEPLOYMENT.md** con guía Vercel + Supabase + cloudflared/dominio + MP',
  '**TROUBLESHOOTING.md** con problemas conocidos (sandbox MP CO, etc.)',
  '**CHANGELOG.md** versionado semántico',
].forEach(b => children.push(bullet(b)));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 12. Ideas / Nice-to-haves ── */
children.push(h2('Ideas / Nice-to-haves', '💡'));

children.push(h3('Producto'));
[
  'Templates de email personalizables por organizador',
  'Stripe como alternativa a MP (mercados sin MP)',
  'Multi-idioma (i18n) — gran asset para CO + AR + MX',
  'Modo oscuro/claro toggle (hoy es solo dark)',
  'Búsqueda full-text de eventos públicos (Postgres FTS)',
  'Mapa interactivo de eventos cercanos en /explorar',
  'Insignias automáticas ("Primer evento", "100 asistentes", etc.)',
  'Embeds: organizador embebe widget del evento en su web',
  'Cancelación de eventos con notificación masiva + reembolso automático',
  'Reembolsos parciales via MP',
  'Códigos de descuento (la tabla existe, no hay UI)',
  'Early bird funciona en backend, UI no resalta cuando aplica',
  'Múltiples sesiones por evento (festival con varios días)',
  'Speakers compartidos entre eventos del mismo owner',
].forEach(b => children.push(bullet(b)));

children.push(h3('Operacional'));
[
  'Health check completo (/health debería chequear DB + Supabase + MP)',
  'Métricas Prometheus / DataDog opcional',
  'Sentry alerts configuradas con thresholds',
  'Backup automático de la DB (Supabase tiene point-in-time, verificar)',
  'Modo mantenimiento togglable',
].forEach(b => children.push(bullet(b)));

children.push(h3('Equipo / colaboración'));
[
  'Comentarios en tareas (existe en backend, no en UI completa)',
  'Menciones @usuario en chat que disparen notificación',
  'Reacciones a mensajes del chat',
  'Pin de mensajes importantes en canales',
].forEach(b => children.push(bullet(b)));

/* ── 13. Sprint sugerido ── */
children.push(h2('Orden recomendado para próximas sesiones', '🎯'));
children.push(p([t('Por bang-for-buck, si tuviera que elegir el siguiente sprint iría en este orden:', { italics: true, color: GRAY })]));
children.push(table(
  ['#', 'Tarea', 'Tiempo', 'Por qué'],
  [
    ['1',  'White-label en páginas públicas',                     '30 min', 'Alto impacto visual diferenciador'],
    ['2',  'Notificaciones in-app realtime',                      '1.5h',   'Los usuarios esperan eso'],
    ['3',  'Webhook MP signature verification',                   '30 min', 'Security crítico antes de prod'],
    ['4',  'Exportar CSV',                                        '30 min', 'Cualquier organizador lo pide'],
    ['5',  'Code splitting + lazy load',                          '1h',     'Performance perceptible'],
    ['6',  'Términos + Privacidad + Cookies',                     '1h',     'Requisito legal para operar'],
    ['7',  'Listas de espera',                                    '1.5h',   'Feature Free pendiente'],
    ['8',  'manifest.json + íconos PWA',                          '30 min', 'Habilita instalación móvil'],
    ['9',  'README + DEPLOYMENT docs',                            '1h',     'Onboarding de colaboradores'],
    ['10', 'Eliminar mocks + limpieza general',                   '45 min', 'Reduce confusión'],
  ],
  [400, 4000, 1000, 4000],
));

children.push(p([
  t('Total ~9 horas = una semana de sesiones de ~1.5h.', { bold: true }),
]));

/* ── Generar ── */
const doc = new Document({
  creator: 'GESTEK',
  title: 'GESTEK — Roadmap pendientes',
  description: 'Inventario de pendientes, ideas y consideraciones tras la fase 3.',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
      },
    },
    children,
  }],
});

(async () => {
  const buf = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, '..', 'docs', 'GESTEK-Roadmap-Pendientes.docx');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log('OK →', outPath);
  console.log('Tamaño:', (buf.length / 1024).toFixed(1), 'KB');
})();
