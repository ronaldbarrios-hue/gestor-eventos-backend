'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  tocar, versionLegal, puentePageJson, expositorDesdeBoleta,
} = require('../modules/eventos/derivados.js');

/* ── La huella del texto legal ───────────────────────────────────────────── */

test('la version legal es el md5 de los cuatro campos unidos por |', () => {
  const r = versionLegal({
    terminos_texto: 'a', terminos_url: 'b',
    privacidad_texto: 'c', privacidad_url: 'd',
  });
  const crypto = require('crypto');
  assert.equal(r.version, crypto.createHash('md5').update('a|b|c|d').digest('hex'));
});

test('los campos nulos cuentan como cadena vacia, como el coalesce del original', () => {
  const a = versionLegal({ terminos_texto: 'x' }).version;
  const b = versionLegal({
    terminos_texto: 'x', terminos_url: null,
    privacidad_texto: null, privacidad_url: null,
  }).version;
  assert.equal(a, b);
});

test('cambiar cualquiera de los cuatro cambia la huella', () => {
  const base = { terminos_texto: 'a', terminos_url: 'b', privacidad_texto: 'c', privacidad_url: 'd' };
  const v0 = versionLegal(base).version;
  for (const k of Object.keys(base)) {
    assert.notEqual(versionLegal({ ...base, [k]: 'z' }).version, v0, k);
  }
});

test('el orden importa: no es lo mismo a|b que b|a', () => {
  assert.notEqual(
    versionLegal({ terminos_texto: 'a', terminos_url: 'b' }).version,
    versionLegal({ terminos_texto: 'b', terminos_url: 'a' }).version,
  );
});

/* ── El sello de tiempo ──────────────────────────────────────────────────── */

test('tocar pone updated_at y no pierde el resto de la fila', () => {
  const r = tocar({ id: 7, asunto: 'Hola' });
  assert.equal(r.id, 7);
  assert.equal(r.asunto, 'Hola');
  assert.ok(r.updated_at instanceof Date);
});

/* ── El puente de page_json ──────────────────────────────────────────────── */

test('al insertar, las columnas se copian al json', () => {
  const r = puentePageJson({
    paginas: [{ id: 'p1' }], branding: { color: 'rojo' }, navbar: {}, page_json: {},
  });
  assert.deepEqual(r.page_json.pages, [{ id: 'p1' }]);
  assert.deepEqual(r.page_json.branding, { color: 'rojo' });
  assert.ok(!('navbar' in r.page_json), 'el navbar vacio no se copia');
});

test('si cambia la columna, manda la columna', () => {
  const previa = { paginas: [{ id: 'v' }], branding: {}, navbar: {}, page_json: { pages: [{ id: 'v' }] } };
  const r = puentePageJson({ ...previa, paginas: [{ id: 'nueva' }] }, previa);
  assert.deepEqual(r.paginas, [{ id: 'nueva' }]);
  assert.deepEqual(r.page_json.pages, [{ id: 'nueva' }]);
});

test('si solo cambia el json, manda el json y baja a la columna', () => {
  const previa = { paginas: [{ id: 'v' }], branding: {}, navbar: {}, page_json: { pages: [{ id: 'v' }] } };
  const nueva  = { ...previa, page_json: { pages: [{ id: 'desde-json' }] } };
  const r = puentePageJson(nueva, previa);
  assert.deepEqual(r.paginas, [{ id: 'desde-json' }]);
  assert.deepEqual(r.page_json.pages, [{ id: 'desde-json' }]);
});

/* Este es el fallo que costo encontrar la primera vez: si borrar la marca solo
   dejara de escribirla, el codigo viejo la leeria del json y la resucitaria. */
test('borrar la marca la borra TAMBIEN de dentro del json', () => {
  const previa = {
    paginas: [], branding: { color: 'rojo' }, navbar: {},
    page_json: { pages: [], branding: { color: 'rojo' } },
  };
  const r = puentePageJson({ ...previa, branding: {} }, previa);
  assert.deepEqual(r.branding, {});
  assert.ok(!('branding' in r.page_json), 'la copia del json tiene que irse con ella');
});

test('lo mismo con el navbar', () => {
  const previa = {
    paginas: [], branding: {}, navbar: { orden: ['a'] },
    page_json: { pages: [], navbar: { orden: ['a'] } },
  };
  const r = puentePageJson({ ...previa, navbar: {} }, previa);
  assert.ok(!('navbar' in r.page_json));
});

test('si no cambia nada, la columna se copia igual y nada se pierde', () => {
  const previa = {
    paginas: [{ id: 'p' }], branding: { c: 1 }, navbar: { n: 2 },
    page_json: { pages: [{ id: 'p' }], branding: { c: 1 }, navbar: { n: 2 }, seo: { t: 'x' } },
  };
  const r = puentePageJson({ ...previa }, previa);
  assert.deepEqual(r.page_json.branding, { c: 1 });
  assert.deepEqual(r.page_json.seo, { t: 'x' }, 'lo que no toca el puente no se toca');
});

/* Una copia nueva con el MISMO contenido no es un cambio. Comparar con !==
   daria «cambio» siempre y la columna ganaria en todos los casos. */
test('un objeto nuevo con el mismo contenido no cuenta como cambio', () => {
  const previa = { paginas: [], branding: {}, navbar: {}, page_json: { pages: [], navbar: { n: 1 } } };
  const nueva  = { paginas: [], branding: {}, navbar: { n: 1 }, page_json: { pages: [], navbar: { n: 1 } } };
  const r = puentePageJson(nueva, { ...previa, navbar: { n: 1 } });
  assert.deepEqual(r.navbar, { n: 1 });
});

/* ── El expositor que nace de su boleta ──────────────────────────────────── */

function baseFalsa(tipo, registro) {
  return () => ({
    unaFila: async () => tipo,
    consultar: async (sql, params) => { registro.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return []; },
  });
}

test('una boleta que no es de expositor no toca nada', async () => {
  const reg = [];
  const r = await expositorDesdeBoleta(baseFalsa({ es_expositor: 0 }, reg), { estado: 'pagado' });
  assert.equal(r.accion, 'ninguna');
  assert.equal(reg.length, 0);
});

test('una boleta de expositor pagada da de alta la ficha', async () => {
  const reg = [];
  const r = await expositorDesdeBoleta(baseFalsa({ es_expositor: 1 }, reg), {
    id: 'b1', evento_id: 'e1', ticket_type_id: 't1',
    estado: 'pagado', guest_nombre: '  Acme  ', guest_email: 'a@b.c',
  });
  assert.equal(r.accion, 'alta');
  assert.match(reg[0].sql, /INSERT INTO networking_expositores/);
  assert.match(reg[0].sql, /ON DUPLICATE KEY UPDATE activo = 1/);
  assert.equal(reg[0].params[2], 'Acme', 'el nombre se recorta');
});

test('sin nombre, la ficha se llama Expositor', async () => {
  const reg = [];
  await expositorDesdeBoleta(baseFalsa({ es_expositor: 1 }, reg), {
    id: 'b1', evento_id: 'e1', ticket_type_id: 't1', estado: 'pagado', guest_nombre: '   ',
  });
  assert.equal(reg[0].params[2], 'Expositor');
});

test('reactivar no pisa lo que el expositor haya editado', async () => {
  const reg = [];
  await expositorDesdeBoleta(baseFalsa({ es_expositor: 1 }, reg), {
    id: 'b1', evento_id: 'e1', ticket_type_id: 't1', estado: 'pagado',
  });
  const dupe = reg[0].sql.split('ON DUPLICATE KEY UPDATE')[1];
  assert.ok(!/nombre|contacto_email|estado_ficha/.test(dupe),
    'al reactivar solo se toca `activo`');
});

for (const estado of ['cancelado', 'reembolsado', 'invalido']) {
  test(`una boleta ${estado} desactiva la ficha`, async () => {
    const reg = [];
    const r = await expositorDesdeBoleta(baseFalsa({ es_expositor: 1 }, reg), {
      id: 'b1', ticket_type_id: 't1', estado,
    });
    assert.equal(r.accion, 'baja');
    assert.match(reg[0].sql, /UPDATE networking_expositores SET activo = 0/);
  });
}

test('un estado intermedio no da de alta ni de baja', async () => {
  const reg = [];
  const r = await expositorDesdeBoleta(baseFalsa({ es_expositor: 1 }, reg), {
    id: 'b1', ticket_type_id: 't1', estado: 'emitido',
  });
  assert.equal(r.accion, 'ninguna');
  assert.equal(reg.length, 0);
});
