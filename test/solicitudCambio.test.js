/* La solicitud que lleva el cambio dentro.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Quien colabora en un evento puede pedir que le corrijan su ficha —el nombre
 * con el que aparece, cómo se llama su puesto— y el cambio viaja dentro de la
 * solicitud para que quien organiza lo aplique de un clic, sin transcribir.
 *
 * Lo que no puede pasar, y es lo que esta prueba fija:
 *
 *  1. **Que el campo lo elija quien pide.** `campo` viaja desde el navegador y
 *     acaba en un `update`. Sin lista blanca, alguien pediría que le cambien
 *     `custom_permissions` o `status`, y bastaría con que quien organiza
 *     pulsara «aplicar» sin leer.
 *  2. **Que se aplique al pedirlo.** Es una SOLICITUD. Que el equipo corrija
 *     su propia ficha sin que nadie mire es justo lo que no se quiere.
 *  3. **Que se marque resuelta con el cambio sin hacer.** Si la escritura
 *     falla después de cerrar la solicitud, nadie vuelve a mirarla.
 *
 * Correr: npm test */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'solicitudes.js'), 'utf8');
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const LIMPIO = sinComentarios(SRC);

test('hay lista blanca de campos, y no incluye nada que dé poder', () => {
  const bloque = SRC.slice(SRC.indexOf('CAMPOS_PEDIBLES = {'), SRC.indexOf('};', SRC.indexOf('CAMPOS_PEDIBLES = {')));
  assert.ok(bloque.length > 20, 'no existe `CAMPOS_PEDIBLES`: el campo lo elegiría quien pide');

  for (const prohibido of ['custom_permissions', 'rol_id', 'status', 'user_id', 'evento_id']) {
    assert.ok(!bloque.includes(prohibido),
      `\`${prohibido}\` se puede pedir por solicitud: eso es concederse permisos`);
  }
  /* `rol` (la etiqueta) sí; `rol_id` (el rol de verdad, con sus permisos) no.
     La diferencia es que el segundo cambia lo que la persona puede tocar. */
  assert.ok(bloque.includes('nombre_invitado'), 'no se puede pedir corregir el propio nombre');
});

test('el campo se comprueba otra vez al APLICAR, no sólo al pedir', () => {
  /* Entre pedir y aprobar puede haber pasado un despliegue que quite un campo
     de la lista. Aplicar algo que ya no se acepta, por venir de una fila
     vieja, es la puerta de atrás clásica. */
  const iAplicar = LIMPIO.indexOf('req.body.aplicar');
  assert.ok(iAplicar > 0, 'no hay camino de aplicar');
  const bloque = LIMPIO.slice(iAplicar, iAplicar + 2000);
  assert.match(bloque, /CAMPOS_PEDIBLES\[sol\.cambio\.campo\]/,
    'al aplicar no se vuelve a comprobar el campo contra la lista blanca');
});

test('crear una solicitud NO aplica nada', () => {
  const iPost = LIMPIO.indexOf("router.post('/eventos/:eventoId/solicitudes'");
  const iPatch = LIMPIO.indexOf("router.patch('/eventos/:eventoId/solicitudes/:id'");
  assert.ok(iPost > 0 && iPatch > iPost);
  const bloquePost = LIMPIO.slice(iPost, iPatch);
  assert.ok(!/from\('event_members'\)[\s\S]{0,80}\.update\(/.test(bloquePost),
    'crear la solicitud escribe en `event_members`: entonces no es una solicitud, es una edición');
});

test('sólo quien organiza puede aplicar', () => {
  const iPatch = LIMPIO.indexOf("router.patch('/eventos/:eventoId/solicitudes/:id'");
  const bloque = LIMPIO.slice(iPatch, iPatch + 800);
  assert.match(bloque, /if \(!isOwner\) return res\.status\(403\)/,
    'el guardia de dueño desapareció del PATCH: cualquiera del equipo aplicaría cambios');
});

test('el cambio se aplica ANTES de cerrar la solicitud', () => {
  const iAplicar = LIMPIO.indexOf('req.body.aplicar');
  const bloque = LIMPIO.slice(iAplicar);
  const iUpdateMiembro = bloque.indexOf("from('event_members')");
  const iUpdateSolicitud = bloque.indexOf("from('event_requests')\n      .update");
  assert.ok(iUpdateMiembro > 0, 'no se escribe en `event_members` al aplicar');
  assert.ok(iUpdateSolicitud === -1 || iUpdateMiembro < iUpdateSolicitud,
    'la solicitud se cierra antes de aplicar el cambio: si la escritura falla, queda resuelta y sin hacer');
});

test('un cambio ya aplicado no se aplica dos veces', () => {
  assert.match(LIMPIO, /sol\.cambio\.aplicado_at/,
    'nada impide aplicar el mismo cambio dos veces');
});

test('quien colabora recibe su ficha entera, no sólo el nombre del rol', () => {
  const iRuta = LIMPIO.indexOf("'/me/equipo/eventos'");
  const bloque = LIMPIO.slice(iRuta, iRuta + 1800);
  assert.match(bloque, /mi_ficha/, 'sigue devolviendo sólo `mi_rol`');
  assert.match(bloque, /permisos\s*:/, 'no se dice qué puede hacer la persona');
  assert.match(bloque, /nombre_invitado/, 'no se dice cómo figura su nombre');
});

test('la migración está escrita y es reversible', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0103_solicitud_de_cambio.sql'), 'utf8');
  assert.match(sql, /add column if not exists cambio jsonb/i);
  assert.match(sql, /Rollback/);
});
