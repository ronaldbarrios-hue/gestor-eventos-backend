/* Las citas de la rueda de negocios.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Las notas de una rueda son de lo más sensible que guarda la plataforma: con
 * quién hablaste y qué te pareció. Y la parrilla la maneja el equipo, que
 * puede mover a alguien de casilla.
 *
 * Tres cosas que no se pueden aflojar, y una que se aprendió con las zonas.
 *
 * Correr: npm test */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8');
const LIMPIO = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('nadie escribe notas en la cita de otro', () => {
  /* Sin el filtro por `user_id`, cualquiera con boleta del evento escribiría
     en la cita ajena cambiando el id de la URL. */
  const i = LIMPIO.indexOf("'/:eventoId/networking/citas/:citaId/notas'");
  assert.ok(i > 0, 'no existe la ruta de notas');
  /* Hasta el final de la ruta y no 1200 caracteres: desde que la misma ruta
     cierra la reunión —resultado y expectativa— el handler creció, y una
     ventana fija haría que esta prueba dejara de mirar el filtro sin dejar de
     pasar. Ese es el fallo que la prueba existe para impedir. */
  const bloque = LIMPIO.slice(i, LIMPIO.indexOf('\nrouter.', i + 10));
  assert.match(bloque, /\.eq\('user_id', req\.user\.id\)/,
    'la ruta de notas no filtra por la persona: se puede escribir en la cita de otro');
});

test('la parrilla del equipo no reparte las notas enteras', () => {
  /* El equipo necesita saber si una reunión dejó algo escrito; no leerlo. */
  const i = LIMPIO.indexOf("router.get('/:eventoId/networking/citas'");
  assert.ok(i > 0, 'no existe la parrilla');
  const bloque = LIMPIO.slice(i, LIMPIO.indexOf('router.patch', i));
  assert.match(bloque, /notas\.slice\(0, \d+\)/,
    'la parrilla manda las notas completas: son apuntes personales, no material de trabajo');
  assert.match(bloque, /tiene_notas/, 'no se dice si hay notas sin mandarlas');
});

test('mover una cita comprueba que el horario es de ESTE evento', () => {
  /* Sin comprobarlo, un id de otro evento saca la cita de su rueda y deja de
     aparecer en las dos. */
  const i = LIMPIO.indexOf("router.patch('/:eventoId/networking/citas/:citaId'");
  const bloque = LIMPIO.slice(i, i + 2500);
  assert.match(bloque, /expositor\?\.evento_id !== eventoId/,
    'se puede mover una cita a un horario de otro evento');
});

test('una casilla ocupada da 409, no un 500', () => {
  /* Arrastrar a alguien encima de otro es un caso NORMAL al reorganizar. Un
     500 se lee como que la aplicación se rompió, y quien está reorganizando la
     parrilla el día del evento deja de tocarla. */
  const i = LIMPIO.indexOf("router.patch('/:eventoId/networking/citas/:citaId'");
  const bloque = LIMPIO.slice(i, i + 3200);
  assert.match(bloque, /error\.code === '23505'[\s\S]{0,120}status\(409\)/,
    'chocar dos citas en la misma casilla devuelve 500');
});

test('el modo lo decide el evento, no quien reserva', () => {
  const i = LIMPIO.indexOf('reservar');
  const bloque = LIMPIO.slice(i, i + 2500);
  assert.match(bloque, /networking_modo/, 'reservar no mira el modo del evento');
  assert.match(bloque, /'solicitada' : 'confirmada'/,
    'el modo solicitud no deja la cita pendiente');
  assert.ok(!/req\.body[^\n]*estado/.test(bloque),
    'el estado inicial viene del cuerpo de la petición: entonces lo decide quien reserva');
});

test('«mis citas» enseña también las que están pedidas', () => {
  /* Antes filtraba por `confirmada`: en modo solicitud, la persona pedía la
     cita y la pantalla se quedaba igual que antes de pedirla. */
  const i = LIMPIO.indexOf("'/:eventoId/networking/mis-citas'");
  const bloque = LIMPIO.slice(i, i + 1400);
  assert.ok(!/\.eq\('estado', 'confirmada'\)/.test(bloque),
    'mis-citas vuelve a enseñar sólo las confirmadas: una cita pedida no aparecería');
  assert.match(bloque, /\.neq\('estado', 'cancelada'\)/, 'se están enseñando las canceladas');
});

test('la migración está escrita y es reversible', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0104_citas_con_notas_y_gestion.sql'), 'utf8');
  for (const col of ['notas', 'nota_gestor', 'creada_por', 'networking_modo']) {
    assert.ok(sql.includes(col), `la migración no añade \`${col}\``);
  }
  assert.match(sql, /Rollback/);
});

test('el modo se puede guardar desde el panel', () => {
  /* `eventos.networking_modo` existe en la base y el servidor la consulta en
     cada reserva. Pero la ruta que edita un evento descarta EN SILENCIO lo que
     no está en `CAMPOS_EDITABLES` —y hace bien—, así que sin esta línea el
     selector del panel guardaría en el vacío: la pantalla diría «guardado» y
     el modo no cambiaría nunca.

     Es la misma trampa de siempre: no falla nada, simplemente no pasa nada. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventos.js'), 'utf8');
  const i = src.indexOf('CAMPOS_EDITABLES = [');
  const bloque = src.slice(i, src.indexOf('];', i));
  assert.ok(bloque.includes("'networking_modo'"),
    'el modo de la rueda no se puede guardar: la lista blanca de campos editables no lo incluye');
});

/* ── La rueda pública ─────────────────────────────────────────────────── */

const PUB = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventos.publicos.js'), 'utf8');
const PUB_LIMPIO = PUB.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('la rueda pública no reparte contactos que nadie autorizó', () => {
  /* Aquí hay correos y teléfonos de personas. Filtrarlos en la pantalla los
     dejaría viajando en la respuesta — y una respuesta se abre con la consola
     del navegador. La comprobación va en el servidor o no va. */
  const i = PUB_LIMPIO.indexOf("'/slug/:slug/rueda'");
  assert.ok(i > 0, 'no existe la rueda pública');
  const bloque = PUB_LIMPIO.slice(i, i + 4000);
  assert.match(bloque, /m\.contacto_publico\s*\n?\s*\?/,
    'el contacto sale sin comprobar `contacto_publico`');
});

test('la rueda pública no dice quién ocupa cada hora', () => {
  /* Que la mesa esté llena a las diez es útil. Quién está sentado, no es de
     nadie. */
  const i = PUB_LIMPIO.indexOf("'/slug/:slug/rueda'");
  const bloque = PUB_LIMPIO.slice(i, i + 4000);
  assert.match(bloque, /libre: !tomados\.has\(h\.id\)/, 'no se dice qué horas quedan libres');
  assert.ok(!/user_id/.test(bloque), 'la rueda pública está mandando quién reservó cada hora');
});

test('la rueda pública sólo enseña eventos publicados', () => {
  const i = PUB_LIMPIO.indexOf("'/slug/:slug/rueda'");
  const bloque = PUB_LIMPIO.slice(i, i + 1600);
  assert.match(bloque, /estado !== 'publicado'/,
    'un borrador enseñaría su rueda a cualquiera');
});

test('si falta la 0105, se dice; no se contesta una rueda vacía', () => {
  /* Sin `rol`, PostgREST contesta con un error y no con una lista vacía. Sin
     mirarlo, la rueda saldría vacía y nadie sabría por qué — es exactamente lo
     que pasó con `zonas.tipo`. */
  const i = PUB_LIMPIO.indexOf("'/slug/:slug/rueda'");
  const bloque = PUB_LIMPIO.slice(i, i + 4000);
  assert.match(bloque, /if \(error\)/, 'no se mira el error de la consulta');
  assert.match(bloque, /0105/, 'el aviso no dice de qué migración depende');
});

test('la migración de la rueda deja el contacto APAGADO por defecto', () => {
  /* Encender la publicación de contactos que nadie autorizó no se deshace:
     una vez indexado, ya está fuera. */
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0105_rueda_publica_y_roles.sql'), 'utf8');
  assert.match(sql, /contacto_publico boolean not null default false/i,
    'el contacto se publicaría por defecto');
  assert.match(sql, /rol text not null default 'comprador'/i);
  assert.match(sql, /Rollback/);
});

test('el papel y el contacto público se pueden guardar de verdad', () => {
  /* Dos columnas nuevas sin sitio en las listas blancas serían dos ajustes que
     la pantalla dice haber guardado y que no cambian nunca — la ruta descarta
     en silencio lo que no está declarado, y hace bien. Ya me pasó con
     `networking_modo`. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'expositores.js'), 'utf8');

  const org = src.slice(src.indexOf('CAMPOS_EDITABLES_ORGANIZADOR'), src.indexOf('CAMPOS_EDITABLES_EXPOSITOR'));
  assert.ok(org.includes("'rol'"), 'quien organiza no puede decidir quién recibe y quién pasa');
  assert.ok(org.includes("'contacto_publico'"), 'quien organiza no puede APAGAR un contacto publicado');

  const emp = src.slice(src.indexOf('CAMPOS_EDITABLES_EXPOSITOR'));
  assert.ok(emp.includes("'contacto_publico'"), 'la empresa no puede decidir sobre sus propios datos');

  /* Y lo que NO puede tocar la empresa: dónde se sienta cada uno en la rueda
     es del que la arma, igual que `zona_id`. */
  const listaEmp = emp.slice(0, emp.indexOf('];'));
  assert.ok(!listaEmp.includes("'rol'"),
    'una empresa puede cambiarse el papel: se pondría a recibir en una rueda que no armó');

  /* Y que las columnas vuelvan al leerlas: sin esto se guardan y la pantalla
     las pinta apagadas al recargar. */
  assert.match(src, /rol, contacto_publico/, 'las columnas nuevas no se leen en COLS_COMPLETAS');
});
