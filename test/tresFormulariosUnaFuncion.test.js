/* Los tres formularios se guardan por la misma puerta.
 *
 * `event_form_fields` guarda TRES cosas: las preguntas de la compra de una
 * boleta, las de un sub-evento (`session_id`) y las de un torneo (`torneo_id`).
 * Guardar cualquiera de las tres BORRA lo que no venga en el payload, así que
 * lo único que separa «guardar mis preguntas» de «borrar las de los demás» es
 * el filtro.
 *
 * Ese filtro estaba escrito a mano tres veces, en tres rutas, con cien líneas
 * casi iguales cada una — el modo de fallo de este proyecto: una de las tres se
 * olvida un `is('session_id', null)` y nadie se entera hasta que un editor se
 * lleva por delante el formulario de otro.
 *
 * Estas pruebas sujetan las dos cosas que importan: que el filtro con el que se
 * lee es el mismo con el que se borra, y que las tres rutas pasan por aquí.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

/* ── Un supabase de mentira que apunta lo que le piden ──────────────────── */
function falso(filas) {
  const registro = { select: [], delete: [], insert: [], update: [] };
  const tabla = () => {
    const q = { filtros: [], _op: 'select', _cols: null };
    const anota = (tipo, col, val) => { q.filtros.push(`${tipo}:${col}=${val}`); return q; };
    q.eq = (c, v) => anota('eq', c, v);
    q.is = (c, v) => anota('is', c, v);
    q.in = (c, v) => { q._ids = v; return anota('in', c, JSON.stringify(v)); };
    q.order = () => q;
    q.select = (cols) => { q._cols = cols; return q; };
    q.delete = () => { q._op = 'delete'; return q; };
    q.update = (fila) => { q._op = 'update'; q._fila = fila; return q; };
    q.insert = (f) => { registro.insert.push(f); return Promise.resolve({ error: null }); };
    /* Es «thenable»: las rutas hacen `await` sobre la consulta sin llamar a
       nada más, igual que supabase-js. */
    q.then = (resolver) => {
      registro[q._op].push({ filtros: q.filtros.join(' '), cols: q._cols, ids: q._ids, fila: q._fila });
      return Promise.resolve(resolver({ data: q._op === 'select' ? filas : null, error: null }));
    };
    return q;
  };
  return { registro, cliente: { from: () => tabla() } };
}

function conFalso(filas, fn) {
  const ruta = require.resolve('../lib/supabase.js');
  const antes = require.cache[ruta];
  const { registro, cliente } = falso(filas);
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: cliente };
  return Promise.resolve(fn(registro)).finally(() => {
    if (antes) require.cache[ruta] = antes; else delete require.cache[ruta];
  });
}

const { guardarCampos, catalogoDeFormulario } = require('../lib/guardarCampos.js');

const CASOS = [
  { nombre: 'evento', alcance: {}, espera: ['is:session_id=null', 'is:torneo_id=null'] },
  { nombre: 'sub-evento', alcance: { session_id: 's1' }, espera: ['eq:session_id=s1', 'is:torneo_id=null'] },
  { nombre: 'torneo', alcance: { torneo_id: 't1' }, espera: ['eq:torneo_id=t1', 'is:session_id=null'] },
];

for (const caso of CASOS) {
  test(`el formulario de ${caso.nombre} lee y borra con el mismo filtro`, async () => {
    await conFalso([{ id: 'viejo' }], async (registro) => {
      /* Se manda una pregunta nueva y ninguna de las que ya hay: eso obliga a
         borrar, que es la operación peligrosa. */
      const r = await guardarCampos({
        eventoId: 'e1', alcance: caso.alcance,
        campos: [{ tipo: 'texto', etiqueta: 'Talla' }],
      });
      assert.equal(r.error, undefined, 'no debería fallar');

      const lectura = registro.select[0].filtros;
      assert.ok(lectura.includes('eq:evento_id=e1'), 'la lectura no se ata al evento');
      for (const trozo of caso.espera) {
        assert.ok(lectura.includes(trozo), `la lectura no lleva ${trozo}: ${lectura}`);
      }

      /* Y el borrado va por id, y sólo por los ids que devolvió ESA lectura. Si
         algún día borrase con un filtro propio, ese filtro podría no ser el
         mismo — que es exactamente el fallo del que protege este archivo. */
      assert.equal(registro.delete.length, 1, 'no borró lo que ya no viene');
      assert.deepEqual(registro.delete[0].ids, ['viejo']);
    });
  });
}

test('una pregunta de sub-evento o de torneo no se guarda atada a un tipo de boleta', async () => {
  /* «Sólo para el tipo VIP» es del formulario de COMPRA. Colarlo en un taller
     escondería la pregunta sin que nadie sepa por qué. */
  for (const alcance of [{ session_id: 's1' }, { torneo_id: 't1' }]) {
    await conFalso([], async (registro) => {
      await guardarCampos({
        eventoId: 'e1', alcance,
        campos: [{ tipo: 'texto', etiqueta: 'Talla', ticket_type_id: 'vip' }],
      });
      assert.equal(registro.insert[0][0].ticket_type_id, null);
    });
  }
});

test('en el formulario del evento el tipo de boleta SÍ se respeta', async () => {
  await conFalso([], async (registro) => {
    await guardarCampos({
      eventoId: 'e1', alcance: {},
      campos: [{ tipo: 'texto', etiqueta: 'Talla', ticket_type_id: 'vip' }],
    });
    assert.equal(registro.insert[0][0].ticket_type_id, 'vip');
  });
});

test('las tres rutas guardan por la función, ninguna a mano', () => {
  for (const f of ['routes/eventos.js', 'routes/sesiones.js', 'routes/torneos.js']) {
    const src = leer(f);
    assert.ok(src.includes('guardarCampos('), `${f} no usa guardarCampos()`);
    /* Y ninguna se queda con su copia del diff: si vuelve a aparecer un
       `delete()` sobre esta tabla en una ruta, o pasa por la función, o hay que
       venir aquí a explicar por qué no. */
    const suyas = src.split("from('event_form_fields')").slice(1).map(c => c.slice(0, 300));
    const borra = suyas.filter(c => /\.delete\(\)/.test(c));
    assert.deepEqual(borra, [], `${f} borra campos por su cuenta`);
  }
});

test('los tres editores reciben el mismo catálogo', () => {
  /* Las fichas prearmadas y la importación desde una hoja existían sólo en el
     formulario del evento: las otras dos rutas armaban su respuesta a mano y se
     las dejaban fuera. No fallaba nada — simplemente había que escribir
     veintiuna preguntas de un torneo a mano, una a una, mientras la misma
     pantalla las importaba de un Excel para el evento. */
  const c = catalogoDeFormulario();
  for (const clave of ['tipos', 'grupos', 'fichas', 'plantilla', 'max_campos']) {
    assert.ok(c[clave], `el catálogo no trae ${clave}`);
  }
  assert.ok(c.fichas.length > 0, 'sin fichas prearmadas');

  for (const f of ['routes/eventos.js', 'routes/sesiones.js', 'routes/torneos.js']) {
    assert.ok(leer(f).includes('catalogoDeFormulario('),
      `${f} arma su propio catálogo: así es como se separan`);
  }
});

test('el tope de cada formulario sigue siendo suyo', () => {
  /* Compartir la función no es compartir el tope: un torneo y un taller tienen
     el suyo, y la función lo recibe en vez de imponerlo. */
  assert.equal(catalogoDeFormulario({ max: 12 }).max_campos, 12);
});
