/* «¿Esta persona ya tiene esta boleta?» se contesta en un solo sitio.
 *
 * Había TRES caminos que emiten una boleta gratuita y tres reglas distintas
 * para la misma pregunta:
 *
 *   registro público      mismo correo + mismo nombre + mismo tipo → ya la
 *                         tiene (la regla buena, medida sobre datos reales)
 *   importar Excel        cualquier correo con una boleta en el evento →
 *                         rechazado. Sin mirar el tipo: importar a alguien del
 *                         registro general para el DemoDay fallaba con «Ya
 *                         existe una boleta con ese correo»
 *   emitir cortesía       igual, y además sin mirar el estado: a quien se le
 *                         invalidó la boleta no se le podía emitir otra — que
 *                         es justo cuando se pide una cortesía
 *
 * Tres reglas para la misma pregunta es cómo se acaba explicando a quien
 * organiza que «depende de por dónde lo metas».
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

/* Sin comentarios, porque las tres redacciones viejas siguen citadas EN los
   comentarios que explican por que se fueron — y una prueba que mide sus
   propios comentarios se pone verde el dia que el codigo empeora. Ya paso en
   este repo mas de una vez. */
const sinComentarios = (f) => leer(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const { esLaMisma, clavePersona, yaRegistrados, normal } = require('../lib/yaEstabaRegistrado.js');

const ANA = { guest_email: 'ana@x.co', guest_nombre: 'Ana Pérez', estado: 'pagado' };

test('la misma persona es la misma escrita de cualquier manera', () => {
  assert.ok(esLaMisma({ email: '  ANA@x.co ', nombre: 'ana  pérez' }, ANA));
});

test('otro nombre con el mismo correo NO es la misma persona', () => {
  /* Un correo no es una persona: 12 de 45 repeticiones del evento medido
     traían otro nombre —alguien inscribiendo a su equipo o a su familia con su
     propio correo—. La importación cortaba por correo a secas y dejaba fuera
     exactamente esas filas. */
  assert.ok(!esLaMisma({ email: 'ana@x.co', nombre: 'Luis Pérez' }, ANA));
});

test('una boleta anulada no bloquea, y una usada sí', () => {
  for (const estado of ['invalido', 'reembolsado', 'cancelado']) {
    assert.ok(!esLaMisma({ email: 'ana@x.co', nombre: 'Ana Pérez' }, { ...ANA, estado }),
      `un ticket ${estado} no debería bloquear`);
  }
  /* `usado` sí: esa persona ya entró. */
  assert.ok(esLaMisma({ email: 'ana@x.co', nombre: 'Ana Pérez' }, { ...ANA, estado: 'usado' }));
});

test('la clave separa correo de nombre sin poder confundirse', () => {
  /* Con un guion, «ana@x.co» + «luis» y «ana@x.co-luis» + «» darían la misma
     clave. Es rebuscado y es gratis evitarlo. */
  assert.notEqual(clavePersona('ana@x.co', 'luis'), clavePersona('ana@x.co-luis', ''));
  /* Y normaliza igual que la comparación de una sola: si no, la importación
     dejaría pasar «  Ana  Pérez» frente a «Ana Pérez». */
  assert.equal(clavePersona(' ANA@X.co ', 'ana  pérez'), clavePersona('ana@x.co', 'Ana Pérez'));
});

test('la consulta en bloque filtra por tipo, no por evento', () => {
  /* Es el corazón del arreglo: la importación miraba el evento entero. */
  const src = leer('lib/yaEstabaRegistrado.js');
  const f = src.slice(src.indexOf('async function yaRegistrados'), src.indexOf('/* Devuelve la boleta que ya tenía'));
  assert.match(f, /\.eq\('ticket_type_id', tipoId\)/, 'vuelve a mirar el evento entero');
  assert.match(f, /\.eq\('evento_id', eventoId\)/);
  /* Por trozos: un `in` con miles de correos no cabe en la URL de PostgREST, y
     la importación de un evento grande trae justo eso. */
  assert.match(f, /TROZO = 300/);
});

test('sin correos no consulta nada', async () => {
  /* Sin correo no hay a quién reconocer, y una consulta con `in` vacío es un
     viaje para nada. */
  assert.equal((await yaRegistrados({ eventoId: 'e1', tipoId: 't1', correos: [] })).size, 0);
  assert.equal((await yaRegistrados({ eventoId: 'e1', tipoId: 't1', correos: ['', null, '  '] })).size, 0);
  assert.equal((await yaRegistrados({ tipoId: 't1', correos: ['a@b.co'] })).size, 0);
});

/* ── Y los tres caminos la usan ──────────────────────────────────────── */

test('los tres caminos preguntan por la librería, y ninguno por su cuenta', () => {
  const caminos = [
    { archivo: 'routes/eventos.publicos.js', usa: 'boletaQueYaTenia(', que: 'el registro público' },
    { archivo: 'routes/clientes.js', usa: 'yaRegistrados(', que: 'la importación de Excel' },
    { archivo: 'lib/agente.js', usa: 'boletaQueYaTenia(', que: 'emitir cortesía' },
  ];
  for (const c of caminos) {
    const src = leer(c.archivo);
    assert.ok(src.includes(c.usa), `${c.que} no usa la regla compartida`);
  }

  /* Y las tres redacciones de la regla vieja tienen que haber desaparecido.
     Si vuelve una, vuelve la contradicción — y no da error: sólo un «ya existe
     una boleta con ese correo» a quien iba por su segunda actividad. */
  assert.doesNotMatch(sinComentarios('routes/clientes.js'), /Ya existe una boleta con ese correo/,
    'la importación vuelve a rechazar por correo a secas');
  assert.doesNotMatch(sinComentarios('lib/agente.js'), /Ya hay una boleta con ese email en el evento/,
    'la cortesía vuelve a rechazar por correo a secas');
});

test('la importación también mira las filas anteriores del mismo archivo', () => {
  /* Una lista con la misma persona dos veces creaba dos boletas: la
     comprobación sólo miraba la base, no el archivo que se estaba leyendo. */
  const src = leer('routes/clientes.js');
  const bucle = src.slice(src.indexOf('const yaEstaban = await yaRegistrados'), src.indexOf('/* Insercion por lotes'));
  assert.match(bucle, /yaEstaban\.has\(suClave\)/);
  assert.match(bucle, /yaEstaban\.add\(suClave\)/,
    'no se apunta la fila leída: la misma persona dos veces en el archivo entra dos veces');
});

test('los caminos de PAGO se quedan fuera, a propósito', () => {
  /* Comprar dos entradas iguales para ir con alguien es normal. La regla es
     sólo para lo gratuito, donde una segunda boleta idéntica no significa nada
     salvo que algo salió mal. */
  assert.match(leer('lib/yaEstabaRegistrado.js'), /Sólo gratis/);
  const pub = leer('routes/eventos.publicos.js');
  const i = pub.indexOf('boletaQueYaTenia(');
  assert.match(pub.slice(i - 400, i), /if \(esGratis\)/);
  /* Wompi y Mercado Pago emiten por su cuenta y no preguntan: es correcto. */
  assert.ok(!leer('routes/wompi.js').includes('boletaQueYaTenia'));
});

test('normalizar es una sola función', () => {
  /* Si cada camino normalizara a su manera, «Ana Pérez» y «ana  pérez» serían
     la misma persona en uno y dos en otro. */
  assert.equal(normal('  Ana   PÉREZ '), 'ana pérez');
  assert.equal(normal(null), '');
});
