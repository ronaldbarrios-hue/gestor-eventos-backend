/* GESTEK — Plantillas de correo del evento: un solo renderizador.

   ── Por qué existe este archivo ──────────────────────────────────────
   Había dos sistemas de correo que no se hablaban:

   · lib/email.js traía cuatro plantillas escritas a mano, en azul y violeta
     fijos, y ESAS eran las que salían en los envíos automáticos (boleta,
     invitación al equipo, tarea, recordatorio). La marca del evento no
     aparecía en ninguna.

   · routes/emails.js leía las plantillas que el organizador diseñaba, pero las
     guardaba en page_json.emails y solo las usaba para las campañas manuales,
     con OTRO cascarón HTML —claro, azul— y otras seis variables. Ningún envío
     automático las miraba.

   Así que el organizador podía diseñar el correo de boleta y ver la vista
   previa perfecta, y al comprar de verdad llegaba el otro. Las invitaciones a
   asistir, además, no tenían camino de envío: no había tipo ni ruta.

   Aquí queda un renderizador y una sola lista de tipos. La plantilla se busca
   en tres sitios, en este orden:

     1. evento_email_plantillas  (migración 0052, lo que edita el organizador)
     2. evento.page_json.emails  (donde vivían antes — se sigue leyendo para no
                                  perder lo que ya había escrito nadie)
     3. los textos por defecto de este archivo

   Y el HTML sale siempre con la marca del evento: los colores de
   page_json.branding, el logo si lo hay, y el nombre de la plataforma. */

const supabase = require('./supabase.js');
const { sendMail } = require('./email.js');

/* ── Marca por defecto ────────────────────────────────────────────────
   Los mismos valores que WhiteLabelSection ofrece como default en el
   frontend: latón y noche. */
const MARCA_DEFECTO = { primary: '#E0B12B', accent: '#F2D66B', bg: '#12100B' };

/* ── Variables que el organizador puede escribir en cualquier campo ──
   Se sustituyen con {{id}}. La lista se entrega al frontend para que la
   pinte como botones y nadie tenga que adivinar el nombre. */
const VARIABLES = [
  { id: 'nombre',      label: 'Nombre de quien recibe', ejemplo: 'Ana Martínez' },
  { id: 'evento',      label: 'Título del evento',      ejemplo: 'Feria de Innovación 2026' },
  { id: 'fecha',       label: 'Fecha del evento',       ejemplo: '14 de septiembre de 2026' },
  { id: 'hora',        label: 'Hora de inicio',         ejemplo: '9:00 a. m.' },
  { id: 'lugar',       label: 'Lugar',                  ejemplo: 'Centro de Convenciones' },
  { id: 'tipo_boleta', label: 'Tipo de boleta',         ejemplo: 'Entrada general' },
  { id: 'codigo',      label: 'Código de la boleta',    ejemplo: 'GTK-4F8B2A' },
  { id: 'rol',         label: 'Rol asignado',           ejemplo: 'Coordinador' },
  { id: 'tarea',       label: 'Título de la tarea',     ejemplo: 'Confirmar catering' },
  { id: 'organizador', label: 'Quién organiza',         ejemplo: 'Eventos del Norte' },
  { id: 'enlace',      label: 'Enlace de la acción',    ejemplo: 'https://…' },
];

const IDS_VARIABLES = VARIABLES.map(v => v.id);

/* ── Los tipos de correo ──────────────────────────────────────────────
   `automatico: true` significa que lo dispara el sistema solo; los demás los
   manda el organizador cuando quiere. Cada uno declara qué variables tienen
   sentido en él, para que el editor no ofrezca {{tarea}} en el correo de una
   boleta. */
const TIPOS = [
  {
    id: 'ticket',
    label: 'Boleta confirmada',
    descripcion: 'Sale al comprar o reservar. Lleva el QR y el código.',
    automatico: true,
    conQr: true,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'tipo_boleta', 'codigo', 'organizador', 'enlace'],
    defaults: {
      asunto:      'Tu entrada para {{evento}}',
      encabezado:  '¡Tu entrada está lista!',
      cuerpo:      'Hola {{nombre}}, ya tienes tu {{tipo_boleta}} para {{evento}}.\n\nEs el {{fecha}} en {{lugar}}. Muestra el código QR de abajo en la entrada.',
      boton_texto: 'Ver mi entrada',
    },
  },
  {
    id: 'invitacion',
    label: 'Invitación a asistir',
    descripcion: 'Invita a alguien a tu evento con el enlace de inscripción.',
    automatico: false,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'organizador', 'enlace'],
    defaults: {
      asunto:      '{{organizador}} te invita a {{evento}}',
      encabezado:  'Estás invitado a {{evento}}',
      cuerpo:      'Hola {{nombre}}, queremos verte en {{evento}}.\n\nEs el {{fecha}} en {{lugar}}. Reserva tu lugar con el botón de abajo.',
      boton_texto: 'Reservar mi lugar',
    },
  },
  {
    id: 'recordatorio_7d',
    label: 'Recordatorio · 7 días antes',
    descripcion: 'Aviso automático una semana antes.',
    automatico: true,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'codigo', 'enlace'],
    defaults: {
      asunto:      '{{evento}} es en una semana',
      encabezado:  'Falta una semana',
      cuerpo:      'Hola {{nombre}}, {{evento}} es el {{fecha}} en {{lugar}}.\n\nTu entrada ya está confirmada. Código: {{codigo}}.',
      boton_texto: 'Ver mi entrada',
    },
  },
  {
    id: 'recordatorio_1d',
    label: 'Recordatorio · un día antes',
    descripcion: 'Aviso automático el día anterior.',
    automatico: true,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'codigo', 'enlace'],
    defaults: {
      asunto:      '{{evento}} es mañana',
      encabezado:  'Es mañana',
      cuerpo:      'Hola {{nombre}}, mañana es {{evento}}, a las {{hora}} en {{lugar}}.\n\nLleva tu código: {{codigo}}.',
      boton_texto: 'Ver mi entrada',
    },
  },
  {
    id: 'recordatorio_1h',
    label: 'Recordatorio · una hora antes',
    descripcion: 'Último aviso, justo antes de empezar.',
    automatico: true,
    variables: ['nombre', 'evento', 'lugar', 'codigo', 'enlace'],
    defaults: {
      asunto:      '{{evento}} empieza en una hora',
      encabezado:  'Empieza en una hora',
      cuerpo:      '{{evento}} arranca en {{lugar}}. Tu código es {{codigo}}.',
      boton_texto: 'Ver mi entrada',
    },
  },
  {
    id: 'invitacion_equipo',
    label: 'Invitación al equipo',
    descripcion: 'Sale al invitar a un colaborador con un rol.',
    automatico: true,
    variables: ['nombre', 'evento', 'rol', 'organizador', 'enlace'],
    defaults: {
      asunto:      'Te sumaron al equipo de {{evento}}',
      encabezado:  'Te sumaron al equipo',
      cuerpo:      'Hola {{nombre}}, te invitaron como {{rol}} en {{evento}}.\n\nEntra y verás tus tareas y permisos.',
      boton_texto: 'Entrar al evento',
    },
  },
  {
    id: 'tarea',
    label: 'Tarea asignada',
    descripcion: 'Sale al asignarle una tarea a alguien del equipo.',
    automatico: true,
    variables: ['nombre', 'evento', 'tarea', 'fecha', 'enlace'],
    defaults: {
      asunto:      'Nueva tarea en {{evento}}: {{tarea}}',
      encabezado:  '{{tarea}}',
      cuerpo:      'Hola {{nombre}}, te asignaron esta tarea en {{evento}}.',
      boton_texto: 'Ver la tarea',
    },
  },
  {
    id: 'cita',
    label: 'Cita confirmada',
    descripcion: 'Rueda de negocios: confirma una cita reservada.',
    automatico: true,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'organizador', 'enlace'],
    defaults: {
      asunto:      'Tu cita en {{evento}} quedó confirmada',
      encabezado:  'Cita confirmada',
      cuerpo:      'Hola {{nombre}}, tu cita en {{evento}} quedó agendada para el {{fecha}} a las {{hora}}.\n\nNos vemos en {{lugar}}.',
      boton_texto: 'Ver mis citas',
    },
  },
  {
    id: 'cupo_liberado',
    label: 'Se liberó un cupo',
    descripcion: 'Lista de espera: avisa al primero de la fila. El enlace caduca.',
    automatico: true,
    variables: ['nombre', 'evento', 'fecha', 'lugar', 'tipo_boleta', 'enlace'],
    defaults: {
      asunto:      'Se liberó un cupo para {{evento}}',
      encabezado:  'Se liberó un cupo',
      cuerpo:      'Hola {{nombre}}, quedó un lugar libre en {{evento}} ({{tipo_boleta}}).\n\nEstabas primero en la lista de espera. El enlace de abajo es solo para ti y caduca pronto.',
      boton_texto: 'Tomar mi cupo',
    },
  },
  {
    id: 'stand',
    label: 'Bienvenida al expositor',
    descripcion: 'Sale al confirmarse una boleta de stand. Lleva el enlace a su portal.',
    automatico: true,
    variables: ['nombre', 'evento', 'fecha', 'hora', 'lugar', 'codigo', 'organizador', 'enlace'],
    defaults: {
      asunto:      'Tu stand en {{evento}} está listo para configurar',
      encabezado:  'Tu stand ya existe. Ahora complétalo.',
      cuerpo:      'Hola {{nombre}}, tu boleta de stand para {{evento}} quedó confirmada y ya te creamos tu ficha de expositor.\n\nCon el botón de abajo entras a tu portal: ahí pones el nombre de tu stand, tu logo, tu contacto y tus redes, defines por qué das puntos a los visitantes y qué premios ofreces. Nadie más lo hace por ti.\n\nGuarda este correo: el enlace es tu llave de entrada y funciona con el código {{codigo}}.',
      boton_texto: 'Configurar mi stand',
    },
  },
  {
    id: 'personalizado',
    label: 'Mensaje libre',
    descripcion: 'Para escribirle lo que quieras a un segmento de tu público.',
    automatico: false,
    variables: IDS_VARIABLES,
    defaults: {
      asunto:      'Novedades de {{evento}}',
      encabezado:  'Hola {{nombre}}',
      cuerpo:      'Escribe aquí tu mensaje.',
      boton_texto: '',
    },
  },
];

const TIPOS_POR_ID = new Map(TIPOS.map(t => [t.id, t]));
const IDS_TIPOS = TIPOS.map(t => t.id);

/* ── Utilidades ───────────────────────────────────────────────────── */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Sustituye {{variable}} por su valor. Solo las de la lista: cualquier otra
   cosa entre llaves se deja tal cual, para que un texto que menciona llaves no
   desaparezca sin explicación. */
function render(txt, ctx = {}) {
  let out = String(txt == null ? '' : txt);
  for (const id of IDS_VARIABLES) {
    out = out.split(`{{${id}}}`).join(ctx[id] == null ? '' : String(ctx[id]));
  }
  return out;
}

/* Un color hex a luminancia relativa, para decidir si el texto encima va
   claro u oscuro. Sin esto, una marca de fondo claro deja el correo con texto
   blanco sobre blanco. */
function esClaro(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) > 0.45;
}

function hexValido(v, fallback) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v || '')) ? v : fallback;
}

/* La marca del evento, ya normalizada y con los colores derivados que necesita
   el correo. */
function marcaDeEvento(evento) {
  const b = evento?.page_json?.branding || {};
  const primary = hexValido(b.primary, MARCA_DEFECTO.primary);
  const accent  = hexValido(b.accent,  MARCA_DEFECTO.accent);
  const bg      = hexValido(b.bg,      MARCA_DEFECTO.bg);
  const claro   = esClaro(bg);

  return {
    primary, accent, bg, claro,
    logoUrl   : /^https?:\/\//i.test(String(b.logo_url || '')) ? b.logo_url : null,
    plataforma: String(b.plataforma || '').trim() || 'GESTEK',
    ocultarMarca: b.ocultar_marca === true,
    serif     : b.font === 'serif',
    /* Superficie de la tarjeta y textos, calculados sobre el fondo. */
    superficie: claro ? '#FFFFFF' : '#1A1712',
    filete    : claro ? '#E4E1D8' : '#2E2A20',
    texto     : claro ? '#1A1814' : '#F5F2EA',
    textoSuave: claro ? '#57524A' : '#A9A294',
    textoTenue: claro ? '#8A8477' : '#797263',
  };
}

function frontendUrl() {
  return String(process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app')
    .split(',')[0].replace(/\/$/, '');
}

/* ── El cascarón ──────────────────────────────────────────────────────
   Tablas y estilos en línea porque es correo: Gmail y Outlook tiran el
   <style> del head y no entienden flex ni grid. */
function cascaron({ marca, encabezado, cuerpoHtml, extraHtml, botonTexto, botonUrl, coverUrl, piePropio }) {
  const fuente = marca.serif
    ? "Georgia,'Times New Roman',serif"
    : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  /* El botón lleva el color primario de la marca, y su texto se decide por
     contraste contra ese primario — no contra el fondo. */
  const textoBoton = esClaro(marca.primary) ? '#12100B' : '#FFFFFF';
  const botonOk = String(botonTexto || '').trim() && /^https?:\/\//i.test(String(botonUrl || ''));

  const cabecera = marca.logoUrl
    ? `<img src="${esc(marca.logoUrl)}" alt="${esc(marca.plataforma)}" width="40" height="40"
           style="display:block;width:40px;height:40px;border-radius:10px;object-fit:cover;" />`
    : `<span style="font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${marca.primary};">${esc(marca.plataforma)}</span>`;

  const hero = /^https?:\/\//i.test(String(coverUrl || ''))
    ? `<tr><td style="padding:0;">
         <img src="${esc(coverUrl)}" alt="" width="560"
              style="display:block;width:100%;max-height:200px;object-fit:cover;" />
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${marca.bg};font-family:${fuente};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${marca.bg};padding:28px 14px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;background:${marca.superficie};border:1px solid ${marca.filete};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:20px 26px 0;">${cabecera}</td></tr>
        ${hero}
        <tr><td style="padding:22px 26px 4px;">
          ${encabezado ? `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700;color:${marca.texto};">${encabezado}</h1>` : ''}
          ${cuerpoHtml ? `<p style="margin:0;font-size:15px;line-height:1.65;color:${marca.textoSuave};">${cuerpoHtml}</p>` : ''}
        </td></tr>
        ${extraHtml || ''}
        ${botonOk ? `<tr><td style="padding:22px 26px 6px;">
          <a href="${esc(botonUrl)}"
             style="display:inline-block;background:${marca.primary};color:${textoBoton};padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">${esc(botonTexto)}</a>
        </td></tr>` : ''}
        <tr><td style="padding:22px 26px 24px;border-top:1px solid ${marca.filete};">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${marca.textoTenue};">
            ${piePropio || `Enviado por ${esc(marca.plataforma)}.`}
            ${marca.ocultarMarca ? '' : `<br/><a href="${frontendUrl()}" style="color:${marca.primary};text-decoration:none;">Con GESTEK</a>`}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* Bloque de datos: fecha, lugar, código y QR cuando el tipo lo lleva. */
function bloqueDatos({ marca, ctx, conQr }) {
  const filas = [];
  if (ctx.fecha) filas.push(['Fecha', ctx.fecha]);
  if (ctx.hora)  filas.push(['Hora', ctx.hora]);
  if (ctx.lugar) filas.push(['Lugar', ctx.lugar]);
  if (ctx.tipo_boleta) filas.push(['Boleta', ctx.tipo_boleta]);

  const qr = conQr && (ctx.qr_token || ctx.codigo)
    ? `<tr><td align="center" style="padding:0 26px 18px;">
         <div style="display:inline-block;background:#FFFFFF;padding:12px;border-radius:14px;">
           <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(ctx.qr_token || ctx.codigo)}"
                width="280" height="280" alt="Código QR de tu entrada"
                style="display:block;width:280px;height:280px;" />
         </div>
       </td></tr>`
    : '';

  if (filas.length === 0 && !ctx.codigo && !qr) return '';

  const datos = filas.map(([k, v]) => `
    <p style="margin:0 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${marca.textoTenue};">${esc(k)}</p>
    <p style="margin:0 0 12px;font-size:14px;color:${marca.texto};">${esc(v)}</p>`).join('');

  const codigo = ctx.codigo
    ? `<div style="border-top:1px dashed ${marca.filete};margin-top:6px;padding-top:14px;">
         <p style="margin:0 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${marca.textoTenue};">Código</p>
         <p style="margin:0;font-size:22px;font-weight:800;letter-spacing:.08em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${marca.texto};">${esc(ctx.codigo)}</p>
       </div>`
    : '';

  return `${qr}
    <tr><td style="padding:18px 26px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:${marca.claro ? '#F8F7F3' : '#12100B'};border:1px solid ${marca.filete};border-radius:14px;">
        <tr><td style="padding:18px 20px;">${datos}${codigo}</td></tr>
      </table>
    </td></tr>`;
}

/* ── Render ───────────────────────────────────────────────────────────
   `plantilla` puede venir a medias: cada campo cae al default de su tipo. */
function renderEmail({ tipo, plantilla = {}, evento = {}, ctx = {} }) {
  const def = TIPOS_POR_ID.get(tipo) || TIPOS_POR_ID.get('personalizado');
  const d = def.defaults;
  const marca = marcaDeEvento(evento);

  const campo = (k) => {
    const v = plantilla[k];
    return (v == null || String(v).trim() === '') ? d[k] : v;
  };

  const asunto     = render(campo('asunto'), ctx).trim() || (evento.titulo || 'Tu evento');
  const encabezado = esc(render(campo('encabezado'), ctx));
  const cuerpoHtml = esc(render(campo('cuerpo'), ctx)).replace(/\r?\n/g, '<br/>');
  const botonTexto = render(campo('boton_texto'), ctx);
  const botonUrl   = String(plantilla.boton_url || ctx.enlace || '').trim();

  const html = cascaron({
    marca,
    encabezado,
    cuerpoHtml,
    extraHtml: bloqueDatos({ marca, ctx, conQr: def.conQr === true }),
    botonTexto,
    botonUrl,
    /* Portada: la del evento, salvo que la plantilla ponga otra imagen. */
    coverUrl: plantilla.imagen || evento.cover_url || null,
    piePropio: plantilla.footer ? esc(render(plantilla.footer, ctx)) : null,
  });

  return { asunto, html };
}

/* ── Contexto desde el evento ─────────────────────────────────────────
   Las variables que salen del evento se llenan siempre igual, para que un
   {{fecha}} signifique lo mismo en los diez tipos. */
function ctxDeEvento(evento, extra = {}) {
  const tz = evento?.timezone || 'America/Bogota';
  let fecha = '', hora = '';
  if (evento?.fecha_inicio) {
    const d = new Date(evento.fecha_inicio);
    /* Una fecha inválida no lanza: toLocaleDateString devuelve la cadena
       "Invalid Date", que acabaría impresa en el correo. Hay que comprobarlo. */
    if (!Number.isNaN(d.getTime())) {
      try {
        fecha = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
        hora  = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: tz });
      } catch { /* zona horaria inválida: se queda vacía en vez de romper el envío */ }
    }
  }
  return {
    evento: evento?.titulo || '',
    fecha,
    hora,
    lugar: evento?.location_nombre || evento?.location_direccion || '',
    organizador: evento?.organizador?.empresa || evento?.organizador?.nombre || '',
    enlace: evento?.slug ? `${frontendUrl()}/explorar/${evento.slug}` : frontendUrl(),
    ...extra,
  };
}

/* ── Dónde vive la plantilla ──────────────────────────────────────────
   Tabla primero, page_json después, defaults al final. Si la tabla todavía no
   existe (0052 sin aplicar) el error se ignora y se sigue por page_json: el
   correo sale con el diseño por defecto en vez de no salir. */
async function plantillaDe(evento, tipo) {
  if (!IDS_TIPOS.includes(tipo)) return { plantilla: {}, origen: 'defecto' };

  try {
    const { data, error } = await supabase
      .from('evento_email_plantillas')
      .select('asunto, encabezado, cuerpo, boton_texto, boton_url, imagen, footer, activo')
      .eq('evento_id', evento.id)
      .eq('tipo', tipo)
      .maybeSingle();
    if (!error && data) {
      if (data.activo === false) return { plantilla: null, origen: 'desactivada' };
      return { plantilla: data, origen: 'tabla' };
    }
  } catch { /* tabla ausente: seguimos */ }

  const vieja = evento?.page_json?.emails?.[tipo];
  if (vieja) return { plantilla: vieja, origen: 'page_json' };

  return { plantilla: {}, origen: 'defecto' };
}

/* Campos del evento que el correo necesita para salir con su marca y sus
   datos. Los puntos de envío suelen tener solo un trozo del evento —el de
   pagos, por ejemplo, arrastra `titulo` y `cover_url` y nada más—, así que
   aquí se completa lo que falte con una lectura. */
const CAMPOS_EVENTO = `id, titulo, slug, owner_id, fecha_inicio, timezone, cover_url,
  location_nombre, location_direccion, page_json,
  organizador:profiles!owner_id(nombre, empresa)`;

async function completarEvento(evento) {
  /* `page_json` es la señal: es donde vive la marca, y ningún punto de envío
     lo arrastra por su cuenta. */
  if (evento && 'page_json' in evento) return evento;
  const id = evento?.id || evento;
  if (!id) return evento;
  try {
    const { data } = await supabase.from('eventos').select(CAMPOS_EVENTO).eq('id', id).maybeSingle();
    return data ? { ...(typeof evento === 'object' ? evento : {}), ...data } : evento;
  } catch {
    return evento;
  }
}

/* ── Envío ────────────────────────────────────────────────────────────
   Punto único por el que pasan los envíos automáticos. Nunca lanza: un correo
   que falla no debe tumbar la compra de una boleta ni la creación de una
   tarea. Devuelve qué pasó para que quien llama pueda registrarlo.

   `evento` puede ser el objeto completo, uno parcial o solo el id. */
async function enviarEmailEvento({ evento: eventoEntrada, tipo, to, ctx = {}, registrar = true }) {
  const destino = String(to || '').trim().toLowerCase();
  if (!destino.includes('@')) return { ok: false, motivo: 'sin_destinatario' };

  const evento = await completarEvento(eventoEntrada);
  if (!evento?.id) return { ok: false, motivo: 'sin_evento' };

  let resultado = { ok: false, motivo: 'error' };
  let asuntoFinal = '';
  try {
    const { plantilla, origen } = await plantillaDe(evento, tipo);
    if (plantilla === null) return { ok: false, motivo: 'plantilla_desactivada' };

    const contexto = ctxDeEvento(evento, ctx);
    const { asunto, html } = renderEmail({ tipo, plantilla, evento, ctx: contexto });
    asuntoFinal = asunto;

    const envio = await sendMail({ to: destino, subject: asunto, html });
    resultado = envio?.ok
      ? { ok: true, origen, asunto }
      : { ok: false, motivo: envio?.skipped || envio?.error || 'error', origen };
  } catch (e) {
    console.warn(`[email] ${tipo} → ${destino} falló:`, e.message);
    resultado = { ok: false, motivo: e.message };
  }

  if (registrar) {
    /* El registro es best-effort: si la 0052 no está aplicada, no hay tabla y
       no pasa nada. El correo ya salió. */
    try {
      await supabase.from('evento_email_envios').insert({
        evento_id: evento.id,
        tipo,
        destinatario: destino,
        asunto: asuntoFinal || null,
        ok: resultado.ok === true,
        motivo: resultado.ok ? null : String(resultado.motivo || '').slice(0, 200),
      });
    } catch { /* sin tabla de registro, seguimos */ }
  }

  return resultado;
}

/* Diagnóstico del proveedor, para el botón "Probar conexión" del panel. */
function diagnosticoProveedor() {
  const cpanel = Boolean(process.env.CPANEL_SMTP_USER && process.env.CPANEL_SMTP_PASS);
  const gmail  = Boolean(process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID
    && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  const resend = Boolean(process.env.RESEND_API_KEY);
  const proveedor = cpanel ? 'cpanel_smtp' : gmail ? 'gmail_oauth' : resend ? 'resend' : null;

  return {
    configurado: Boolean(proveedor),
    proveedor,
    candidatos: { cpanel, gmail, resend },
    remitente: process.env.EMAIL_FROM
      || (cpanel ? process.env.CPANEL_SMTP_USER : process.env.GMAIL_USER)
      || null,
    /* Sin esto los enlaces de los correos apuntan a un dominio que no es el
       tuyo, y nadie se da cuenta hasta que un asistente hace clic. */
    frontend_url: process.env.FRONTEND_URL || null,
    aviso: proveedor
      ? null
      : 'No hay proveedor de correo configurado: los envíos se descartan en silencio. Rellena CPANEL_SMTP_*, el OAuth de Gmail o RESEND_API_KEY.',
  };
}

module.exports = {
  TIPOS,
  IDS_TIPOS,
  VARIABLES,
  IDS_VARIABLES,
  MARCA_DEFECTO,
  render,
  renderEmail,
  marcaDeEvento,
  ctxDeEvento,
  plantillaDe,
  enviarEmailEvento,
  diagnosticoProveedor,
  esClaro,
};
