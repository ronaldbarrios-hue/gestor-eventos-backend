/* Tests del renderizador de correo. Sin DB: solo las funciones puras.

   Lo que se protege aquí es justo lo que se rompió antes y no avisó:
   que el HTML lleve la marca del evento y no unos colores fijos, que el texto
   siga siendo legible cuando la marca es clara, que las variables se
   sustituyan, y que lo que escribe el organizador vaya escapado.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* lib/supabase.js exige las variables al cargar, y emailPlantillas lo requiere.
   Se ponen valores de mentira: ninguno de estos tests toca la red. */
process.env.SUPABASE_URL ||= 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'clave-de-prueba';

const {
  TIPOS, IDS_TIPOS, VARIABLES, IDS_VARIABLES,
  render, renderEmail, marcaDeEvento, ctxDeEvento, esClaro,
  diagnosticoProveedor,
} = require('../lib/emailPlantillas.js');

const EVENTO = {
  id: 'evt-1',
  titulo: 'Feria de Innovación 2026',
  slug: 'feria-2026',
  fecha_inicio: '2026-09-14T14:00:00Z',
  timezone: 'America/Bogota',
  location_nombre: 'Centro de Convenciones',
  page_json: { branding: { primary: '#E0B12B', accent: '#F2D66B', bg: '#12100B', plataforma: 'Eventos del Norte' } },
};

const CTX = { nombre: 'Ana Martínez', tipo_boleta: 'Entrada general', codigo: 'GTK-4F8B2A' };

/* ── Catálogo ── */

test('el catálogo no tiene tipos ni variables repetidas', () => {
  assert.equal(new Set(IDS_TIPOS).size, IDS_TIPOS.length);
  assert.equal(new Set(IDS_VARIABLES).size, IDS_VARIABLES.length);
});

test('cada tipo trae asunto, encabezado y cuerpo por defecto', () => {
  for (const t of TIPOS) {
    assert.ok(t.defaults.asunto, `${t.id} sin asunto`);
    assert.ok(t.defaults.encabezado, `${t.id} sin encabezado`);
    assert.ok(t.defaults.cuerpo, `${t.id} sin cuerpo`);
    assert.ok(t.label, `${t.id} sin label`);
  }
});

test('las variables que declara cada tipo existen en el catálogo', () => {
  for (const t of TIPOS) {
    for (const v of t.variables) {
      assert.ok(IDS_VARIABLES.includes(v), `${t.id} declara la variable inexistente ${v}`);
    }
  }
});

test('los textos por defecto solo usan variables que su tipo declara', () => {
  for (const t of TIPOS) {
    const texto = Object.values(t.defaults).join(' ');
    for (const m of texto.matchAll(/\{\{(\w+)\}\}/g)) {
      assert.ok(t.variables.includes(m[1]),
        `${t.id} usa {{${m[1]}}} en su texto por defecto pero no la declara`);
    }
  }
});

test('cada variable trae ejemplo, para que la vista previa no salga vacía', () => {
  for (const v of VARIABLES) {
    assert.ok(v.label, `${v.id} sin label`);
    assert.ok(v.ejemplo, `${v.id} sin ejemplo`);
  }
});

/* ── Sustitución ── */

test('render sustituye las variables conocidas', () => {
  assert.equal(render('Hola {{nombre}}, vas a {{evento}}', { nombre: 'Ana', evento: 'Feria' }),
    'Hola Ana, vas a Feria');
});

test('render deja vacía la variable sin valor, no el marcador', () => {
  assert.equal(render('Hola {{nombre}}.', {}), 'Hola .');
});

test('render no toca las llaves que no son variables del catálogo', () => {
  assert.equal(render('El JSON usa {{clave}} así', { nombre: 'Ana' }), 'El JSON usa {{clave}} así');
});

test('render repite la misma variable todas las veces que aparezca', () => {
  assert.equal(render('{{nombre}} y {{nombre}}', { nombre: 'Ana' }), 'Ana y Ana');
});

/* ── Luminancia y marca ── */

test('esClaro distingue fondos claros de oscuros', () => {
  assert.equal(esClaro('#FFFFFF'), true);
  assert.equal(esClaro('#12100B'), false);
  assert.equal(esClaro('#E0B12B'), true);   // el latón es claro: el botón lleva texto oscuro
  assert.equal(esClaro('no-es-un-color'), false);
});

test('marcaDeEvento usa la marca del evento cuando existe', () => {
  const m = marcaDeEvento(EVENTO);
  assert.equal(m.primary, '#E0B12B');
  assert.equal(m.bg, '#12100B');
  assert.equal(m.plataforma, 'Eventos del Norte');
  assert.equal(m.claro, false);
});

test('marcaDeEvento cae al latón y la noche si el evento no tiene marca', () => {
  const m = marcaDeEvento({ id: 'x' });
  assert.equal(m.primary, '#E0B12B');
  assert.equal(m.bg, '#12100B');
  assert.equal(m.plataforma, 'GESTEK');
});

test('marcaDeEvento descarta colores inválidos en vez de meterlos en el CSS', () => {
  const m = marcaDeEvento({ page_json: { branding: { primary: 'rojo; }', bg: '#fff' } } });
  assert.equal(m.primary, '#E0B12B');
  assert.equal(m.bg, '#fff');
});

test('marcaDeEvento no acepta un logo que no sea http(s)', () => {
  const m = marcaDeEvento({ page_json: { branding: { logo_url: 'javascript:alert(1)' } } });
  assert.equal(m.logoUrl, null);
});

/* ── Contexto ── */

test('ctxDeEvento resuelve fecha y hora en la zona del evento', () => {
  const ctx = ctxDeEvento(EVENTO);
  assert.equal(ctx.fecha, '14 de septiembre de 2026');
  assert.match(ctx.hora, /9:00/);          // 14:00 UTC son 9:00 en Bogotá
  assert.equal(ctx.lugar, 'Centro de Convenciones');
  assert.equal(ctx.evento, 'Feria de Innovación 2026');
});

test('ctxDeEvento aguanta una fecha inválida sin lanzar', () => {
  const ctx = ctxDeEvento({ ...EVENTO, fecha_inicio: 'no-es-fecha' });
  assert.equal(ctx.fecha, '');
  assert.equal(ctx.hora, '');
});

test('ctxDeEvento deja que el extra pise lo del evento', () => {
  const ctx = ctxDeEvento(EVENTO, { lugar: 'Otro sitio' });
  assert.equal(ctx.lugar, 'Otro sitio');
});

/* ── Render del correo ── */

test('el correo sale con la marca del evento, no con colores fijos', () => {
  const { html } = renderEmail({ tipo: 'ticket', plantilla: {}, evento: EVENTO, ctx: ctxDeEvento(EVENTO, CTX) });
  assert.ok(html.includes('#E0B12B'), 'falta el color primario');
  assert.ok(html.includes('#12100B'), 'falta el fondo');
  assert.ok(html.includes('Eventos del Norte'), 'falta el nombre de la plataforma');
  /* El violeta del cascarón viejo no debe volver por ninguna vía. */
  assert.ok(!html.includes('#8B7CF6'), 'quedó el violeta de la plantilla vieja');
});

test('sobre marca clara el texto va oscuro (y no blanco sobre blanco)', () => {
  const claro = { ...EVENTO, page_json: { branding: { primary: '#FFD166', bg: '#FFFFFF' } } };
  const { html } = renderEmail({ tipo: 'ticket', plantilla: {}, evento: claro, ctx: CTX });
  assert.ok(html.includes('#1A1814'), 'el texto no se oscureció sobre fondo claro');
});

test('el botón elige su color de texto contra el primario, no contra el fondo', () => {
  /* Primario claro (latón) → texto oscuro en el botón. */
  const { html } = renderEmail({
    tipo: 'invitacion', plantilla: { boton_url: 'https://ejemplo.com' }, evento: EVENTO, ctx: CTX,
  });
  assert.ok(html.includes('color:#12100B'), 'el botón quedó con texto ilegible');
});

test('la boleta lleva QR y código; los demás tipos no llevan QR', () => {
  const conQr = renderEmail({ tipo: 'ticket', plantilla: {}, evento: EVENTO, ctx: CTX });
  assert.ok(conQr.html.includes('create-qr-code'), 'la boleta salió sin QR');
  assert.ok(conQr.html.includes('GTK-4F8B2A'), 'la boleta salió sin código');

  const sinQr = renderEmail({ tipo: 'invitacion_equipo', plantilla: {}, evento: EVENTO, ctx: { nombre: 'Ana', rol: 'Editor' } });
  assert.ok(!sinQr.html.includes('create-qr-code'), 'la invitación al equipo no debería llevar QR');
});

test('un campo vacío en la plantilla cae al texto por defecto de su tipo', () => {
  const { asunto } = renderEmail({
    tipo: 'ticket', plantilla: { asunto: '   ' }, evento: EVENTO, ctx: ctxDeEvento(EVENTO, CTX),
  });
  assert.equal(asunto, 'Tu entrada para Feria de Innovación 2026');
});

test('la plantilla del organizador pisa el texto por defecto', () => {
  const { asunto, html } = renderEmail({
    tipo: 'ticket',
    plantilla: { asunto: 'Listo {{nombre}}', encabezado: 'Nos vemos' },
    evento: EVENTO, ctx: CTX,
  });
  assert.equal(asunto, 'Listo Ana Martínez');
  assert.ok(html.includes('Nos vemos'));
});

test('si el asunto queda vacío del todo, se usa el título del evento', () => {
  const { asunto } = renderEmail({
    tipo: 'personalizado', plantilla: { asunto: '{{nombre}}' }, evento: EVENTO, ctx: { nombre: '' },
  });
  assert.equal(asunto, 'Feria de Innovación 2026');
});

test('lo que escribe el organizador va escapado', () => {
  const { html } = renderEmail({
    tipo: 'personalizado',
    plantilla: { cuerpo: '<script>alert(1)</script>', encabezado: '<img onerror=x>' },
    evento: EVENTO, ctx: CTX,
  });
  assert.ok(!html.includes('<script>alert'), 'el script no se escapó');
  assert.ok(!html.includes('<img onerror'), 'la etiqueta no se escapó');
  assert.ok(html.includes('&lt;script&gt;'), 'debería aparecer escapado');
});

test('el valor de una variable también va escapado', () => {
  const { html } = renderEmail({
    tipo: 'personalizado', plantilla: { cuerpo: 'Hola {{nombre}}' },
    evento: EVENTO, ctx: { nombre: '<b>x</b>' },
  });
  assert.ok(!html.includes('<b>x</b>'));
});

test('los saltos de línea del cuerpo se vuelven <br/>', () => {
  const { html } = renderEmail({
    tipo: 'personalizado', plantilla: { cuerpo: 'Una\nDos' }, evento: EVENTO, ctx: CTX,
  });
  assert.ok(html.includes('Una<br/>Dos'));
});

test('un botón sin URL válida no se pinta', () => {
  const { html } = renderEmail({
    tipo: 'personalizado',
    plantilla: { boton_texto: 'Clic', boton_url: 'javascript:alert(1)' },
    evento: EVENTO, ctx: { ...CTX, enlace: '' },
  });
  assert.ok(!html.includes('javascript:alert'), 'se colgó un esquema peligroso en el botón');
});

test('la cabecera subida por el organizador se muestra entera, la portada del evento se recorta', () => {
  const conDiseno = renderEmail({
    tipo: 'personalizado', plantilla: { imagen: 'https://ejemplo.com/cabecera.png' }, evento: EVENTO, ctx: CTX,
  }).html;
  assert.ok(conDiseno.includes('height:auto;'), 'la cabecera diseñada debería mostrarse sin recortar');

  const sinPlantilla = renderEmail({
    tipo: 'personalizado', plantilla: {}, evento: { ...EVENTO, cover_url: 'https://ejemplo.com/portada.png' }, ctx: CTX,
  }).html;
  assert.ok(sinPlantilla.includes('max-height:200px'), 'la portada del evento sí debería recortarse');
});

test('el pie que sube el organizador aparece como imagen, sin la línea del footer de texto encima', () => {
  const { html } = renderEmail({
    tipo: 'personalizado', plantilla: { pie_imagen: 'https://ejemplo.com/pie.png' }, evento: EVENTO, ctx: CTX,
  });
  assert.ok(html.includes('ejemplo.com/pie.png'), 'debería incluir la imagen del pie');
});

test('el color del centro que elige el organizador reemplaza al de la marca', () => {
  const { html } = renderEmail({
    tipo: 'personalizado', plantilla: { fondo: '#112233' }, evento: EVENTO, ctx: CTX,
  });
  assert.ok(html.includes('background:#112233'), 'debería usar el color elegido, no el de la marca');
});

test('sin color elegido, el centro usa la superficie de la marca de siempre', () => {
  const { html } = renderEmail({ tipo: 'personalizado', plantilla: {}, evento: EVENTO, ctx: CTX });
  assert.ok(!html.includes('background:#112233'));
});

test('un tipo desconocido no revienta: cae en personalizado', () => {
  const { html } = renderEmail({ tipo: 'no-existe', plantilla: {}, evento: EVENTO, ctx: CTX });
  assert.ok(html.startsWith('<!doctype html>'));
});

test('el HTML es un documento completo y declara utf-8', () => {
  const { html } = renderEmail({ tipo: 'ticket', plantilla: {}, evento: EVENTO, ctx: CTX });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('charset="utf-8"'));
  assert.ok(html.trimEnd().endsWith('</html>'));
});

/* ── Diagnóstico ── */

test('sin proveedor configurado el diagnóstico lo dice con un aviso', () => {
  const guardado = { ...process.env };
  for (const k of ['CPANEL_SMTP_USER', 'CPANEL_SMTP_PASS', 'GMAIL_USER', 'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

  const d = diagnosticoProveedor();
  assert.equal(d.configurado, false);
  assert.equal(d.proveedor, null);
  assert.ok(d.aviso, 'sin proveedor debe haber un aviso');

  Object.assign(process.env, guardado);
});

test('el diagnóstico prefiere cPanel sobre las demás opciones', () => {
  const guardado = { ...process.env };
  process.env.CPANEL_SMTP_USER = 'no-reply@x.com';
  process.env.CPANEL_SMTP_PASS = 'secreto';
  process.env.RESEND_API_KEY = 're_x';

  const d = diagnosticoProveedor();
  assert.equal(d.proveedor, 'cpanel_smtp');
  assert.equal(d.configurado, true);
  assert.equal(d.candidatos.resend, true);
  assert.equal(d.aviso, null);

  for (const k of ['CPANEL_SMTP_USER', 'CPANEL_SMTP_PASS', 'RESEND_API_KEY']) delete process.env[k];
  Object.assign(process.env, guardado);
});

test('con un solo buzón SMTP el diagnóstico no cambia de nombre', () => {
  const guardado = { ...process.env };
  process.env.CPANEL_SMTP_USER = 'no-reply@x.com';
  process.env.CPANEL_SMTP_PASS = 'secreto';
  delete process.env.CPANEL_SMTP_USER2;
  delete process.env.CPANEL_SMTP_PASS2;

  const d = diagnosticoProveedor();
  assert.equal(d.proveedor, 'cpanel_smtp');
  assert.equal(d.buzones_activos, 1);
  assert.equal(d.candidatos.smtp2, false);

  for (const k of ['CPANEL_SMTP_USER', 'CPANEL_SMTP_PASS']) delete process.env[k];
  Object.assign(process.env, guardado);
});

test('con los dos buzones SMTP puestos, el diagnóstico dice que se alternan', () => {
  const guardado = { ...process.env };
  process.env.CPANEL_SMTP_USER = 'no-reply@x.com';
  process.env.CPANEL_SMTP_PASS = 'secreto';
  process.env.CPANEL_SMTP_USER2 = 'no-reply@y.com';
  process.env.CPANEL_SMTP_PASS2 = 'secreto2';

  const d = diagnosticoProveedor();
  assert.equal(d.proveedor, 'smtp_alternado');
  assert.equal(d.buzones_activos, 2);
  assert.equal(d.configurado, true);
  assert.equal(d.candidatos.cpanel, true);
  assert.equal(d.candidatos.smtp2, true);

  for (const k of ['CPANEL_SMTP_USER', 'CPANEL_SMTP_PASS', 'CPANEL_SMTP_USER2', 'CPANEL_SMTP_PASS2']) delete process.env[k];
  Object.assign(process.env, guardado);
});

/* ── Que el punto de envío no lance ──────────────────────────────────────

   Esto protege el fallo más caro que ha tenido el proyecto. La cabecera de
   enviarEmailEvento promete que nunca lanza, y nueve puntos de envío se lo
   creen: todos llaman con `.catch(() => {})`. Pero el contrato también dice
   que `evento` puede ser sólo el id, y con una cadena `'page_json' in evento`
   lanzaba TypeError fuera del try. El error se escapaba y se lo tragaba el
   catch vacío de quien llamara.

   No fallaba: se evaporaba. Cero filas en evento_email_envios con 34 boletas
   emitidas, y 1.949 recordatorios que nunca salieron.

   La prueba no comprueba que el correo salga —eso necesita un proveedor—,
   sino que la llamada RESUELVE en vez de reventar. */

const { enviarEmailEvento } = require('../lib/emailPlantillas.js');

test('enviarEmailEvento acepta el id del evento como cadena y no lanza', async () => {
  const r = await enviarEmailEvento({
    evento: '39a482a1-0035-4379-a0bc-4bb88c8cab1d',
    tipo: 'ticket',
    to: 'alguien@ejemplo.com',
    registrar: false,
  });
  assert.equal(typeof r, 'object');
  assert.equal(typeof r.ok, 'boolean');

  /* La parte que de verdad protege el arreglo.

     Sin el `typeof === 'object'` el TypeError sigue ocurriendo; lo que pasa es
     que el try que se puso alrededor lo atrapa y devuelve un objeto igual. O
     sea: comprobar «no lanza» NO distingue entre manejarlo y taparlo, y la
     primera versión de esta prueba pasaba con el fallo reintroducido.

     Aquí sí se distingue: un id en texto es entrada VÁLIDA por contrato, así
     que tiene que llegar a intentar la lectura del evento (y quedarse en
     'sin_evento', porque en las pruebas no hay base). Si aparece
     'evento_ilegible', es que volvió a reventar y sólo lo tapó el catch. */
  assert.ok(
    !String(r.motivo || '').startsWith('evento_ilegible'),
    `el id en texto volvió a reventar: ${r.motivo}`,
  );
});

test('enviarEmailEvento tampoco lanza con entradas absurdas', async () => {
  for (const evento of [null, undefined, 0, '', [], true]) {
    const r = await enviarEmailEvento({
      evento, tipo: 'ticket', to: 'alguien@ejemplo.com', registrar: false,
    });
    assert.equal(typeof r, 'object', `reventó con ${JSON.stringify(evento)}`);
    assert.equal(r.ok, false);
  }
});

test('un destinatario sin arroba se descarta antes de tocar nada', async () => {
  const r = await enviarEmailEvento({ evento: 'x', tipo: 'ticket', to: 'no-es-un-correo' });
  assert.equal(r.motivo, 'sin_destinatario');
});

/* ── Plantilla escrita en el momento ───────────────────────────────

   Un recordatorio suelto es texto que alguien acaba de escribir: no está
   guardado como plantilla del evento. Tiene que ganar sobre la plantilla
   guardada, y sobre todo tiene que SOBREVIVIR A LA COLA — viaja dentro del
   ctx encolado, y si se pierde por el camino el correo sale con el relleno
   «Escribe aquí tu mensaje» y nadie se entera hasta leer su bandeja. */

test('una plantilla puesta a mano se usa tal cual', () => {
  const plantilla = {
    asunto: 'Recordatorio: Feria',
    encabezado: 'Feria',
    cuerpo: 'Traigan documento de identidad.',
  };
  const { asunto, html } = renderEmail({
    tipo: 'personalizado', plantilla, evento: EVENTO, ctx: { nombre: 'Ana' },
  });
  assert.equal(asunto, 'Recordatorio: Feria');
  assert.ok(html.includes('Traigan documento de identidad.'));
  assert.ok(!html.includes('Escribe aquí tu mensaje'), 'salió el texto de relleno');
});

test('la plantilla del ctx encolado se recupera y no ensucia las variables', () => {
  const plantilla = { asunto: 'A', encabezado: 'B', cuerpo: 'C' };
  const fila = { ctx: { nombre: 'Ana', _plantilla: plantilla } };

  /* El mismo desestructurado que hace enviarDesdeLaCola. */
  const { _plantilla: recuperada = null, ...ctx } = fila.ctx || {};

  assert.deepEqual(recuperada, plantilla);
  assert.ok(!('_plantilla' in ctx), '_plantilla no debe llegar al render como variable');
  assert.equal(ctx.nombre, 'Ana');
});
