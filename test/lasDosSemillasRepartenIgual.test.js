'use strict';

/* Las dos listas de roles semilla reparten lo mismo.
 *
 * ── Por qué hay dos ──────────────────────────────────────────────────────
 *
 * Los roles de un evento nuevo los siembra HOY un disparador de la base:
 * `trg_seed_event_roles`, que lee `private.fn_roles_semilla()`. La lista de
 * `modules/eventos/semillas.js` es el mismo reparto escrito en JavaScript, para
 * el día del corte a servidor propio — por eso usa `INSERT IGNORE`, que es
 * sintaxis de MySQL.
 *
 * Dos listas del mismo reparto, y una de ellas no se ejecuta todavía. Es la
 * receta exacta del fallo de siempre en esta base: la que no corre se queda
 * atrás y nadie se entera, porque no hay nada que falle.
 *
 * ── Y se separaron ───────────────────────────────────────────────────────
 *
 * Medido el 11-sep, cinco de los once roles no coincidían. El peor,
 * «Staff · Logística»: la base le da la puerta, las zonas, la acreditación y
 * los documentos, y la lista de JavaScript le daba `crear_canales` y
 * `gestionar_agenda` — ni siquiera `checkin`.
 *
 * O sea que el día del corte, quien lleva la logística de un evento nuevo se
 * habría quedado sin escanear entradas y con permiso para editar la agenda.
 * Nada de eso da error: da un rol que no sirve, y se descubre en la puerta.
 *
 * ── Qué es autoridad ─────────────────────────────────────────────────────
 *
 * La de SQL, y no por gusto: es la que corre, y es la más nueva (migración
 * 0124). Si alguna vez tienen que decir cosas distintas, se escribe aquí por
 * qué; lo que no puede pasar es que se separen calladas.
 *
 * Correr: npm test */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROLES, CANALES, BLOQUES_INICIALES, paginaPorDefecto } = require('../modules/eventos/semillas.js');
const { TODOS } = require('../core/permisos/catalogo.js');

const RAIZ = path.resolve(__dirname, '..');
const MIGRACION = '0124_permisos_finos_en_vez_de_la_llave_maestra.sql';

/* La lista de la base, sacada de la migración que la define. Se lee del
   fichero y no de la base: un test no puede necesitar credenciales para
   contestar una pregunta que está escrita en el repo. */
function semillaDeLaBase() {
  const sql = fs.readFileSync(path.join(RAIZ, 'db', 'migrations', MIGRACION), 'utf8');
  const i = sql.indexOf('values');
  const bloque = sql.slice(i, sql.indexOf('$$;', i));
  const roles = {};
  for (const m of bloque.matchAll(/\('([^']+)',\s*'[^']*',\s*'(\[[\s\S]*?\])'::jsonb/g)) {
    roles[m[1]] = JSON.parse(m[2].replace(/\s+/g, ' ')).sort();
  }
  return roles;
}

test('la migración sigue definiendo los once roles', () => {
  /* Si esto falla, o se renombró la migración o cambió su forma: el resto de
     los tests de aquí estarían comparando contra un objeto vacío y pasarían
     en verde sin mirar nada. */
  const base = semillaDeLaBase();
  assert.equal(Object.keys(base).length, 11,
    `la migración ${MIGRACION} ya no define once roles: ${Object.keys(base).join(', ')}`);
});

test('los dos reparten los mismos roles, con los mismos nombres', () => {
  const base = Object.keys(semillaDeLaBase()).sort();
  const js = ROLES.map(r => r.nombre).sort();
  assert.deepEqual(js, base, 'un lado siembra un rol que el otro no');
});

test('y cada rol lleva los mismos permisos en los dos', () => {
  const base = semillaDeLaBase();
  const distintos = [];
  for (const r of ROLES) {
    /* El Administrador es el único derivado: sale de `TODOS`, o sea del
       catálogo. Se compara igual, porque la migración lo escribió a mano y
       podría haberse quedado corta. */
    const suyos = [...r.permissions].sort();
    const enLaBase = base[r.nombre];
    if (!enLaBase) continue; // ya lo dice el test de arriba
    const falta = enLaBase.filter(p => !suyos.includes(p));
    const sobra = suyos.filter(p => !enLaBase.includes(p));
    if (falta.length || sobra.length) {
      distintos.push(`${r.nombre}: falta [${falta}] sobra [${sobra}]`);
    }
  }
  assert.deepEqual(distintos, [],
    'las dos semillas se separaron — manda la de SQL, que es la que corre');
});

test('el Administrador de la base no se quedó corto frente al catálogo', () => {
  /* En JavaScript el Administrador se deriva de `TODOS`, así que no puede
     quedarse atrás. En SQL está escrito a mano, y sí puede: un permiso nuevo en
     el catálogo no llega solo a la migración. Hoy quien crea un evento recibe
     la lista de SQL, así que es la que decide de verdad. */
  const base = semillaDeLaBase();
  const admin = base['Administrador'] || [];
  const faltan = TODOS.filter(p => !admin.includes(p));
  assert.deepEqual(faltan, [],
    'el rol «Administrador» que siembra la base no puede todo: '
    + 'hay permisos del catálogo que no le llegan, y nadie se enteraría');
});

/* ── Y las otras dos siembras ─────────────────────────────────────────────
 *
 * `semillas.js` siembra TRES cosas y la base tiene TRES disparadores para lo
 * mismo: roles, canales de chat y la página inicial. Los roles se habían
 * separado; los otros dos se midieron el 11-sep y coincidían.
 *
 * Se fijan aquí igual, y no por simetría: la que no se ejecuta es la que se
 * queda atrás, y las tres están en esa situación hasta el corte a servidor
 * propio. Comprobar sólo la que ya falló es arreglar el caso y dejar la causa.
 */

/* Cada migración es la que DEFINE su función. Se nombra explícitamente en vez
   de buscar por todo `db/migrations`: varias migraciones posteriores la
   mencionan de pasada —la 0030 sólo le fija el `search_path`— y la última que
   la nombra no es la que dice qué hace. */
const leerMigracion = (nombre) =>
  fs.readFileSync(path.join(RAIZ, 'db', 'migrations', nombre), 'utf8');

test('los canales de chat que se siembran son los mismos', () => {
  const sql = leerMigracion('0008_chat.sql');
  const i = sql.indexOf('insert into public.chat_channels (evento_id, nombre, tipo, created_by) values');
  assert.ok(i > 0, 'la 0008 ya no siembra los canales como se esperaba');

  const bloque = sql.slice(i, sql.indexOf(';', i));
  const enLaBase = [...bloque.matchAll(/\(new\.id,\s*'([^']+)',\s*'([^']+)'/g)]
    .map(m => ({ nombre: m[1], tipo: m[2] }));

  assert.deepEqual(
    CANALES.map(c => ({ nombre: c.nombre, tipo: c.tipo })),
    enLaBase,
    'los canales de JavaScript y los de la base ya no son los mismos, ni en el mismo orden');
});

test('la página inicial nace con los mismos bloques y los mismos ids', () => {
  /* Los ids importan más que los tipos: un embed exportado «de esta sección
     exacta» apunta a uno de ellos. Si el corte a servidor propio los cambiara,
     cada código pegado en la web de un organizador dejaría de encontrar su
     bloque — y lo que se vería es un hueco, no un error. */
  const sql = leerMigracion('0010_page_json_v2.sql');
  const i = sql.indexOf('function public.default_page_blocks()');
  assert.ok(i > 0, 'la 0010 ya no define default_page_blocks');

  const bloque = sql.slice(i, sql.indexOf('$$;', i));
  const enLaBase = [...bloque.matchAll(/'id',\s*'([^']+)',\s*'type',\s*'([^']+)'/g)]
    .map(m => ({ id: m[1], type: m[2] }));
  assert.ok(enLaBase.length > 0, 'no se pudo leer ningún bloque de la migración');

  const enJs = paginaPorDefecto().pages[0].blocks.map(b => ({ id: b.id, type: b.type }));
  assert.deepEqual(enJs, enLaBase,
    'la página inicial de JavaScript y la de la base ya no coinciden');

  /* Y `BLOQUES_INICIALES` es la tercera copia de lo mismo, dentro del propio
     `semillas.js`: la lista de tipos que se usa para construirlos. */
  assert.deepEqual(BLOQUES_INICIALES, enLaBase.map(b => b.type),
    'BLOQUES_INICIALES se separó de los bloques que de verdad se siembran');
});
