'use strict';

/* Ningún permiso del catálogo se puede conceder sin que conceda nada.
 *
 * ── El fallo del que avisa ───────────────────────────────────────────────
 *
 * `publicar_anuncios` existía desde la migración 0122, salía en el panel con
 * su etiqueta «Publicar anuncios», y ninguna ruta lo comprobaba. La ruta que
 * manda el aviso a todo el evento seguía preguntando por `owner_id`.
 *
 * Medido en producción antes de arreglarlo: 34 roles lo tenían concedido, y
 * los 34 recibían un 403.
 *
 * Es el fallo de siempre de esta base en su peor forma. Un permiso que FALTA
 * se nota: alguien choca contra un 403 y se añade. Uno que SOBRA no se nota,
 * porque quien armó el rol marcó la casilla y se quedó tranquilo — y el 403
 * llega semanas después, con la casilla marcada delante y sin nada que mirar.
 *
 * Correr: npm test */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CATALOGO } = require('../core/permisos/catalogo.js');

const RAIZ = path.resolve(__dirname, '..');
const CARPETAS = ['routes', 'modules', 'core', 'lib'];

/* Todo el código que puede comprobar un permiso, en un solo texto. */
const fuente = (() => {
  let acc = '';
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.git|\.claude/.test(p)) recorrer(p); }
      else if (e.name.endsWith('.js')) acc += fs.readFileSync(p, 'utf8');
    }
  };
  for (const c of CARPETAS) { const d = path.join(RAIZ, c); if (fs.existsSync(d)) recorrer(d); }
  return acc;
})();

/* Sin comentarios: el catálogo se explica a sí mismo nombrando sus ids, y un
   permiso «comprobado» sólo dentro de una explicación no comprueba nada. Es
   el error que ya se cometió midiendo esto a ojo. */
const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('todo permiso que se puede conceder lo comprueba alguien', () => {
  const huerfanos = [];
  for (const { id, label } of CATALOGO) {
    /* El comodín no se comprueba por su nombre: es «puede todo», y lo resuelve
       el guardia sin nombrarlo en ninguna ruta. */
    if (id === '*') continue;

    /* Se busca de las dos formas en que este código pregunta por un permiso:
       como texto entrecomillado —`exige(['x'])`, `permisos.includes('x')`— y
       como clave de objeto, que es como lo hace `lib/quePuedeEditar.js` al
       recortar `page_json`. Mirando sólo la primera, dos permisos que sí se
       comprueban salían como huérfanos. */
    const comoTexto = new RegExp(`'${id}'|"${id}"`, 'g');
    const comoClave = new RegExp(`(^|[^\w])${id}\s*:`, 'gm');
    const veces = (sinComentarios.match(comoTexto) || []).length
                + (sinComentarios.match(comoClave) || []).length;

    /* Una sola aparición es su propia línea del catálogo. */
    if (veces <= 1) huerfanos.push(`${id} («${label}»)`);
  }

  assert.deepEqual(huerfanos, [],
    'estos permisos se pueden marcar en el panel y no abren ninguna puerta:\n  ' + huerfanos.join('\n  '));
});

test('la lista de espera no es del dueño y de nadie más', () => {
  /* Mirar quién espera un cupo y ofrecérselo cuando alguien cancela es trabajo
     de logística. Con `owner_id` había que dar permisos muy altos a quien sólo
     tenía que atender la fila — que es literalmente lo que pasó capacitando. */
  const src = fs.readFileSync(path.join(RAIZ, 'routes/waitlist.js'), 'utf8');
  assert.ok(!/verificarOwner/.test(src),
    'la lista de espera vuelve a comprobar owner_id a mano');
  const rutas = src.match(/^router\.(get|post|patch|delete)\(/gm) || [];
  const guardadas = src.match(/^router\.(get|post|patch|delete)\([^,]+,\s*exige\(/gm) || [];
  assert.equal(guardadas.length, rutas.length,
    `${rutas.length - guardadas.length} rutas de la lista de espera sin permiso declarado`);
});

test('el aviso a todo el evento pide el permiso que dice el panel', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'routes/push.js'), 'utf8');
  const i = src.indexOf("push/broadcast'");
  assert.ok(i > 0, 'no encontré la ruta del aviso');
  const ruta = src.slice(i, i + 400);
  assert.match(ruta, /exige\(\['publicar_anuncios'\]\)/,
    'el aviso a todo el evento no pide `publicar_anuncios`');
  assert.ok(!/ev\.owner_id !== req\.user\.id/.test(ruta),
    'sigue exigiendo ser el dueño, así que el permiso no sirve de nada');
});
