/* Vender un sitio concreto: la silla C-14, la mesa 3, el palco norte.
 *
 * ── Lo que se protege ────────────────────────────────────────────────────
 *
 * La doble venta. Es el peor fallo posible en boletería porque se descubre en
 * la puerta, con las dos personas delante y el mismo asiento — y para entonces
 * ya no hay arreglo técnico, hay una discusión.
 *
 * Por eso la mitad de estas pruebas no miran comportamiento sino ESTRUCTURA: que
 * la garantía siga siendo un índice único en la base y no una comprobación en
 * el servidor. Un `select` y luego un `insert` dejan una ventana entre los dos
 * por la que cabe otra persona, y esa ventana no se ve leyendo el código.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MODOS, MINUTOS_RETENCION, MAX_POR_LOTE,
  validarEspacio, filaEspacio, generarUnidades, nombreDeFila,
  armarArbol, unidadesVendibles, mapaPublico, resumenPorPadre,
  sesionValida, traducirError,
} = require('../lib/espacios.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

const SQL = leer('db/migrations/0117_la_silla_que_se_compra.sql');
const PUB = leer('routes/eventos.publicos.js');
const PANEL = leer('routes/espacios.js');
const SILLA = leer('lib/sillaDeLaCompra.js');

/* Los TRES caminos por los que se emite una boleta. Ninguno pasa por los
   otros, y ésa es la trampa: la primera versión de esto sólo cubría el
   primero — o sea que un concierto, que es de pago, habría emitido la boleta y
   dejado la silla retenida hasta caducar. */
const CAMINOS = [
  ['routes/eventos.publicos.js', PUB],
  ['routes/pagos.js', leer('routes/pagos.js')],
  ['routes/wompi.js', leer('routes/wompi.js')],
];

/* ── 1 · La garantía ─────────────────────────────────────────────────── */

test('la doble venta la impide la BASE, no el servidor', () => {
  /* Un índice único parcial rechaza la segunda reserva DURANTE la escritura. Un
     `if (estaLibre)` en el servidor comprueba y luego escribe, y entre las dos
     cosas cabe otra petición. La diferencia no se ve leyendo el código: se ve
     el día que dos personas compran a la vez. */
  assert.match(SQL, /create unique index if not exists espacio_reservas_una_viva/);
  assert.match(SQL, /on public\.espacio_reservas \(espacio_id\)/);
  assert.match(SQL, /where estado in \('retenido', 'vendido'\)/);
});

test('el estado NO vive en la silla', () => {
  /* La tentación es `espacios.estado = 'vendida'`. Un campo se lee y luego se
     escribe. Si alguna vez aparece, vuelve el fallo. */
  const bloque = SQL.slice(SQL.indexOf('create table if not exists public.espacios'),
                           SQL.indexOf('create index if not exists espacios_evento_idx'));
  assert.doesNotMatch(bloque, /\bestado\b/, 'el estado volvió a la tabla de espacios');
});

test('retener es una función de Postgres, no dos consultas seguidas', () => {
  /* `supabase-js` habla por PostgREST y no puede abrir una transacción de
     varias sentencias. Retener son dos pasos que van juntos: liberar lo
     caducado de esa silla e insertar lo nuevo. Separados desde el servidor,
     entre el uno y el dos cabe otra persona. */
  assert.match(SQL, /create or replace function public\.retener_espacio/);
  assert.match(SQL, /update public\.espacio_reservas[\s\S]{0,200}expira_at < now\(\)/);
  assert.match(SQL, /when unique_violation then/);
  assert.match(SQL, /raise exception 'ESPACIO_OCUPADO'/);

  /* Y el servidor la llama, no la reimplementa. */
  assert.match(sinComentarios(PUB), /supabase\.rpc\('retener_espacio'/);
  assert.doesNotMatch(sinComentarios(PUB), /from\('espacio_reservas'\)[\s\S]{0,120}\.insert\(/);
});

test('liberar lo caducado no depende sólo de un cron', () => {
  /* Va dentro de `retener_espacio`: si el trabajo periódico falla o se retrasa,
     las sillas se siguen liberando cuando alguien intenta tomarlas. Un evento
     no puede depender de que un cron esté vivo. */
  const fn = SQL.slice(SQL.indexOf('function public.retener_espacio'),
                       SQL.indexOf('function public.liberar_espacio'));
  assert.match(fn, /estado = 'liberado'/);
  /* Y además existe el barrido, para que el mapa se vea al día. */
  assert.match(SQL, /function public\.liberar_espacios_caducados/);
});

test('confirmar la venta sólo lo hace el servidor', () => {
  /* `anon` puede retener y soltar —quien compra no tiene cuenta— pero si
     pudiera confirmar, cualquiera se queda una silla sin pagar. */
  assert.match(SQL, /grant execute on function public\.retener_espacio[^;]*to anon/);
  assert.match(SQL, /grant execute on function public\.confirmar_espacio\(uuid, text, uuid\)\s*to service_role;/);
  const linea = SQL.split('\n').find(l => l.includes('confirmar_espacio(uuid, text, uuid)') && l.includes('grant'));
  assert.ok(linea && !linea.includes('anon'), 'anon puede confirmar una venta sin pagar');
});

test('soltar una silla exige ser quien la tiene', () => {
  /* Sin comprobar la sesión, cualquiera con el id de un espacio libera la silla
     que otro está pagando. */
  const fn = SQL.slice(SQL.indexOf('function public.liberar_espacio'),
                       SQL.indexOf('function public.confirmar_espacio'));
  assert.match(fn, /sesion_compra = p_sesion/);
});

/* ── 2 · El ciclo de compra ──────────────────────────────────────────── */

test('los TRES caminos de compra atan la silla', () => {
  /* Gratis, Mercado Pago y Wompi. Si uno se queda fuera, por ahí entra la
     doble venta que todo el módulo existe para impedir. */
  for (const [nombre, src] of CAMINOS) {
    const r = sinComentarios(src);
    assert.match(r, /sillaDeLaCompra\.comprobarAntes\(/, `${nombre} no comprueba la silla`);
    assert.match(r, /sillaDeLaCompra\.confirmarDespues\(/, `${nombre} no la ata a la boleta`);
  }
});

test('y la comprueban ANTES de emitir', () => {
  /* Para que quien se quedó sin ella se entere cuando todavía puede elegir
     otra, y no después de pagar. */
  for (const [nombre, src] of CAMINOS) {
    const r = sinComentarios(src);
    assert.ok(r.indexOf('comprobarAntes') < r.indexOf('confirmarDespues'),
      `${nombre}: se ata la silla antes de comprobarla`);
  }
});

test('la comprobación vive en UN sitio', () => {
  /* Copiada en los tres, se separan: uno acabaría comprobando la localidad y
     los otros no. */
  assert.match(SILLA, /function comprobarAntes/);
  for (const [nombre, src] of CAMINOS) {
    assert.doesNotMatch(sinComentarios(src), /from\('espacio_reservas'\)[\s\S]{0,200}sesion_compra/,
      `${nombre} tiene su propia copia de la comprobación`);
  }
});

test('y si caduca entre la comprobación y el cobro, la boleta se deshace', () => {
  /* Pasan milisegundos, pero la retención puede caducar justo ahí. Una venta
     sin sitio se descubre en la puerta, con la persona delante. En los tres
     caminos, y devolviendo la oferta de cupo si venía con una. */
  for (const [nombre, src] of CAMINOS) {
    const r = sinComentarios(src);
    assert.match(r, /from\('tickets'\)\.delete\(\)\.eq\('id', ticket\.id\)/, `${nombre} no deshace la boleta`);
    assert.match(r, /devolverOferta/, `${nombre} no devuelve la oferta de cupo`);
    assert.match(r, /sillaDeLaCompra\.SE_PERDIO/, `${nombre} no dice qué pasó`);
  }
  assert.match(SILLA, /confirmar_espacio/);
});

test('anular una boleta devuelve su silla', () => {
  /* La silla pasa a vendida AL CREAR la boleta —así cuenta el aforo, y el
     viaje a la pasarela dura más que la retención—. La contrapartida es que
     una compra abandonada la deja ocupada hasta que alguien anule. */
  assert.match(SILLA, /function liberarPorTicket/);
  assert.match(SILLA, /\.eq\('ticket_id', ticketId\)\.eq\('estado', 'vendido'\)/);
});

test('anular o reembolsar desde el panel la devuelve, con la MISMA regla que el aforo', () => {
  /* Si un día cambia qué estados ocupan, la silla y el cupo tienen que cambiar
     juntos o uno de los dos deja de cuadrar. Por eso va dentro del mismo
     `delta < 0` y no con una condición propia. */
  const c = leer('routes/clientes.js');
  assert.match(c, /if \(delta < 0\) \{[\s\S]{0,500}sillaDeLaCompra\.liberarPorTicket\(ticketId\)/);
  /* Y el reembolso por la pasarela, que es otro camino. */
  assert.equal((c.match(/liberarPorTicket/g) || []).length, 2);
});

test('liberar la silla no puede tumbar una anulación', () => {
  /* Si esto falla, la anulación de la boleta ya ocurrió. Hacerla fracasar por
     la silla es cambiar un problema pequeño por uno grande. */
  const fn = SILLA.slice(SILLA.indexOf('async function liberarPorTicket'));
  assert.match(fn, /console\.error/);
  assert.doesNotMatch(fn, /throw/);
});

test('la silla tiene que ser de la localidad que se compra', () => {
  /* Sin esto se paga una entrada de gradería y se guarda una silla de platea, y
     no falla nada: son dos tablas que nadie cruza. */
  assert.match(sinComentarios(SILLA), /ticket_type_espacios[\s\S]{0,300}loc\.ticket_type_id !== tipoId/);
});

test('el mapa público no dice de quién es cada silla', () => {
  /* `sesion_compra` identifica un carrito y `ticket_id` lleva a una persona. Un
     mapa que dijera «vendida a X» sería una lista de asistentes servida sin
     autenticación. */
  const ruta = PUB.slice(PUB.indexOf("router.get('/slug/:slug/mapa'"),
                         PUB.indexOf("router.post('/slug/:slug/retener'"));
  assert.doesNotMatch(ruta, /sesion_compra/);
  assert.doesNotMatch(ruta, /ticket_id/);
  assert.match(ruta, /espacio_id, estado, expira_at/);
});

test('un evento sin plano no se rompe: contesta que no hay', () => {
  /* La inmensa mayoría de los eventos se venden por aforo. Un 404 aquí haría
     que el formulario de siempre dejara de cargar. */
  assert.match(PUB, /hay_plano: false/);
});

/* ── 3 · La lógica pura ──────────────────────────────────────────────── */

test('una retención dura lo que dura un pago con tarjeta', () => {
  /* Tres minutos generan lo peor de todo: alguien que pagó y ya no tiene su
     silla. Treinta dejan el mapa en rojo sin una sola venta. */
  assert.ok(MINUTOS_RETENCION >= 8 && MINUTOS_RETENCION <= 15,
    `${MINUTOS_RETENCION} minutos: o no da tiempo a pagar, o bloquea el mapa`);
});

test('un aforo en algo vendible se rechaza', () => {
  /* Lo vendible se cuenta por unidades. Guardar un aforo ahí es un número que
     nadie mira y que alguien leerá creyendo que hace algo. */
  assert.ok(validarEspacio({ nombre: 'Platea', modo: 'vendible', aforo_max: 300 }));
  assert.equal(validarEspacio({ nombre: 'Platea', modo: 'vendible' }), null);
  assert.equal(validarEspacio({ nombre: 'Gradería', modo: 'aforo', aforo_max: 300 }), null);
});

test('cambiar de modo limpia lo que ya no significa nada', () => {
  /* Si no, un espacio que fue aforo y pasa a vendible se queda con el aforo
     viejo colgando, y el primero que lo lea sacará una cuenta equivocada. */
  const f = filaEspacio({ nombre: 'X', modo: 'vendible', aforo_max: 300, capacidad: 4 }, 'evt');
  assert.equal(f.aforo_max, null);
  assert.equal(f.capacidad, 4);
  const g = filaEspacio({ nombre: 'Y', modo: 'aforo', aforo_max: 300, capacidad: 4 }, 'evt');
  assert.equal(g.aforo_max, 300);
  assert.equal(g.capacidad, 1);
});

test('los modos son tres y no más', () => {
  assert.deepEqual(MODOS, ['aforo', 'asignable', 'vendible']);
  assert.ok(validarEspacio({ nombre: 'X', modo: 'inventado' }));
});

test('generar una sección nombra las sillas como están en el suelo', () => {
  const { unidades } = generarUnidades({ filas: 2, porFila: 3, prefijoFila: 'Fila' });
  assert.equal(unidades.length, 6);
  assert.deepEqual(unidades.map(u => u.nombre),
    ['Fila A1', 'Fila A2', 'Fila A3', 'Fila B1', 'Fila B2', 'Fila B3']);
  assert.ok(unidades.every(u => u.modo === 'vendible'));
});

test('una sola fila no lleva letra', () => {
  /* Es el caso de los palcos y las mesas de ringside, que es por donde se
     empieza: «Mesa 3», no «Mesa A3». */
  const { unidades } = generarUnidades({ filas: 1, porFila: 3, tipo: 'mesa', capacidad: 4 });
  assert.deepEqual(unidades.map(u => u.nombre), ['Mesa 1', 'Mesa 2', 'Mesa 3']);
  assert.ok(unidades.every(u => u.capacidad === 4));
});

test('más de 26 filas no se queda sin letras', () => {
  assert.equal(nombreDeFila(0), 'A');
  assert.equal(nombreDeFila(25), 'Z');
  assert.equal(nombreDeFila(26), 'AA');
  assert.equal(nombreDeFila(27), 'AB');
});

test('se puede numerar desde la derecha', () => {
  /* Hay recintos que numeran al revés. La alternativa es que alguien renombre
     240 sillas a mano. */
  const { unidades } = generarUnidades({ filas: 1, porFila: 3, desdeLaDerecha: true });
  assert.deepEqual(unidades.map(u => u.nombre), ['Silla 3', 'Silla 2', 'Silla 1']);
});

test('un patrón absurdo no llena la tabla', () => {
  /* «200 filas de 300» son sesenta mil filas de un clic. No es una opinión
     sobre cuántas sillas cabe un recinto: es un cortafuegos. */
  const { error } = generarUnidades({ filas: 200, porFila: 300 });
  assert.match(error, new RegExp(String(MAX_POR_LOTE)));
  assert.ok(generarUnidades({ filas: 0, porFila: 5 }).error);
  assert.ok(generarUnidades({ filas: 5, porFila: -1 }).error);
});

test('el árbol se arma de una lectura y ordenado', () => {
  const arbol = armarArbol([
    { id: 'b', parent_id: 'a', nombre: 'Fila B', orden: 2 },
    { id: 'a', parent_id: null, nombre: 'Platea', orden: 1 },
    { id: 'c', parent_id: 'a', nombre: 'Fila A', orden: 1 },
  ]);
  assert.equal(arbol.length, 1);
  assert.deepEqual(arbol[0].hijos.map(h => h.nombre), ['Fila A', 'Fila B']);
});

test('un huérfano no desaparece del plano', () => {
  /* Un padre que no está en la lista —borrado a medias, o filtrado— no puede
     hacer invisibles a sus hijos: se suben a la raíz. Si desaparecieran, el
     organizador vería un plano incompleto sin ningún aviso. */
  const arbol = armarArbol([{ id: 'x', parent_id: 'no-existe', nombre: 'Silla 1', orden: 1 }]);
  assert.equal(arbol.length, 1);
  assert.equal(arbol[0].nombre, 'Silla 1');
});

test('una retención caducada no ocupa en el mapa', () => {
  /* Aunque el barrido no haya pasado. Si no, el mapa enseña en rojo sillas que
     sí se pueden comprar, y quien mira concluye que está agotado. */
  const espacios = [
    { id: 's1', modo: 'vendible', nombre: 'Silla 1', capacidad: 1 },
    { id: 's2', modo: 'vendible', nombre: 'Silla 2', capacidad: 1 },
    { id: 's3', modo: 'vendible', nombre: 'Silla 3', capacidad: 1 },
    { id: 'z',  modo: 'aforo',    nombre: 'Gradería' },
  ];
  const ahora = new Date('2026-09-08T12:00:00Z');
  const mapa = mapaPublico({
    espacios,
    reservas: [
      { espacio_id: 's1', estado: 'vendido' },
      { espacio_id: 's2', estado: 'retenido', expira_at: '2026-09-08T11:50:00Z' }, // caducada
      { espacio_id: 's3', estado: 'retenido', expira_at: '2026-09-08T12:05:00Z' }, // viva
    ],
    ahora,
  });
  const por = Object.fromEntries(mapa.map(u => [u.id, u.libre]));
  assert.equal(por.s1, false);
  assert.equal(por.s2, true, 'una retención caducada seguía ocupando');
  assert.equal(por.s3, false);
  /* Y lo que no se vende no sale en el mapa de unidades. */
  assert.equal(mapa.length, 3);
  assert.equal(unidadesVendibles(espacios).length, 3);
});

test('el resumen dice cuántas quedan por sección', () => {
  /* Es el número que se mira antes de abrir el plano, y el que decide si merece
     la pena abrirlo. */
  const r = resumenPorPadre([
    { id: 'a', parent_id: 'p', libre: true },
    { id: 'b', parent_id: 'p', libre: false },
    { id: 'c', parent_id: 'p', libre: true },
  ]);
  assert.deepEqual(r.get('p'), { total: 3, libres: 2 });
});

test('la sesión del carrito no identifica a nadie, pero tiene que ser algo', () => {
  assert.equal(sesionValida('  '), null);
  assert.equal(sesionValida('corta'), null);
  assert.equal(sesionValida('x'.repeat(200)), null);
  assert.equal(sesionValida(' abc12345 '), 'abc12345');
});

test('«se acaba de tomar» se dice igual en todas partes', () => {
  /* El mensaje ES la funcionalidad: quien lo lee tiene que entender que puede
     elegir otra silla, no que la plataforma falló. */
  const t = traducirError(new Error('ESPACIO_OCUPADO'));
  assert.equal(t.estado, 409);
  assert.match(t.mensaje, /Elige otra/);
  assert.equal(traducirError(new Error('cualquier otra cosa')), null);
});

/* ── 4 · El panel ────────────────────────────────────────────────────── */

test('borrar una sección cuenta lo vendido de TODO el subárbol', () => {
  /* `on delete cascade` se lleva a los hijos. Mirar sólo este nodo permitiría
     borrar una sección con 240 sillas vendidas, y eso no se deshace. */
  const r = sinComentarios(PANEL);
  assert.match(r, /descendientes\(todos, id\)/);
  assert.match(r, /\.in\('espacio_id', bajo\)\.eq\('estado', 'vendido'\)/);
});

test('el precio va en la localidad, no en la silla', () => {
  /* Un precio por silla obliga a tocar 2.000 filas para subir un 10 %. */
  /* Sin comentarios: el de arriba explica por qué el precio NO va aquí, y
     nombrarlo hacía fallar la prueba que lo comprueba. */
  const limpio = sinComentarios(SQL);
  const bloque = limpio.slice(limpio.indexOf('create table if not exists public.espacios'),
                              limpio.indexOf('create table if not exists public.ticket_type_espacios'));
  assert.doesNotMatch(bloque, /precio/);
  assert.match(SQL, /create table if not exists public\.ticket_type_espacios/);
  /* Y se puede aplicar a una sección entera de una vez: 240 peticiones para
     poner precio a una sección no es una interfaz, es un castigo. */
  assert.match(PANEL, /localidad-en-cascada/);
});

test('una silla no puede tener dos precios', () => {
  const r = sinComentarios(PANEL);
  assert.match(r, /delete\(\)\.eq\('espacio_id', id\)[\s\S]{0,200}insert\(\{ ticket_type_id, espacio_id: id \}\)/);
});

test('el organizador puede soltar una silla vendida, y queda anotado', () => {
  /* Las retenciones caducan solas; una VENTA no. Una anulación o una prueba del
     día anterior dejarían la silla ocupada para siempre sin esta salida. */
  const r = sinComentarios(PANEL);
  assert.match(r, /espacio\.liberar-a-mano/);
  assert.match(r, /tickets: \(data \|\| \[\]\)\.map/);
});

test('el plano usa el permiso que ya existe', () => {
  /* Un permiso nuevo obligaría a repartirlo otra vez en todos los roles, y a
     que alguien se enterara — y hasta entonces nadie podría montar un plano. */
  assert.match(PANEL, /const PERMS = \['gestionar_tickets'\]/);
});

/* ── 5 · La migración ────────────────────────────────────────────────── */

test('la migración es reversible y no toca nada de lo que ya había', () => {
  assert.match(SQL, /-- ── Vuelta atrás/);
  const soloSql = sinComentarios(SQL);
  assert.doesNotMatch(soloSql, /alter table public\.(tickets|eventos|ticket_types)[^;]*drop/i);
  /* Tablas nuevas: crear no puede romper lo que ya funciona. */
  assert.match(SQL, /create table if not exists public\.espacios/);
});

test('las reservas no se leen desde el navegador', () => {
  /* El estado del mapa lo sirve el backend ya agregado. Una política de lectura
     sobre `espacio_reservas` dejaría ver `ticket_id` a cualquiera. */
  const soloSql = sinComentarios(SQL);
  assert.match(soloSql, /alter table public\.espacio_reservas\s+enable row level security/);
  assert.doesNotMatch(soloSql, /create policy[\s\S]{0,120}on public\.espacio_reservas/);
});
