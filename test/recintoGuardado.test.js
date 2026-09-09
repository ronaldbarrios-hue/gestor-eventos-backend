/* El recinto se dibuja una vez.
 *
 * Dibujar el Movistar Arena son horas, y hoy ese trabajo muere con el evento.
 * Esto es lo que lo convierte en una plantilla — y la prueba que más importa es
 * la de la LÍNEA: qué se copia del edificio y qué se queda en el concierto.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const r = require('../lib/recintosGuardados.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const espacio = (extra = {}) => ({
  id: 'e1', evento_id: 'ev1', parent_id: null,
  nombre: 'Tribuna 101', tipo: 'tribuna', modo: 'aforo',
  aforo_max: 200, capacidad: 1, geometria: { puntos: [[0, 0], [10, 0], [10, 10]] },
  atributos: {}, orden: 5, ...extra,
});

/* ── La línea: el edificio sí, el concierto no ────────────────────────── */

test('la plantilla NO se lleva nada de un concierto concreto', () => {
  /* Si se colara el precio, copiar un recinto traería los precios del show
     anterior y alguien los publicaría sin mirar. */
  const [fila] = r.aPlantilla([espacio({
    precio: 450000, vendidos: 12, ticket_type_id: 'tt1', evento_id: 'ev1', id: 'e1',
  })]);
  const plano = JSON.stringify(fila);
  for (const fuera of ['precio', '450000', 'vendidos', 'ticket_type_id', 'evento_id', 'ev1', '"e1"']) {
    assert.equal(plano.includes(fuera), false, `se coló «${fuera}»`);
  }
});

test('la plantilla sí se lleva la forma, el nombre y la capacidad', () => {
  const [fila] = r.aPlantilla([espacio({ modo: 'vendible', capacidad: 8, nombre: 'Palco 3' })]);
  assert.equal(fila.nombre, 'Palco 3');
  assert.equal(fila.capacidad, 8);
  assert.equal(fila.modo, 'vendible');
  assert.deepEqual(fila.geometria.puntos[0], [0, 0]);
});

test('las columnas copiadas son una lista escrita, no «todo menos esto»', () => {
  /* Con `delete`, una columna nueva en `espacios` se copiaría sin que nadie lo
     decidiera — y el día que esa columna sea `vendidos`, la plantilla mentiría. */
  const texto = leer('lib/recintosGuardados.js');
  assert.match(texto, /const DEL_EDIFICIO = \[/);
  assert.equal(/delete .*\.(precio|vendidos|evento_id)/.test(texto), false);
  for (const prohibida of ['precio', 'vendidos', 'ticket_type_id', 'evento_id', 'id']) {
    assert.equal(r.DEL_EDIFICIO.includes(prohibida), false, prohibida);
  }
});

/* ── El árbol ─────────────────────────────────────────────────────────── */

test('el árbol se guarda por posición, no por uuid', () => {
  /* Guardar los uuid obligaría a un diccionario al copiar, y un diccionario a
     medias deja bloques huérfanos: sillas que no cuelgan de ninguna tribuna y
     que por tanto no se pueden vender. */
  const plano = r.aPlantilla([
    espacio({ id: 'A', parent_id: null, nombre: 'Tribuna 101' }),
    espacio({ id: 'B', parent_id: 'A', nombre: 'Fila A1' }),
  ]);
  assert.equal(plano[0].padre, null);
  assert.equal(plano[1].padre, 0);
});

test('un padre que no está en la lista se trata como raíz, no como hueco', () => {
  const plano = r.aPlantilla([espacio({ id: 'B', parent_id: 'no-existe' })]);
  assert.equal(plano[0].padre, null);
});

test('los niveles salen en orden: primero los padres', () => {
  /* Se inserta en dos pasadas porque el `parent_id` del hijo es el id que la
     base acaba de dar al padre. */
  const niveles = r.porNiveles([
    { nombre: 'Fila A1', padre: 1 },
    { nombre: 'Tribuna 101', padre: null },
    { nombre: 'Silla 1', padre: 0 },
  ]);
  assert.equal(niveles.length, 3);
  assert.deepEqual(niveles[0].map(x => x.espacio.nombre), ['Tribuna 101']);
  assert.deepEqual(niveles[1].map(x => x.espacio.nombre), ['Fila A1']);
  assert.deepEqual(niveles[2].map(x => x.espacio.nombre), ['Silla 1']);
});

test('un ciclo en el plano no cuelga el servidor', () => {
  /* Un plano manipulado a mano puede traer A hijo de B y B hijo de A. Un bloque
     suelto se ve y se arregla; un servidor colgado, no. */
  const niveles = r.porNiveles([{ nombre: 'A', padre: 1 }, { nombre: 'B', padre: 0 }]);
  assert.ok(niveles.length >= 1);
  assert.equal(niveles.flat().length, 2);
});

test('cada espacio aparece una sola vez al repartir por niveles', () => {
  const plano = [
    { nombre: 'z', padre: null }, { nombre: 'a', padre: 0 },
    { nombre: 'b', padre: 0 }, { nombre: 'c', padre: 1 },
  ];
  const todos = r.porNiveles(plano).flat().map(x => x.espacio.nombre).sort();
  assert.deepEqual(todos, ['a', 'b', 'c', 'z']);
});

/* ── Lo que no se guarda ──────────────────────────────────────────────── */

test('un plano vacío no se guarda: no hay nada que reutilizar', () => {
  assert.match(r.validarPlano([]), /dibuja el recinto/);
  assert.match(r.validarPlano(null), /lista de espacios/);
});

test('un espacio sin nombre no pasa: en la copia sería un bloque anónimo', () => {
  assert.match(r.validarPlano([{ nombre: '  ' }]), /sin nombre/);
});

test('un padre fuera de rango se rechaza AL GUARDAR, no al copiar', () => {
  /* Descubrir que la plantilla estaba rota mientras alguien monta un concierto
     con ella es tarde. */
  assert.match(r.validarPlano([{ nombre: 'A', padre: 7 }]), /cuelga de un espacio/);
  assert.equal(r.validarPlano([{ nombre: 'A', padre: null }]), null);
});

test('hay tope: una plantilla no es un volcado de la base', () => {
  const enorme = Array.from({ length: 5001 }, () => ({ nombre: 'x', padre: null }));
  assert.match(r.validarPlano(enorme), /máximo/);
});

/* ── La lista ─────────────────────────────────────────────────────────── */

test('el resumen no arrastra el plano entero', () => {
  /* Veinte recintos de dos mil espacios son megas por una pantalla que sólo
     necesita nombres. */
  const s = r.resumen({ id: 'r1', nombre: 'Movistar Arena', plano: [{ capacidad: 8 }, { capacidad: 4 }] });
  assert.equal(s.espacios, 2);
  assert.equal(s.capacidad, 12);
  assert.equal(JSON.stringify(s).includes('capacidad":8'), false);
});

test('el aforo legal y la capacidad dibujada son dos números distintos', () => {
  /* Un arena de 14.000 monta 6.000 para un acústico. Enseñar sólo uno hace
     creer que el otro no existe. */
  const s = r.resumen({ id: 'r1', nombre: 'X', aforo_legal: 14000, plano: [{ capacidad: 6000 }] });
  assert.equal(s.aforo_legal, 14000);
  assert.equal(s.capacidad, 6000);
});

/* ── Las rutas ────────────────────────────────────────────────────────── */

const RUTA = leer('routes/recintos.js');

test('el recinto se comprueba contra la base, no contra quien llama', () => {
  /* `owner_id` en el cuerpo sería una invitación. */
  assert.match(RUTA, /data\.owner_id !== userId/);
  assert.equal(/req\.body[^\n]*owner_id/.test(RUTA), false);
});

test('montar un recinto sobre un evento con plano se niega', () => {
  const trozo = RUTA.slice(RUTA.indexOf("router.post('/eventos/:eventoId/espacios/desde-recinto'"));
  assert.match(trozo, /count: 'exact'/);
  assert.match(trozo, /409/);
});

test('el permiso es el MISMO que el del plano de venta', () => {
  /* Un permiso de más aquí dejaría entrar por esta puerta a quien no puede
     entrar por la otra. */
  const de = (f) => leer(f).match(/const PERMS = (\[[^\]]*\])/)[1];
  assert.equal(de('routes/recintos.js'), de('routes/espacios.js'));
});

test('el plano que se guarda sale del EVENTO, no del cuerpo de la petición', () => {
  /* Así se guarda lo que de verdad hay dibujado y no lo que diga el navegador. */
  const trozo = RUTA.slice(RUTA.indexOf("router.post('/recintos'"), RUTA.indexOf("router.delete('/recintos/:id'"));
  assert.match(trozo, /from\('espacios'\)/);
  assert.equal(/plano:\s*req\.body/.test(trozo), false);
});

/* ── La migración ─────────────────────────────────────────────────────── */

const SQL = leer('db/migrations/0120_el_recinto_se_guarda_una_vez.sql');

test('la tabla lleva RLS y política de dueño', () => {
  /* El plano de un edificio con sus palcos y accesos es trabajo, y de paso
     información de un cliente. */
  assert.match(SQL, /enable row level security/);
  assert.match(SQL, /auth\.uid\(\) = owner_id/);
});

test('dos recintos con el mismo nombre no caben en una cuenta', () => {
  assert.match(SQL, /recintos_nombre_unico/);
  assert.match(SQL, /lower\(nombre\)/);
});

test('borrar la cuenta se lleva sus recintos, y no al revés', () => {
  assert.match(SQL, /references auth\.users\(id\) on delete cascade/);
});
