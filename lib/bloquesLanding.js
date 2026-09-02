'use strict';

/* GESTEK — El catálogo de bloques de la landing, y su validación.
 *
 * ── Por qué esto está en el servidor ──────────────────────────────────────
 *
 * Hasta ahora `page_json.paginas` se guardaba TAL CUAL: el servidor no sabía
 * qué es un bloque ni qué lleva dentro. Funcionaba porque el único que escribía
 * era el editor, que conocía el catálogo. En el momento en que escribe algo más
 * —una sesión de Claude por MCP, un modo desarrollador, otro cliente— eso deja
 * de sostenerse: se puede guardar una página con bloques inventados que la
 * página pública no sabe pintar, o con campos que nadie lee.
 *
 * Y es la tercera vez que aparece la misma lección en este proyecto. Los tipos
 * de campo del formulario y las plantillas de correo ya se mantuvieron por
 * duplicado, y las dos veces las listas se separaron en silencio: el panel
 * ofrecía cosas que el servidor no conocía. Aquí el catálogo es UNO y vive
 * donde se puede hacer cumplir.
 *
 * ── Por qué un DSL en JSON y no HTML libre ────────────────────────────────
 *
 * Lo pedido era «que la persona pueda escribir el código de su página». La
 * forma obvia —dejar meter HTML— es una vía directa a XSS: el bloque lo
 * escribe el organizador pero lo ve todo el público, y un `<script>` ahí corre
 * con el origen del evento, donde está la sesión de quien lo mira.
 *
 * Un bloque es `{ type, data }` y ya lo era. Convertirlo en contrato explícito
 * cuesta poco y resuelve las dos cosas a la vez:
 *
 *   · Se puede validar. HTML libre no se puede validar ni por seguridad ni por
 *     corrección; un esquema sí.
 *   · Es lo que hace posible lo de Claude por MCP. Un modelo genera JSON contra
 *     un esquema de forma fiable, y si se equivoca el servidor lo dice. Con
 *     HTML libre no hay forma de saber si lo que generó está bien hasta que
 *     alguien abre la página.
 *
 * Quien quiera control total del aspecto ya tiene la salida buena: exportar el
 * bloque como iframe o el botón como widget, y montar el resto en su web.
 */

/* Cada bloque: qué campos admite y de qué tipo. `sistema` son los que sacan su
   contenido del evento (no llevan datos propios); `custom` los que el
   organizador rellena.

   Los tipos son deliberadamente pocos —texto, numero, booleano, url, fecha,
   lista— porque la validación tiene que caber en la cabeza de quien añada un
   bloque nuevo. Un sistema de tipos rico aquí se convierte en un sistema de
   tipos que nadie mantiene. */
const BLOQUES = {
  /* ── De sistema: el contenido sale del evento ── */
  portada       : { label: 'Portada',                 categoria: 'sistema', campos: {} },
  galeria_evento: { label: 'Galería del evento',      categoria: 'sistema', campos: {} },
  titulo        : { label: 'Título del evento',       categoria: 'sistema', campos: {} },
  descripcion   : { label: 'Descripción',             categoria: 'sistema', campos: {} },
  info          : { label: 'Información',             categoria: 'sistema', campos: {} },
  direccion     : { label: 'Dirección',               categoria: 'sistema', campos: {} },
  links         : { label: 'Links / redes',           categoria: 'sistema', campos: {} },
  /* Boletas es el único de sistema con ajustes propios: el editor
     (`TicketsEditor`) ofrece encabezado, una o dos columnas, y el texto del
     botón. `columnas` es número porque el editor manda 1 o 2, no '1' o '2'. */
  tickets       : { label: 'Boletas',                 categoria: 'sistema', campos: {
    encabezado : { tipo: 'texto', max: 120 },
    columnas   : { tipo: 'numero', min: 1, max: 2 },
    texto_boton: { tipo: 'texto', max: 60 },
  } },

  /* ── Propios: los rellena el organizador ── */
  hero: {
    label: 'Hero / banner', categoria: 'custom',
    campos: {
      titulo   : { tipo: 'texto', max: 200 },
      subtitulo: { tipo: 'texto', max: 300 },
      imagen   : { tipo: 'url' },
      cta_texto: { tipo: 'texto', max: 80 },
      cta_url  : { tipo: 'url' },
      alto     : { tipo: 'numero', min: 120, max: 900 },
    },
  },
  texto: {
    label: 'Texto', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, texto: { tipo: 'texto', max: 5000 } },
  },
  speakers: {
    label: 'Speakers', categoria: 'custom',
    campos: {
      titulo: { tipo: 'texto', max: 200 },
      items : { tipo: 'lista', max: 60, de: {
        nombre: { tipo: 'texto', max: 120 }, cargo: { tipo: 'texto', max: 120 },
        empresa: { tipo: 'texto', max: 120 }, foto: { tipo: 'url' }, bio: { tipo: 'texto', max: 1000 },
      } },
    },
  },
  sponsors: {
    label: 'Patrocinadores', categoria: 'custom',
    campos: {
      titulo: { tipo: 'texto', max: 200 },
      items : { tipo: 'lista', max: 60, de: {
        nombre: { tipo: 'texto', max: 120 }, logo: { tipo: 'url' }, url: { tipo: 'url' }, nivel: { tipo: 'texto', max: 40 },
      } },
    },
  },
  mapa: {
    label: 'Mapa', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, direccion: { tipo: 'texto', max: 300 } },
  },
  countdown: {
    label: 'Cuenta atrás', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, fecha: { tipo: 'fecha' } },
  },
  galeria: {
    label: 'Galería', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, urls: { tipo: 'lista', max: 60, de: null } },
  },
  video: {
    label: 'Vídeo', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, url: { tipo: 'url' } },
  },
  redes: {
    label: 'Redes sociales', categoria: 'custom',
    campos: {
      titulo: { tipo: 'texto', max: 200 },
      items : { tipo: 'lista', max: 20, de: { tipo: { tipo: 'texto', max: 40 }, url: { tipo: 'url' } } },
    },
  },
  faq: {
    label: 'Preguntas frecuentes', categoria: 'custom',
    campos: {
      titulo: { tipo: 'texto', max: 200 },
      items : { tipo: 'lista', max: 60, de: { q: { tipo: 'texto', max: 300 }, a: { tipo: 'texto', max: 3000 } } },
    },
  },
  recompensas: {
    label: 'Premios y recompensas', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, subtitulo: { tipo: 'texto', max: 500 } },
  },
  expositores: {
    label: 'Directorio de expositores', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, subtitulo: { tipo: 'texto', max: 500 } },
  },
  registrar_stand: { label: 'Sé expositor', categoria: 'custom', campos: {} },
  mapa_evento: {
    label: 'Mapa del evento', categoria: 'custom',
    campos: { titulo: { tipo: 'texto', max: 200 }, subtitulo: { tipo: 'texto', max: 500 } },
  },
  cta: {
    label: 'Botón', categoria: 'custom',
    campos: {
      texto : { tipo: 'texto', max: 80 },
      url   : { tipo: 'url' },
      estilo: { tipo: 'texto', opciones: ['primary', 'secondary', 'ghost'] },
    },
  },
  cita: {
    label: 'Cita / testimonio', categoria: 'custom',
    campos: { texto: { tipo: 'texto', max: 1000 }, autor: { tipo: 'texto', max: 120 } },
  },
  separador: {
    label: 'Separador', categoria: 'custom',
    campos: { estilo: { tipo: 'texto', opciones: ['linea', 'espacio', 'punto'] } },
  },
};

const TIPOS_BLOQUE = Object.keys(BLOQUES);

/* Lo que un bloque puede llevar sin declararlo en su catálogo, porque no es
   contenido suyo sino de cómo se presenta, y vale para todos.
 *
 * `oculto` es del editor. Los otros cinco los escribe `ControlesPresentacion`
 * (frontend, `editor/presentacion.jsx`), que el editor monta en el envoltorio
 * COMÚN de las secciones: no hay bloque que no los pueda tener.
 *
 * Faltaban, y no era un detalle: `fallaBloque` rechaza los campos de más, así
 * que guardar la landing devolvía 400 en cuanto el organizador tocaba el
 * fondo, el aire, la alineación, el ancho o el título de una sección. El
 * editor pintaba la vista previa sin problema —el frontend no valida— y el
 * fallo sólo salía al guardar, con un mensaje que hablaba de un campo que la
 * persona no sabía que existía.
 *
 * Las opciones son las MISMAS listas que ofrece el editor. Si allí se añade
 * una, aquí hay que añadirla: es el precio de tener el contrato en el
 * servidor, y es más barato que dejar pasar cualquier cosa. */
const COMUNES = {
  oculto:     { tipo: 'booleano' },
  titulo:     { tipo: 'texto', max: 120 },
  fondo:      { tipo: 'texto', opciones: ['ninguno', 'suave', 'marcado', 'contorno'] },
  espaciado:  { tipo: 'texto', opciones: ['compacto', 'normal', 'amplio'] },
  alineacion: { tipo: 'texto', opciones: ['izquierda', 'centro'] },
  ancho:      { tipo: 'texto', opciones: ['estrecho', 'normal', 'ancho', 'completo'] },
};

const MAX_BLOQUES_POR_PAGINA = 60;
const MAX_PAGINAS = 20;

/* ── Validación de un valor suelto ──────────────────────────────────────── */

function fallaValor(nombre, def, v) {
  if (v === undefined || v === null || v === '') return null;   // vacío es válido
  switch (def.tipo) {
    case 'numero': {
      const n = Number(v);
      if (!Number.isFinite(n)) return `«${nombre}» tiene que ser un número.`;
      if (def.min != null && n < def.min) return `«${nombre}» no puede ser menor que ${def.min}.`;
      if (def.max != null && n > def.max) return `«${nombre}» no puede ser mayor que ${def.max}.`;
      return null;
    }
    case 'booleano':
      return typeof v === 'boolean' ? null : `«${nombre}» tiene que ser verdadero o falso.`;
    case 'fecha':
      return Number.isNaN(new Date(v).getTime()) ? `«${nombre}» no es una fecha válida.` : null;
    case 'url': {
      const s = String(v);
      /* `data:` y `javascript:` no. Un `javascript:` en un enlace de la landing
         es XSS con el origen del evento, que es exactamente lo que este
         archivo existe para impedir. */
      if (!/^(https?:\/\/|\/|#)/i.test(s)) return `«${nombre}» tiene que ser una dirección http(s) o una ruta del sitio.`;
      if (s.length > 2000) return `«${nombre}» es demasiado largo.`;
      return null;
    }
    case 'lista': {
      if (!Array.isArray(v)) return `«${nombre}» tiene que ser una lista.`;
      if (def.max != null && v.length > def.max) return `«${nombre}» admite como mucho ${def.max} elementos.`;
      if (!def.de) {
        /* Lista de cadenas sueltas (por ejemplo, urls de una galería). */
        for (const x of v) if (typeof x !== 'string') return `«${nombre}» sólo admite texto.`;
        return null;
      }
      for (let i = 0; i < v.length; i++) {
        const item = v[i];
        if (!item || typeof item !== 'object') return `El elemento ${i + 1} de «${nombre}» tiene que ser un objeto.`;
        /* Los campos de más también se rechazan aquí dentro, por lo mismo que
           en el bloque: uno que nadie lee es trabajo que alguien hizo creyendo
           que servía. Faltaba, y lo cazó la prueba. */
        for (const k of Object.keys(item)) {
          if (!(k in def.de)) {
            return `El elemento ${i + 1} de «${nombre}»: «${k}» no es un campo suyo. Admite: ${Object.keys(def.de).join(', ')}.`;
          }
        }
        for (const [k, d] of Object.entries(def.de)) {
          const f = fallaValor(`${nombre}[${i + 1}].${k}`, d, item[k]);
          if (f) return f;
        }
      }
      return null;
    }
    case 'texto':
    default: {
      if (typeof v !== 'string' && typeof v !== 'number') return `«${nombre}» tiene que ser texto.`;
      const s = String(v);
      if (def.max != null && s.length > def.max) return `«${nombre}» no puede pasar de ${def.max} caracteres.`;
      if (def.opciones && !def.opciones.includes(s)) {
        return `«${nombre}» tiene que ser uno de: ${def.opciones.join(', ')}.`;
      }
      return null;
    }
  }
}

/* ── Validación de un bloque ────────────────────────────────────────────── */

/* Un bloque es `{ id, type, data }` y nada más. El editor los crea así en los
   cuatro sitios donde nacen, y el `id` hace falta para exportar ese bloque
   suelto como iframe. Lo que se rechaza aquí son las claves de MÁS: sin esto,
   `data` estaba validado pero el bloque que lo envuelve no, así que por MCP se
   podía guardar `{type, data, loQueSea}` y quedaba almacenado para siempre sin
   que nadie lo leyera. Mismo criterio que dentro de `data`. */
const CLAVES_BLOQUE = ['id', 'type', 'data'];

function fallaBloque(b, dondeDice = 'bloque') {
  if (!b || typeof b !== 'object') return `${dondeDice}: tiene que ser un objeto.`;
  const def = BLOQUES[b.type];
  if (!def) {
    return `${dondeDice}: «${b.type}» no es un tipo de bloque. Los que hay: ${TIPOS_BLOQUE.join(', ')}.`;
  }
  for (const k of Object.keys(b)) {
    if (!CLAVES_BLOQUE.includes(k)) {
      return `${dondeDice} «${b.type}»: «${k}» no va en un bloque. Sólo admite: ${CLAVES_BLOQUE.join(', ')}.`;
    }
  }
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  const permitidos = { ...def.campos, ...COMUNES };
  for (const k of Object.keys(data)) {
    if (!(k in permitidos)) {
      /* Se rechaza en vez de ignorarse en silencio: un campo que el editor no
         lee es trabajo que alguien hizo creyendo que servía para algo. */
      const nombres = Object.keys(def.campos);
      return `${dondeDice} «${b.type}»: «${k}» no es un campo suyo.${nombres.length ? ` Admite: ${nombres.join(', ')}.` : ' No admite ninguno.'}`;
    }
  }
  for (const [k, d] of Object.entries(permitidos)) {
    const f = fallaValor(k, d, data[k]);
    if (f) return `${dondeDice} «${b.type}»: ${f}`;
  }
  return null;
}

/* ── Validación de la landing entera ────────────────────────────────────── */

function fallaPaginas(paginas) {
  if (paginas === undefined || paginas === null) return null;
  if (!Array.isArray(paginas)) return 'Las páginas tienen que ser una lista.';
  if (paginas.length > MAX_PAGINAS) return `Máximo ${MAX_PAGINAS} páginas.`;
  for (let p = 0; p < paginas.length; p++) {
    const pag = paginas[p];
    if (!pag || typeof pag !== 'object') return `La página ${p + 1} tiene que ser un objeto.`;
    const blocks = pag.blocks;
    if (blocks === undefined) continue;
    if (!Array.isArray(blocks)) return `Los bloques de la página ${p + 1} tienen que ser una lista.`;
    if (blocks.length > MAX_BLOQUES_POR_PAGINA) {
      return `La página ${p + 1} tiene ${blocks.length} bloques y el máximo son ${MAX_BLOQUES_POR_PAGINA}.`;
    }
    for (let i = 0; i < blocks.length; i++) {
      const f = fallaBloque(blocks[i], `Página ${p + 1}, bloque ${i + 1}`);
      if (f) return f;
    }
  }
  return null;
}

/* ── El embed: qué bloque pide una sección incrustada ────────────────────────
 *
 * `/embed/<slug>/<seccion>` sirve UN bloque dentro de la web de otra empresa.
 * Hasta ahora la sección se resolvía sólo en el navegador: la página pedía el
 * evento entero y se quedaba con el bloque que le tocaba. Eso significa que
 * quien incrusta «Cómo llegar» recibe en su DOM la landing completa —el resto
 * de bloques con su configuración, la marca, el formulario—, aunque no pinte
 * nada de eso. Un dato no se deja de filtrar por no dibujarlo.
 *
 * Por eso el alias vive AQUÍ además de en el frontend: para poder resolver la
 * sección en el servidor y mandar sólo su bloque. El gemelo está en
 * `gestor-eventos-frontend/src/lib/embed.js` (EMBED_ALIAS); si se añade un
 * alias allí y no aquí, el embed sigue funcionando pero vuelve a viajar la
 * landing entera — que es justo el fallo que esto cierra.
 */
const EMBED_ALIAS = {
  boletas: 'tickets',
  entradas: 'tickets',
  tickets: 'tickets',
  'como-llegar': 'mapa',
  ubicacion: 'mapa',
  mapa: 'mapa',
  'mapa-evento': 'mapa_evento',
  plano: 'mapa_evento',
  mapa_evento: 'mapa_evento',
  ponentes: 'speakers',
  speakers: 'speakers',
  patrocinadores: 'sponsors',
  sponsors: 'sponsors',
  expositores: 'expositores',
  directorio: 'expositores',
  premios: 'recompensas',
  recompensas: 'recompensas',
  preguntas: 'faq',
  faq: 'faq',
  'cuenta-regresiva': 'countdown',
  countdown: 'countdown',
  informacion: 'info',
  info: 'info',
};

/* Todos los bloques de una landing, vengan de la columna `paginas` (0064) o
   del `page_json` viejo (`pages`, o `blocks` suelto de antes de las páginas). */
function bloquesDe(paginas) {
  const pags = Array.isArray(paginas) ? paginas : [];
  return pags.flatMap(p => (Array.isArray(p?.blocks) ? p.blocks : [])).filter(Boolean);
}

/* El bloque que pide una sección incrustada, o null si no está en la landing.
   Se busca primero por id —el organizador puede exportar un bloque concreto— y
   luego por tipo, respetando `oculto`: un bloque que quitó de la página no se
   sirve por la puerta de atrás.

   Devolver null NO es un error: hay secciones que no son bloques (el torneo, la
   agenda, el registro) y otras que se alimentan del evento y el frontend pinta
   con sus valores por defecto aunque no estén puestas en la landing. En los dos
   casos lo correcto es mandar la landing vacía, no la landing entera. */
function bloqueDeSeccion(paginas, seccion) {
  const s = String(seccion || '').trim();
  if (!s) return null;
  const todos = bloquesDe(paginas);
  const porId = todos.find(b => b.id === s);
  if (porId) return porId;
  const tipo = EMBED_ALIAS[s] || s;
  return todos.find(b => b.type === tipo && !b.data?.oculto) || null;
}

/* El catálogo tal como lo necesita quien va a ARMAR una página: sin funciones,
   listo para enseñárselo a un modelo o para pintarlo en el editor. */
function catalogoPublico() {
  return Object.entries(BLOQUES).map(([type, d]) => ({
    type,
    label: d.label,
    categoria: d.categoria,
    campos: Object.entries(d.campos).map(([nombre, c]) => ({
      nombre,
      tipo: c.tipo,
      ...(c.max != null ? { max: c.max } : {}),
      ...(c.min != null ? { min: c.min } : {}),
      ...(c.opciones ? { opciones: c.opciones } : {}),
      ...(c.de ? { de: Object.keys(c.de) } : {}),
    })),
  }));
}

module.exports = {
  BLOQUES,
  TIPOS_BLOQUE,
  MAX_BLOQUES_POR_PAGINA,
  MAX_PAGINAS,
  EMBED_ALIAS,
  fallaValor,
  fallaBloque,
  fallaPaginas,
  catalogoPublico,
  bloquesDe,
  bloqueDeSeccion,
};
