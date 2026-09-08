/* Adjuntar archivos, y que los sensibles no anden sueltos.
 *
 * ── Lo que se cuida ──────────────────────────────────────────────────────
 *
 * El bucket público sirve por URL que no caduca, y esa URL viaja dentro de
 * `tickets.respuestas`: sale en el CSV de asistentes, en los informes y en
 * cualquier pantalla que enseñe las respuestas. Para un pitch deck está bien;
 * para una cédula escaneada es una filtración esperando a que alguien reenvíe
 * la hoja de cálculo.
 *
 * Todo lo de abajo existe para que marcar un campo como «sensible» signifique
 * algo de verdad, y no sea una casilla que tranquiliza sin hacer nada.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BUCKET_PUBLICO, BUCKET_PRIVADO, MAX_BYTES, SEGUNDOS_FIRMA,
  bucketDe, formatosDe, mimesDe, refPrivada, esPrivado, rutaDe,
  paraExportar, rutaNueva,
} = require('../lib/archivoDeFormulario.js');
const { filaCampo } = require('../lib/formularioCampos.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('un campo sensible va a otro bucket', () => {
  assert.equal(bucketDe({ sensible: true }), BUCKET_PRIVADO);
  assert.equal(bucketDe({ sensible: false }), BUCKET_PUBLICO);
  /* Sin la 0115 la columna no existe y llega `undefined`: va al público, que
     es lo que ya pasaba, en vez de a un bucket que todavía no existe. */
  assert.equal(bucketDe({}), BUCKET_PUBLICO);
  assert.equal(bucketDe(null), BUCKET_PUBLICO);
});

test('lo que se guarda de un archivo privado no es una URL', () => {
  /* Una URL en `respuestas` acaba en el CSV POR CONSTRUCCIÓN: el exportador
     escribe lo que hay, y lo que habría sería un enlace que abre el documento
     de alguien. */
  const ref = refPrivada('evt-1/campo-9-123.pdf');
  assert.equal(esPrivado(ref), true);
  assert.doesNotMatch(ref, /^https?:/);
  assert.equal(rutaDe(ref), 'evt-1/campo-9-123.pdf');
});

test('una ruta que intente salirse del bucket no se firma', () => {
  /* La ruta la escribe el navegador de quien sube, así que llega de fuera. Un
     `../` leería otro bucket — incluido uno con las fotos de todo el mundo. */
  assert.equal(rutaDe('privado:../avatars/otro.png'), null);
  assert.equal(rutaDe('privado:evt/../../x'), null);
  assert.equal(rutaDe('privado:/absoluta'), null);
  assert.equal(rutaDe('privado:'), null);
  assert.equal(rutaDe('privado:   '), null);
});

test('lo que no es una referencia privada no se confunde con una', () => {
  assert.equal(rutaDe('https://x.co/foto.png'), null);
  assert.equal(rutaDe(''), null);
  assert.equal(rutaDe(null), null);
  assert.equal(rutaDe(42), null);
});

test('el CSV no lleva el enlace de un archivo privado', () => {
  /* Es la pieza central. Esta hoja circula por correo. */
  const ref = refPrivada('evt-1/campo-9.pdf');
  const enHoja = paraExportar(ref);
  assert.doesNotMatch(enHoja, /evt-1/);
  assert.doesNotMatch(enHoja, /https?:/);
  /* Pero SÍ se dice que hay archivo: sin eso no se puede saber quién adjuntó y
     quién no, que es media razón para pedirlo. */
  assert.match(enHoja, /adjunto/i);
});

test('el CSV sí lleva el enlace de uno que no es sensible', () => {
  /* Es lo que ya pasa con las fotos, y cambiarlo rompería informes que
     funcionan. Lo que cambia es sólo lo marcado como sensible. */
  assert.equal(paraExportar('https://x.co/deck.pdf'), 'https://x.co/deck.pdf');
  assert.equal(paraExportar(''), '');
  assert.equal(paraExportar(null), '');
});

test('el nombre del archivo lleva la hora, así que nunca hay que sobrescribir', () => {
  /* Y sin sobrescribir no hace falta permiso de UPDATE en el bucket — que es
     lo que dejaría a cualquiera pisar el documento de otro conociendo su
     ruta. */
  const a = rutaNueva({ eventoId: 'evt', campoId: 'c1', extension: 'PDF' });
  assert.match(a, /^evt\/c1-\d+\.pdf$/);
  /* Una extensión rara no se cuela en la ruta. */
  assert.match(rutaNueva({ eventoId: 'e', campoId: 'c', extension: '../sh' }), /^e\/c-\d+\.sh$/);
  assert.match(rutaNueva({ eventoId: 'e', campoId: 'c', extension: '' }), /^e\/c-\d+\.bin$/);
});

test('en el bucket privado se aceptan menos formatos', () => {
  /* Un documento sensible no es una presentación, y cada formato de más es
     superficie que alguien va a tener que abrir. */
  const priv = mimesDe({ sensible: true });
  const pub = mimesDe({ sensible: false });
  assert.ok(pub.length > priv.length);
  assert.ok(!priv.some(m => m.includes('presentation')));
  assert.ok(priv.includes('application/pdf'), 'sin PDF no sirve para nada');
});

test('la firma caduca, y pronto', () => {
  /* Es la diferencia con el bucket público, donde el enlace no caduca nunca. */
  assert.ok(SEGUNDOS_FIRMA > 0 && SEGUNDOS_FIRMA <= 900,
    `una firma de ${SEGUNDOS_FIRMA}s se puede reenviar y seguir sirviendo`);
});

test('«sensible» sólo significa algo en un archivo', () => {
  /* Un `sensible: true` colgado de un campo de texto es una promesa que nadie
     cumple, y quien lo lea creerá que ese dato está protegido. */
  assert.equal(filaCampo({ tipo: 'archivo', etiqueta: 'RUT', sensible: true }).sensible, true);
  assert.equal(filaCampo({ tipo: 'texto', etiqueta: 'Empresa', sensible: true }).sensible, false);
});

/* ── Las rutas ───────────────────────────────────────────────────────── */

test('el destino lo decide el servidor, no el navegador', () => {
  /* Si lo eligiera quien sube, bastaría con no creérselo: subir el documento al
     bucket público y guardar su URL. No fallaría nada y el archivo quedaría con
     un enlace eterno en el CSV. */
  const r = sinComentarios(leer('routes/eventos.publicos.js'));
  assert.match(r, /slug\/:slug\/archivo\/destino/);
  assert.match(r, /bucket: bucketDe\(campo\)/);
  assert.match(r, /ruta: rutaNueva\(\{ eventoId: evento\.id, campoId, extension \}\)/);
  /* Y no acepta cualquier campo: tiene que ser uno que pida archivo. */
  assert.match(r, /campo\.tipo !== 'archivo' && campo\.tipo !== 'foto'/);
});

test('`sensible` viaja en la lista de columnas de siempre', () => {
  /* Estuvo en una segunda lista, `COLUMNAS_CAMPO_CON_SENSIBLE`, mientras la
     0115 no estaba aplicada: esta se usa en 34 consultas y meterle una columna
     que la base no tiene las rompe todas en el hueco entre desplegar y migrar.
     La 0115 está aplicada y verificada, asi que la segunda lista ya no protege
     de nada — solo deja dos nombres para lo mismo y un formulario que devuelve
     `sensible` o no segun cual use quien escriba la consulta. */
  const l = leer('lib/formularioCampos.js');
  const linea = l.split(/\r?\n/).find(x => x.startsWith('const COLUMNAS_CAMPO ='));
  assert.ok(linea && linea.includes('sensible'), 'COLUMNAS_CAMPO no trae `sensible`');
  /* Sin comentarios: el nombre viejo sigue en la explicación de arriba a
     propósito — cuenta por qué estuvo aparte y cuándo volvería a hacer falta
     ese patrón. Lo que no puede quedar es la segunda lista de verdad. */
  assert.doesNotMatch(sinComentarios(l), /COLUMNAS_CAMPO_CON_SENSIBLE/, 'quedan dos listas para lo mismo');
});

test('un adjunto funciona igual en el evento, en un sub-evento y en un torneo', () => {
  /* Las preguntas de los tres viven en `event_form_fields` y se distinguen por
     `session_id` y `torneo_id`. La ruta que autoriza la subida filtra por
     `evento_id` y por ninguna de las dos: filtrar por `session_id is null`
     dejaria los adjuntos de un taller sin destino, y sin error — con un
     formulario que no deja adjuntar y nadie sabe por que. */
  const r = sinComentarios(leer('routes/eventos.publicos.js'));
  const i = r.indexOf("slug/:slug/archivo/destino");
  const bloque = r.slice(i, i + 900);
  assert.match(bloque, /\.eq\('evento_id', evento\.id\)/);
  assert.doesNotMatch(bloque, /session_id|torneo_id/);
});

test('abrir un archivo privado pide permiso y deja rastro', () => {
  const r = sinComentarios(leer('routes/clientes.js'));
  assert.match(r, /clientes\/:ticketId\/archivo', exige\(\['ver_clientes', 'gestionar_clientes'\]\)/);
  /* La referencia sale de la boleta que se pide, NO de la URL: si no, se abriría
     el documento de otro cambiando un parámetro. */
  assert.match(r, /const valor = ticket\.respuestas\?\.\[campoId\];/);
  assert.match(r, /const ruta = rutaDe\(valor\);/);
  /* Y queda anotado quién lo abrió: un documento sensible que cualquiera del
     equipo puede ver sin rastro es media política de privacidad. */
  assert.match(r, /cliente\.ver-archivo/);
});

test('el exportador pasa las respuestas por `paraExportar`', () => {
  const r = sinComentarios(leer('routes/clientes.js'));
  assert.match(r, /map\(c => aTexto\(paraExportar\(/);
});

/* ── La migración ────────────────────────────────────────────────────── */

const SQL = leer('db/migrations/0115_adjuntar_archivos_al_formulario.sql');

test('el bucket privado no es público, y no tiene política de lectura', () => {
  /* Es la pieza central de todo esto: sin SELECT, la llave anónima no puede
     leer nada de ese bucket ni adivinando la ruta. */
  assert.match(SQL, /'form-uploads-privado', false/);
  assert.match(SQL, /create policy form_uploads_privado_insert[\s\S]{0,120}for insert/);
  const soloSql = sinComentarios(SQL).replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(soloSql, /form_uploads_privado[\s\S]{0,80}for select/i,
    'el bucket privado tiene política de lectura: deja de ser privado');
  assert.doesNotMatch(soloSql, /form_uploads_privado[\s\S]{0,80}for update/i,
    'con UPDATE se puede pisar el documento de otro conociendo su ruta');
});

test('la migración es reversible y no borra nada de lo que ya había', () => {
  assert.match(SQL, /-- Vuelta atrás/);
  const soloSql = sinComentarios(SQL).replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(soloSql, /drop (table|column)/i);
  /* El tope del bucket público se amplía; no se recorta. Recortarlo dejaría
     sin poder actualizar fotos que ya están subidas. */
  assert.match(SQL, /file_size_limit = 15728640/);
});

test('el tope del código y el del bucket son el mismo número', () => {
  /* Dos números distintos serían un formulario que acepta un archivo y un
     almacenamiento que lo rechaza — con el error llegando desde Storage, sin
     traducir, después de subir quince megas. */
  assert.equal(MAX_BYTES, 15728640);
  assert.match(SQL, new RegExp(String(MAX_BYTES)));
});
