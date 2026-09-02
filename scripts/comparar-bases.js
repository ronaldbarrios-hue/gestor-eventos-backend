#!/usr/bin/env node
'use strict';

/* scripts/comparar-bases.js — ¿quedó igual lo de MySQL que lo de Supabase?
 *
 * Paso 5 de la fase 6, y el único que decide si el corte se hace o no.
 *
 *   node scripts/comparar-bases.js              # todas las tablas
 *   node scripts/comparar-bases.js eventos      # sólo algunas
 *   node scripts/comparar-bases.js --detalle    # además, qué fila difiere
 *
 * ── Por qué contar filas NO basta ─────────────────────────────────────────
 *
 * Es la comprobación que todo el mundo hace y la que menos protege: una carga
 * que trunca un texto a 255, que pierde los microsegundos de una fecha o que
 * convierte un `null` en cadena vacía deja EXACTAMENTE el mismo número de
 * filas. El día del evento eso es un nombre cortado en una escarapela o una
 * charla que empieza un segundo antes.
 *
 * Así que se compara en tres niveles, de barato a caro:
 *
 *   1. Cuántas filas hay.
 *   2. Una huella por tabla: se ordena por id y se hace un hash del contenido
 *      entero. Si cambia, algo cambió, aunque el conteo cuadre.
 *   3. Sólo si la huella difiere, se buscan las filas concretas (`--detalle`).
 *
 * El nivel 2 es el que aporta. Es una consulta por tabla en cada lado y dice
 * sí o no sobre las 829 columnas a la vez.
 *
 * ── Cómo se normaliza, y por qué eso ES la parte difícil ──────────────────
 *
 * Los dos motores escriben lo mismo de forma distinta, así que comparar el
 * texto crudo daría diferencias falsas en cada fila y el informe sería
 * inservible. Lo que se iguala, y sólo eso:
 *
 *   · Fechas → ISO en UTC, con milisegundos. Postgres da
 *     `2026-09-01 10:00:00+00` y MySQL `2026-09-01 10:00:00.000000`.
 *   · Booleanos → 0/1. En MySQL son TINYINT(1).
 *   · JSON → claves ordenadas. `{"a":1,"b":2}` y `{"b":2,"a":1}` son el mismo
 *     dato y los dos motores no garantizan el orden.
 *   · Arreglos de Postgres → JSON, que es a lo que se migran.
 *   · `null` se queda `null` y NO se convierte en cadena vacía: la diferencia
 *     entre «no contestó» y «contestó vacío» es justo lo que se quiere vigilar.
 *
 * Lo que NO se normaliza a propósito: los espacios al final de un texto, y las
 * mayúsculas. Si la carga los cambió, eso es una diferencia de verdad.
 *
 * ── Este script no arregla nada ───────────────────────────────────────────
 *
 * Sólo lee, de los dos lados. Si algo no cuadra lo dice y para; corregirlo es
 * volver a correr la carga, no parchear filas a mano — una fila parcheada deja
 * la duda de cuántas más habrá.
 */

const crypto = require('crypto');

/* Los dos clientes se cargan TARDE, cuando alguien va a comparar de verdad.
   Por la misma razón que `core/db/mysql.js` crea sus pools tarde: las pruebas
   de la normalización de aquí abajo no montan ninguna base, y si `supabase.js`
   se cargara al importar, exigiría sus variables y el archivo entero dejaría
   de poder probarse. */
const clientes = {
  get supabase() { return require('../lib/supabase.js'); },
  get bd()       { return require('../core/db/mysql.js').bd; },
};

/* TODAS las tablas de `db/esquema/01_tablas.sql` (70 al escribir esto), no un
   subconjunto. Antes esta lista traía sólo 24 y el script imprimía "Todo
   cuadra" igual, sin decir que dejaba fuera torneos, oauth_tokens,
   discount_codes, evento_legal, padron_previo, email_cola y el resto — que es
   justo el paso que decide si el corte se hace. Si el esquema gana una tabla
   nueva y esta lista no se actualiza, `verificarCobertura()` (más abajo) lo
   dice al arrancar en vez de callarlo. */
const TABLAS = [
  'agenda_favoritos', 'agenda_sessions', 'api_tokens', 'audit_log', 'canjes',
  'catalogo_roles', 'categorias', 'chat_channel_prefs', 'chat_channels', 'chat_messages',
  'cobros_vacantes', 'discount_codes', 'email_cola', 'email_log', 'event_form_fields',
  'event_members', 'event_requests', 'event_roles', 'event_views', 'event_waitlist',
  'evento_alertas', 'evento_anuncios', 'evento_bolsa_puntos', 'evento_email_envios',
  'evento_email_plantillas', 'evento_legal', 'evento_motivos', 'evento_smtp', 'eventos',
  'missions', 'networking_citas', 'networking_expositores', 'networking_horarios',
  'notificaciones', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'organizador_conexiones',
  'padron_previo', 'payment_transactions', 'perfil_talento', 'points_log', 'postulaciones',
  'profiles', 'promociones', 'puntos_balance', 'push_subscriptions', 'recompensas',
  'recordatorio_inapp_log', 'referral_codes', 'sesion_inscripciones', 'speakers', 'sponsors',
  'sugerencias_catalogo', 'sugerencias_dinamica', 'talento_resenas', 'tarea_log', 'tareas',
  'ticket_interacciones', 'ticket_movimientos', 'ticket_types', 'tickets',
  'torneo_categorias', 'torneo_equipos', 'torneo_partidos', 'torneos',
  'user_badges', 'vacantes', 'waitlist', 'webhook_deliveries', 'webhooks', 'zona_cortes',
];

/* Casi todas las tablas se ordenan y emparejan por `id`. Las que NO lo tienen
   (comprobado contra `db/esquema/01_tablas.sql`, su `PRIMARY KEY` real) van
   aquí con su clave natural — sin esto, `ORDER BY id` truena o empareja mal
   en las seis que quedan fuera del patrón. */
const CLAVE_POR_TABLA = {
  chat_channel_prefs: ['channel_id', 'user_id'],
  organizador_conexiones: ['owner_id', 'tipo'],
  evento_bolsa_puntos: ['evento_id'],
  evento_legal: ['evento_id'],
  oauth_clients: ['client_id'],
  oauth_codes: ['code_hash'],
};
const claveDe = (tabla) => CLAVE_POR_TABLA[tabla] || ['id'];
const claveFila = (fila, clave) => clave.map(c => String(fila[c])).join('::');

/* Si el esquema real gana una tabla y esta lista no se entera, mejor decirlo
   fuerte que dejar que "Todo cuadra" hable de menos tablas de las que hay. No
   se compara contra la base en vivo (eso costaría una conexión más sólo para
   esto) — se compara contra el propio archivo de esquema, que es la fuente
   que un humano edita cuando agrega una tabla. */
function verificarCobertura() {
  const fs = require('fs');
  const path = require('path');
  const ruta = path.join(__dirname, '..', 'db', 'esquema', '01_tablas.sql');
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch { return; }   // en cPanel puede no estar
  const reales = [...texto.matchAll(/CREATE TABLE `([a-z_0-9]+)`/gi)].map(m => m[1]);
  const conocidas = new Set(TABLAS);
  const nuevas = reales.filter(t => !conocidas.has(t));
  if (nuevas.length) {
    console.log(`\n⚠ ${nuevas.length} tabla(s) en el esquema que este script todavía no compara: ${nuevas.join(', ')}.`);
    console.log('  Añádelas a TABLAS en scripts/comparar-bases.js antes de fiarte del corte.\n');
  }
}

/* ── Normalización ─────────────────────────────────────────────────────── */

function normalizar(v) {
  if (v === null || v === undefined) return null;

  if (typeof v === 'boolean') return v ? 1 : 0;

  /* MySQL devuelve TINYINT(1) como número; Postgres, como booleano. Un 0/1
     suelto en una columna que es booleana en los dos lados es lo mismo. */
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toFixed(6));

  if (v instanceof Date) return v.toISOString();

  if (Array.isArray(v)) return JSON.stringify(v.map(normalizar));

  if (typeof v === 'object') return JSON.stringify(ordenarClaves(v));

  const s = String(v);

  /* Fechas en texto: los dos motores las devuelven así con `dateStrings`.
     Se pasan a ISO para que `+00` y `.000000` no cuenten como diferencia. */
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.includes('+') || s.endsWith('Z') ? s : `${s}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  /* JSON guardado como texto: se compara por contenido y no por formato. */
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.stringify(ordenarClaves(JSON.parse(s))); } catch { /* era texto */ }
  }

  return s;
}

/* Claves ordenadas, en profundidad: dos JSON con las mismas claves en distinto
   orden son el mismo dato, y ningún motor garantiza el orden al devolverlo. */
function ordenarClaves(v) {
  if (Array.isArray(v)) return v.map(ordenarClaves);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = ordenarClaves(v[k]);
    return out;
  }
  return v;
}

function huellaFila(fila, columnas) {
  const partes = columnas.map(c => `${c}=${JSON.stringify(normalizar(fila[c]))}`);
  return crypto.createHash('sha256').update(partes.join('|')).digest('hex');
}

/* ── Lectura de cada lado ──────────────────────────────────────────────── */

async function leerSupabase(tabla) {
  /* En páginas: PostgREST devuelve 1.000 filas por defecto y pedir «todo» sin
     paginar es exactamente el fallo que este script existe para cazar. */
  const clave = claveDe(tabla);
  const filas = [];
  const TAM = 1000;
  for (let desde = 0; ; desde += TAM) {
    let q = clientes.supabase.from(tabla).select('*').range(desde, desde + TAM - 1);
    for (const c of clave) q = q.order(c, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`Supabase/${tabla}: ${error.message}`);
    filas.push(...(data || []));
    if (!data || data.length < TAM) break;
  }
  return filas;
}

async function leerMysql(tabla) {
  const orden = claveDe(tabla).map(c => `\`${c}\``).join(', ');
  return clientes.bd('datos').consultar(`SELECT * FROM \`${tabla}\` ORDER BY ${orden} ASC`);
}

/* ── La comparación ────────────────────────────────────────────────────── */

async function compararTabla(tabla, { detalle }) {
  let pg, my;
  try {
    [pg, my] = await Promise.all([leerSupabase(tabla), leerMysql(tabla)]);
  } catch (e) {
    return { tabla, estado: 'ERROR', nota: e.message };
  }

  if (pg.length !== my.length) {
    return { tabla, estado: 'DIFIERE', nota: `filas: Supabase ${pg.length}, MySQL ${my.length}` };
  }
  if (pg.length === 0) return { tabla, estado: 'VACÍA', nota: 'sin filas en ninguna' };

  /* Las columnas de Supabase mandan: son las que la aplicación lee hoy. Una
     columna de más en MySQL no rompe nada; una de menos, sí. */
  const columnas = Object.keys(pg[0]).sort();
  const faltan = columnas.filter(c => !(c in my[0]));
  if (faltan.length) {
    return { tabla, estado: 'DIFIERE', nota: `faltan columnas en MySQL: ${faltan.join(', ')}` };
  }

  const clave = claveDe(tabla);
  const porId = new Map(my.map(f => [claveFila(f, clave), f]));
  const distintas = [];
  for (const filaPg of pg) {
    const id = claveFila(filaPg, clave);
    const filaMy = porId.get(id);
    if (!filaMy) { distintas.push({ id, motivo: 'no está en MySQL' }); continue; }
    if (huellaFila(filaPg, columnas) !== huellaFila(filaMy, columnas)) {
      const campos = detalle
        ? columnas.filter(c => JSON.stringify(normalizar(filaPg[c])) !== JSON.stringify(normalizar(filaMy[c])))
        : null;
      distintas.push({ id, motivo: campos ? `difieren: ${campos.join(', ')}` : 'contenido distinto' });
    }
    if (distintas.length >= 20) break;   // con veinte ya se ve el patrón
  }

  if (distintas.length) {
    return { tabla, estado: 'DIFIERE', nota: `${distintas.length} fila(s)`, distintas };
  }
  return { tabla, estado: 'IGUAL', nota: `${pg.length} filas` };
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const detalle = args.includes('--detalle');
  const pedidas = args.filter(a => !a.startsWith('--'));
  const tablas = pedidas.length ? pedidas : TABLAS;

  if (!clientes.bd('datos').configurada()) {
    console.error('\nMySQL no está configurada. Sin las dos bases no hay nada que comparar.\n');
    process.exit(1);
  }

  if (!pedidas.length) verificarCobertura();

  console.log(`\nComparando ${tablas.length} tabla(s)…\n`);
  const resultados = [];
  for (const t of tablas) {
    const r = await compararTabla(t, { detalle });
    resultados.push(r);
    const icono = { IGUAL: '✓', 'VACÍA': '·', DIFIERE: '✗', ERROR: '!' }[r.estado];
    console.log(`  ${icono} ${t.padEnd(26)} ${r.estado.padEnd(8)} ${r.nota}`);
    if (r.distintas) for (const d of r.distintas.slice(0, 5)) console.log(`      ${d.id}: ${d.motivo}`);
  }

  const mal = resultados.filter(r => r.estado === 'DIFIERE' || r.estado === 'ERROR');
  console.log('');
  if (mal.length) {
    console.log(`${mal.length} tabla(s) no cuadran. NO se corta todavía.`);
    if (!detalle) console.log('Corre otra vez con --detalle para ver qué columnas difieren.\n');
    process.exit(1);
  }
  console.log(`Todo cuadra en las ${resultados.length} tabla(s) comparadas. Las dos bases dicen lo mismo.\n`);
  process.exit(0);
}

if (require.main === module) main().catch(e => { console.error('\n', e.message, '\n'); process.exit(1); });

module.exports = { normalizar, ordenarClaves, huellaFila, TABLAS, CLAVE_POR_TABLA, claveDe, claveFila };
