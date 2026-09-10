/* No se emite dos veces la misma boleta gratuita a la misma persona.
 *
 * Medido en un evento real: de 48 repeticiones, 45 eran la MISMA actividad y
 * sólo 3 eran de otra (que es legítimo: el registro general y un taller). De
 * esas 45, 22 ocurrieron en un solo día con separaciones de 1 a 59 segundos —
 * el día en que el servidor insertaba la boleta y después devolvía un 500, así
 * que la gente volvía a darle a Enviar.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { boletaQueYaTenia } = require('../lib/yaEstabaRegistrado.js');

function conFalso(filas, fn) {
  const ruta = require.resolve('../lib/supabase.js');
  const antes = require.cache[ruta];
  let pedido = null;
  const q = {
    _f: {},
    select() { return q; },
    eq(c, v) { q._f[c] = v; return q; },
    order() { return q; },
    limit() { pedido = { ...q._f }; return Promise.resolve({ data: filas, error: null }); },
  };
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: { from: () => q } };
  return Promise.resolve(fn(() => pedido)).finally(() => {
    if (antes) require.cache[ruta] = antes; else delete require.cache[ruta];
  });
}

const ANA = { id: 't1', codigo: 'ABC123', estado: 'pagado', guest_nombre: 'Ana Pérez', guest_email: 'ana@x.co' };

test('la misma persona en la misma boleta: se le devuelve la que ya tiene', async () => {
  await conFalso([ANA], async (filtros) => {
    const ya = await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', email: 'ANA@x.co ', nombre: 'ana  pérez' });
    assert.equal(ya?.codigo, 'ABC123');
    /* El correo se normaliza antes de preguntar; el nombre se compara aquí,
       porque en la base está tal como lo escribió la persona. */
    assert.equal(filtros().guest_email, 'ana@x.co');
    assert.equal(filtros().evento_id, 'e1');
    assert.equal(filtros().ticket_type_id, 'tt1');
  });
});

test('otro nombre con el mismo correo NO es la misma persona', async () => {
  /* Un correo no es una persona: en los datos reales, 12 de 45 repeticiones
     traían otro nombre — alguien inscribiendo a su equipo o a su familia con su
     propio correo. Cortar por correo a secas le habría dicho «ya estás
     registrado» a quien iba por la segunda persona. */
  await conFalso([ANA], async () => {
    const ya = await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', email: 'ana@x.co', nombre: 'Luis Pérez' });
    assert.equal(ya, null);
  });
});

test('una boleta anulada no bloquea volver a registrarse', async () => {
  for (const estado of ['invalido', 'reembolsado', 'cancelado']) {
    await conFalso([{ ...ANA, estado }], async () => {
      const ya = await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', email: 'ana@x.co', nombre: 'Ana Pérez' });
      assert.equal(ya, null, `un ticket ${estado} no debería bloquear`);
    });
  }
  /* `usado` sí bloquea: esa persona ya entró. */
  await conFalso([{ ...ANA, estado: 'usado' }], async () => {
    assert.ok(await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', email: 'ana@x.co', nombre: 'Ana Pérez' }));
  });
});

test('sin correo o sin nombre no se reconoce a nadie: se deja pasar', async () => {
  /* Hay eventos que no piden nombre o no piden correo. Sin uno de los dos no se
     puede distinguir a dos personas, y frenar un registro por sospecha es peor
     que dejar pasar un duplicado: el duplicado se borra, el registro que no
     ocurrió no se entera nadie hasta que esa persona no aparece en la lista. */
  for (const caso of [{ email: '', nombre: 'Ana' }, { email: 'a@b.co', nombre: '  ' }]) {
    const ya = await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', ...caso });
    assert.equal(ya, null);
  }
});

test('si la consulta falla, se deja pasar', async () => {
  /* Esto corre en mitad de un registro. Un fallo mirando no puede ser el motivo
     de que alguien no se pueda inscribir. */
  const ruta = require.resolve('../lib/supabase.js');
  const antes = require.cache[ruta];
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) };
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: { from: () => q } };
  try {
    assert.equal(await boletaQueYaTenia({ eventoId: 'e1', tipoId: 'tt1', email: 'a@b.co', nombre: 'Ana' }), null);
  } finally {
    if (antes) require.cache[ruta] = antes; else delete require.cache[ruta];
  }
});

test('la comprobación va antes de tocar la silla y de quemar la oferta', () => {
  /* El orden es la mitad del arreglo: reconocer a alguien no puede costarle su
     sitio en el plano ni su enlace de lista de espera. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes/eventos.publicos.js'), 'utf8').replace(/\r/g, '');
  const ruta = src.slice(src.indexOf("router.post('/slug/:slug/reservar'"));
  const iYa = ruta.indexOf('boletaQueYaTenia(');
  const iSilla = ruta.indexOf('sillaDeLaCompra.comprobarAntes');
  const iOferta = ruta.indexOf('consumirOferta(');
  assert.ok(iYa > 0, 'la ruta no comprueba si ya estaba registrado');
  assert.ok(iYa < iSilla, 'se retiene la silla antes de reconocer a la persona');
  assert.ok(iYa < iOferta, 'se quema la oferta de cupo antes de reconocer a la persona');
  /* Y sólo en las gratuitas: comprar dos entradas iguales para ir con alguien
     es normal y no se toca. */
  assert.match(ruta.slice(iYa - 200, iYa), /if \(esGratis\)/);
});
