'use strict';

/* El almacén propio. Lo que se prueba aquí son los cuatro problemas medidos en
   SUPABASE.md §3.4, que es la razón de que este módulo exista:
 *
 *   a) 40 huérfanos y 28 MB porque nadie borraba el archivo anterior;
 *   b) `form-uploads` aceptando escritura de cualquiera desde internet;
 *   c) las hojas de vida en un bucket público;
 *   d) la subida de CV que no podía funcionar nunca por límites incompatibles.
 *
 * Y la que no está en esa lista pero es la que abre la máquina entera: que una
 * ruta con `..` no escriba fuera del almacén. */

process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.AUTH_PROPIA = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

/* La raíz del almacén tiene que quedar fijada ANTES de cargar la config, que
   la lee del entorno una sola vez. */
const RAIZ = path.join(os.tmpdir(), `gestek-archivos-${crypto.randomBytes(6).toString('hex')}`);
process.env.ARCHIVOS_RAIZ = RAIZ;
process.env.ARCHIVOS_URL_BASE = 'https://archivos.ejemplo.com';

const tipos = require('../modules/archivos/tipos.js');
const firmas = require('../modules/archivos/firmas.js');
const almacen = require('../modules/archivos/almacen.js');
const { crearServicio } = require('../modules/archivos/servicio.js');
const config = require('../core/config');

/* ── Archivos de mentira, con los bytes de verdad ──────────────────────── */

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 7)]);
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200, 7)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBP'), Buffer.alloc(200, 7)]);
const PDF  = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(200, 7)]);
const EXE  = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(200, 7)]);   // MZ, un ejecutable

/* Un repositorio en memoria con el contrato de `repositorio.js`. */
function crearRepoFalso() {
  const filas = [];
  let siguiente = 1;
  return {
    _filas: filas,
    async registrar(datos) {
      const f = { id: siguiente++, borradoAt: null, creadoAt: new Date(), ...datos };
      f.usuarioId = datos.usuarioId || null;
      filas.push(f);
      return f;
    },
    async porId(id) { return filas.find(f => f.id === id) || null; },
    async porRuta(ruta) { return filas.find(f => f.ruta === ruta) || null; },
    async anterioresDe({ usuarioId, carpeta, exceptoId }) {
      return filas.filter(f => f.usuarioId === usuarioId && f.carpeta === carpeta && !f.borradoAt && f.id !== exceptoId);
    },
    async marcarBorrado(id) {
      const f = filas.find(x => x.id === id);
      if (!f || f.borradoAt) return false;
      f.borradoAt = new Date();
      return true;
    },
    async bytesDe(usuarioId) {
      return filas.filter(f => f.usuarioId === usuarioId && !f.borradoAt).reduce((n, f) => n + f.bytes, 0);
    },
    async deUsuario(usuarioId, carpeta) {
      return filas.filter(f => f.usuarioId === usuarioId && !f.borradoAt && (!carpeta || f.carpeta === carpeta));
    },
    async borradosPendientes() { return filas.filter(f => f.borradoAt); },
    async olvidar(id) { const i = filas.findIndex(f => f.id === id); if (i >= 0) filas.splice(i, 1); },
  };
}

const montar = () => {
  const repo = crearRepoFalso();
  return { repo, servicio: crearServicio({ repo, almacen }) };
};

const USUARIO = '11111111-2222-3333-4444-555555555555';

test.after(() => fsp.rm(RAIZ, { recursive: true, force: true }).catch(() => {}));

/* ── El tipo real ──────────────────────────────────────────────────────── */

test('el tipo se deduce de los bytes, no de la extensión', () => {
  assert.equal(tipos.detectar(JPEG), 'image/jpeg');
  assert.equal(tipos.detectar(PNG), 'image/png');
  assert.equal(tipos.detectar(WEBP), 'image/webp');
  assert.equal(tipos.detectar(PDF), 'application/pdf');
  assert.equal(tipos.detectar(EXE), null);
  assert.equal(tipos.detectar(Buffer.alloc(0)), null);
});

test('un WEBP a medias no se confunde con un WEBP', () => {
  /* Empieza por RIFF, que también es un .wav o un .avi. La marca WEBP está en
     el byte 8, y sin comprobarla se acepta cualquier RIFF como imagen. */
  const riffCualquiera = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('AVI '), Buffer.alloc(50)]);
  assert.equal(tipos.detectar(riffCualquiera), null);
});

test('la extensión sale del tipo, no del nombre que mandó el cliente', () => {
  /* `factura.pdf.exe` con bytes de PDF se guarda como .pdf. Y al revés: un
     nombre inofensivo no convierte en inofensivo lo que lleva dentro. */
  assert.equal(tipos.extensionDe('application/pdf', 'factura.pdf.exe'), '.pdf');
  assert.equal(tipos.extensionDe('image/jpeg', 'cosa.php'), '.jpg');
  /* El único caso donde el nombre aporta: un .docx es un ZIP por dentro. */
  assert.equal(tipos.extensionDe('application/zip', 'hoja-de-vida.docx'), '.docx');
  assert.equal(tipos.extensionDe('application/zip', 'cosas.zip'), '.zip');
});

/* ── La ruta ───────────────────────────────────────────────────────────── */

test('una ruta con .. no sale del almacén', () => {
  /* Es la que abre la máquina entera: en un hosting compartido, escribir fuera
     del almacén es escribir en el resto de la cuenta. */
  assert.throws(() => almacen.absoluta('../../etc/passwd'));
  assert.throws(() => almacen.absoluta('avatars/../../../etc/passwd'));
  assert.throws(() => almacen.absoluta('/etc/passwd'));
  assert.throws(() => almacen.absoluta('avatars/x\0.jpg'));
  assert.throws(() => almacen.absoluta(''));
});

test('una ruta normal sí resuelve, y dentro', () => {
  const abs = almacen.absoluta('avatars/uid/foto.jpg');
  assert.ok(abs.startsWith(path.resolve(RAIZ) + path.sep));
});

test('dos subidas seguidas no comparten nombre', () => {
  const a = almacen.nuevaRuta({ carpeta: 'avatars', propietario: USUARIO, prefijo: 'avatar', extension: '.jpg' });
  const b = almacen.nuevaRuta({ carpeta: 'avatars', propietario: USUARIO, prefijo: 'avatar', extension: '.jpg' });
  assert.notEqual(a, b);
  /* Y la estructura es la misma que en Supabase: carpeta/dueño/archivo. Es lo
     que hace que reescribir las 13 columnas sea cambiar un prefijo. */
  assert.match(a, /^avatars\/11111111-2222-3333-4444-555555555555\/avatar-\d+-[0-9a-f]{12}\.jpg$/);
});

test('un nombre con sorpresas se limpia antes de tocar el disco', () => {
  assert.equal(almacen.limpiarSegmento('../../etc'), 'etc');
  assert.equal(almacen.limpiarSegmento('foto de perfil.jpg'), 'foto-de-perfil.jpg');
  assert.equal(almacen.limpiarSegmento('a/b/c'), 'a-b-c');
});

/* ── Subir ─────────────────────────────────────────────────────────────── */

test('una imagen válida se guarda, se registra y queda en el disco', async () => {
  const { servicio } = montar();
  const r = await servicio.subir({ contenido: JPEG, carpeta: 'avatars', nombreOriginal: 'yo.jpg', usuarioId: USUARIO });

  assert.equal(r.ok, true);
  assert.equal(r.archivo.tipo, 'image/jpeg');
  assert.equal(r.archivo.bytes, JPEG.length);
  assert.equal(await almacen.existe(r.archivo.ruta), true);
  /* La URL pública lleva el prefijo nuevo, que es el que sustituye al de
     Supabase dentro de las filas. */
  assert.ok(r.archivo.url.startsWith('https://archivos.ejemplo.com/avatars/'));
});

test('lo que no es lo que dice ser se rechaza', async () => {
  const { servicio, repo } = montar();
  const r = await servicio.subir({ contenido: EXE, carpeta: 'avatars', nombreOriginal: 'foto.jpg', usuarioId: USUARIO });

  assert.equal(r.codigo, 'tipo_no_admitido');
  assert.equal(r.status, 415);
  /* Y no llegó a tocar el disco ni a dejar ficha. */
  assert.equal(repo._filas.length, 0);
});

test('un PDF no entra donde van las fotos', async () => {
  const { servicio } = montar();
  const r = await servicio.subir({ contenido: PDF, carpeta: 'avatars', usuarioId: USUARIO });
  assert.equal(r.codigo, 'tipo_no_admitido');
});

test('el PDF sí entra en hojas de vida — y ahí sí funciona', async () => {
  /* El hallazgo (d): el código mandaba PDF de hasta 8 MB a un bucket que sólo
     admitía imágenes de 4 MB, así que NUNCA se subió un CV con éxito. En
     `form-uploads` hay 16 objetos y ninguno es PDF. */
  const { servicio } = montar();
  const r = await servicio.subir({ contenido: PDF, carpeta: 'hojas-de-vida', nombreOriginal: 'cv.pdf', usuarioId: USUARIO });

  assert.equal(r.ok, true);
  assert.equal(r.archivo.tipo, 'application/pdf');
});

test('una hoja de vida NO es pública y no tiene URL directa', async () => {
  /* El hallazgo (c): hoy los CV están en un bucket público. No se pueden
     listar, pero cada uno se lee por su URL, y son datos personales. */
  const { servicio } = montar();
  const r = await servicio.subir({ contenido: PDF, carpeta: 'hojas-de-vida', usuarioId: USUARIO });

  assert.equal(r.archivo.publico, false);
  assert.equal(r.archivo.url, null);
});

test('sin sesión no se sube a las carpetas que la exigen', async () => {
  const { servicio } = montar();
  assert.equal((await servicio.subir({ contenido: JPEG, carpeta: 'avatars' })).codigo, 'sin_sesion');
  assert.equal((await servicio.subir({ contenido: PDF, carpeta: 'hojas-de-vida' })).codigo, 'sin_sesion');

  /* `form-uploads` sigue admitiendo al expositor sin cuenta, que es
     deliberado: edita su ficha con el código de su boleta. Lo que ya no puede
     es escribir cualquiera en internet con la llave anónima del bundle. */
  const r = await servicio.subir({ contenido: JPEG, carpeta: 'form-uploads', eventoId: 'evt-1' });
  assert.equal(r.ok, true);
});

test('una carpeta inventada no existe', async () => {
  const { servicio } = montar();
  assert.equal((await servicio.subir({ contenido: JPEG, carpeta: '../../etc', usuarioId: USUARIO })).codigo, 'carpeta_invalida');
});

test('un archivo demasiado grande se rechaza con su medida', async () => {
  const { servicio } = montar();
  const gordo = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
  const r = await servicio.subir({ contenido: gordo, carpeta: 'avatars', usuarioId: USUARIO });

  assert.equal(r.codigo, 'demasiado_grande');
  assert.equal(r.status, 413);
});

test('un cuerpo vacío no crea un archivo de cero bytes', async () => {
  const { servicio } = montar();
  assert.equal((await servicio.subir({ contenido: Buffer.alloc(0), carpeta: 'avatars', usuarioId: USUARIO })).codigo, 'vacio');
});

/* ── El reemplazo, que es lo de los 40 huérfanos ───────────────────────── */

test('subir un avatar nuevo marca el anterior para borrar', async () => {
  /* El hallazgo (a): cuatro de los cinco uploaders suben el nuevo y dejan el
     viejo donde estaba. 40 objetos y 28 MB —más de un tercio del
     almacenamiento— que ya no apunta nadie. Es lo que explica el salto de 24 a
     80 MB: no es que se suba más, es que no se borraba nunca. */
  const { servicio, repo } = montar();

  const primero = await servicio.subir({ contenido: JPEG, carpeta: 'avatars', usuarioId: USUARIO });
  const segundo = await servicio.subir({ contenido: PNG, carpeta: 'avatars', usuarioId: USUARIO });

  assert.equal(segundo.reemplazados, 1);
  assert.ok((await repo.porId(primero.archivo.id)).borradoAt);
  assert.equal((await repo.porId(segundo.archivo.id)).borradoAt, null);
});

test('la galería del evento NO reemplaza: ahí cada imagen es una más', async () => {
  const { servicio } = montar();
  await servicio.subir({ contenido: JPEG, carpeta: 'event-media', usuarioId: USUARIO });
  const segunda = await servicio.subir({ contenido: PNG, carpeta: 'event-media', usuarioId: USUARIO });

  assert.equal(segunda.reemplazados, 0);
});

test('el archivo viejo sigue en disco hasta que pasa el barrido', async () => {
  /* A propósito: si el reemplazo fue un error, hay margen para deshacerlo. Y
     si el proceso se cae entre marcar y barrer, lo peor que queda es un
     archivo de más, nunca una pantalla sin foto. */
  const { servicio } = montar();
  const primero = await servicio.subir({ contenido: JPEG, carpeta: 'avatars', usuarioId: USUARIO });
  await servicio.subir({ contenido: PNG, carpeta: 'avatars', usuarioId: USUARIO });

  assert.equal(await almacen.existe(primero.archivo.ruta), true);

  const barrido = await servicio.barrer({ dias: 0 });
  assert.equal(barrido.borrados, 1);
  assert.equal(await almacen.existe(primero.archivo.ruta), false);
});

/* ── La cuota ──────────────────────────────────────────────────────────── */

test('pasada la cuota no se sube más', async () => {
  /* Sin esto, una cuenta puede llenar los 9,81 GB del disco compartido y
     tumbar la aplicación para todos. */
  const { servicio, repo } = montar();
  repo._filas.push({
    id: 999, usuarioId: USUARIO, carpeta: 'event-media', bytes: config.ARCHIVOS_CUOTA_BYTES, borradoAt: null,
  });

  const r = await servicio.subir({ contenido: JPEG, carpeta: 'event-media', usuarioId: USUARIO });
  assert.equal(r.codigo, 'sin_cuota');
});

test('lo borrado deja de ocupar cuota', async () => {
  const { servicio, repo } = montar();
  const primero = await servicio.subir({ contenido: JPEG, carpeta: 'event-media', usuarioId: USUARIO });
  assert.equal(await repo.bytesDe(USUARIO), JPEG.length);

  await servicio.borrar({ id: primero.archivo.id, usuarioId: USUARIO });
  assert.equal(await repo.bytesDe(USUARIO), 0);
});

/* ── Borrar ────────────────────────────────────────────────────────────── */

test('nadie borra el archivo de otro', async () => {
  /* Hoy esto lo sostiene RLS. Cuando RLS desaparezca, tiene que estar escrito
     en sitios como éste — es el trabajo de la fase 7, y aquí empieza. */
  const { servicio } = montar();
  const mio = await servicio.subir({ contenido: JPEG, carpeta: 'avatars', usuarioId: USUARIO });

  const r = await servicio.borrar({ id: mio.archivo.id, usuarioId: 'otro-usuario' });
  assert.equal(r.status, 403);
});

test('borrar dos veces no revienta', async () => {
  const { servicio } = montar();
  const mio = await servicio.subir({ contenido: JPEG, carpeta: 'avatars', usuarioId: USUARIO });

  assert.equal((await servicio.borrar({ id: mio.archivo.id, usuarioId: USUARIO })).ok, true);
  assert.equal((await servicio.borrar({ id: mio.archivo.id, usuarioId: USUARIO })).status, 404);
});

/* ── Los enlaces firmados ──────────────────────────────────────────────── */

test('un enlace firmado vale, y uno tocado no', async () => {
  const f = firmas.firmarRuta('hojas-de-vida/uid/cv-1.pdf');

  assert.equal(firmas.comprobar(f), true);
  assert.equal(firmas.comprobar({ ...f, ruta: 'hojas-de-vida/otro/cv-2.pdf' }), false);
  assert.equal(firmas.comprobar({ ...f, firma: 'a'.repeat(64) }), false);
  /* Alargar la caducidad tampoco cuela: va dentro de lo firmado. */
  assert.equal(firmas.comprobar({ ...f, expira: f.expira + 3600 }), false);
});

test('un enlace firmado caduca', async () => {
  const f = firmas.firmarRuta('hojas-de-vida/uid/cv.pdf', { vidaSegundos: 60 });
  const dentroDeUnaHora = () => Date.now() + 3600 * 1000;

  assert.equal(firmas.comprobar(f, { ahora: dentroDeUnaHora }), false);
});

test('la basura en la firma no lanza', () => {
  for (const malo of [{}, { ruta: 'x' }, { ruta: 'x', expira: 'ayer', firma: 'z' }, { ruta: 'x', expira: 1, firma: '' }]) {
    assert.doesNotThrow(() => firmas.comprobar(malo));
    assert.equal(firmas.comprobar(malo), false);
  }
});
