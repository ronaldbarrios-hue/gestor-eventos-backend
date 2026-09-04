/* Un solo sitio para los descuentos.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Había DOS tablas de códigos de descuento y nunca se conocieron:
 *
 *   · `promociones`    — la del panel, y la que lee el cobro.
 *   · `discount_codes` — la del agente. Nadie aplicaba nunca lo que había
 *                        dentro.
 *
 * O sea: le pedías a Gestbot «crea el código FESTECH20 del 20 %», contestaba
 * que estaba creado —y lo estaba, en una tabla—, y quien compraba escribía
 * FESTECH20 y le decían que no existe. La plataforma se contradecía a sí misma
 * según por dónde entraras. En producción había dos códigos así.
 *
 * Esta prueba no comprueba que el agente funcione: comprueba que **escribe
 * donde se cobra**. Es lo único que hace falta romper para que vuelva a pasar.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* Sin comentarios: los archivos EXPLICAN de qué tabla se salió, y ese texto
   trae el nombre que la prueba prohíbe. */
const sinComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--')).join('\n');

test('nadie escribe ni lee ya en la tabla vieja', () => {
  const culpables = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
      if (!f.endsWith('.js')) continue;
      if (/discount_codes/.test(sinComentarios(leer(`${dir}/${f}`)))) culpables.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(culpables, [],
    `siguen usando \`discount_codes\`, que no la aplica nadie: ${culpables.join(', ')}`);
});

test('las herramientas de descuento del agente escriben en `promociones`', () => {
  const src = sinComentarios(leer('lib/agente.js'));
  const usos = src.match(/from\('promociones'\)/g) || [];
  assert.ok(usos.length >= 3,
    `el agente toca \`promociones\` ${usos.length} veces y sus herramientas de descuento son tres (crear, listar, cambiar estado)`);
});

test('el vocabulario de fuera se traduce, no se filtra', () => {
  /* `percent`/`fixed` es lo que entiende la herramienta y lo que ya está en las
     conversaciones; `porcentaje`/`fijo` es lo que entiende la tabla. Guardar el
     de fuera tal cual dejaría un `tipo` que `precioDeCompra` no reconoce, y un
     descuento que no reconoce el que cobra se aplica como porcentaje. */
  const src = leer('lib/agente.js');
  assert.match(src, /'fixed'\s*\?\s*'fijo'\s*:\s*'porcentaje'/,
    'el tipo del agente entra sin traducir a la tabla');
});

test('quien cobra sólo entiende dos tipos, y son los de la tabla', () => {
  const src = leer('lib/precioTicket.js');
  assert.match(src, /promocion\.tipo === 'fijo'/);
  assert.doesNotMatch(sinComentarios(src), /'fixed'|'percent'/,
    'el que cobra conoce el vocabulario del agente: eso son dos idiomas otra vez');
});

test('la migración que junta las dos está escrita y es reversible', () => {
  const sql = leer('db/migrations/0100_un_solo_sitio_para_los_descuentos.sql');
  assert.match(sql, /insert into public\.promociones/, 'no copia lo que ya había');
  assert.match(sql, /not exists/, 'sin guarda: el mismo código dos veces rompe el unique (evento_id, codigo)');
  assert.match(sql, /Rollback/, 'sin rollback escrito');
  assert.doesNotMatch(sql, /drop table/i,
    'borra la tabla vieja en la misma migración: si el despliegue va por detrás, el agente viejo revienta');
});
