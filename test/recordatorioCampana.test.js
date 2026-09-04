/* El recordatorio de un evento, y por qué caminos sale.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * El ciclo de «mañana» y «empieza pronto» mandaba push y correo. El push casi
 * no llega —hace falta que la persona haya dado permiso en ese navegador, y en
 * producción hay UNA suscripción— y el ciclo entero se cortaba si faltaba la
 * llave VAPID: sin ella no se avisaba por ningún medio, y encima el evento se
 * quedaba sin marcar, así que el día que alguien configurara VAPID saldrían
 * todos los recordatorios viejos de golpe.
 *
 * La campana del panel no pide permiso y la ve cualquiera que abra el panel.
 * Era justo lo que intentaba `generar_recordatorios_inapp`, la función SQL que
 * nunca funcionó.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'recordatorios.js'), 'utf8');
const sinComentarios = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('el aviso también sale por la campana', () => {
  assert.match(sinComentarios, /avisarEnLaCampana/,
    'el recordatorio sigue saliendo sólo por push y correo');
  assert.match(sinComentarios, /notificarVarios/, 'no se crea ninguna notificación in-app');
});

test('la falta de VAPID apaga el push, no el ciclo entero', () => {
  /* El `return` temprano era el fallo: cortaba antes de avisar por cualquier
     medio y antes de marcar el evento. */
  const i = sinComentarios.indexOf('async function correrCicloAvisos');
  const cuerpo = sinComentarios.slice(i, sinComentarios.indexOf('\n}', i));
  assert.doesNotMatch(cuerpo, /VAPID_PRIVATE\)\s*\{\s*[^}]*return;/,
    'el ciclo vuelve a cortarse entero cuando falta VAPID');
  assert.match(cuerpo, /const hayPush = Boolean\(VAPID_PUBLIC && VAPID_PRIVATE\)/,
    'no se distingue «no hay push» de «no hay que avisar»');
});

test('el evento se marca DESPUÉS de avisar, no antes', () => {
  const i = sinComentarios.indexOf('async function correrCicloAvisos');
  const cuerpo = sinComentarios.slice(i, sinComentarios.indexOf('\n}', i));
  const iAviso = cuerpo.indexOf('avisarEnLaCampana(ev');
  const iMarca = cuerpo.indexOf('[columna]: new Date()');
  assert.ok(iAviso > 0 && iMarca > iAviso,
    'se marca el evento como avisado antes de avisar: un fallo a mitad lo deja marcado sin haber avisado a nadie');
});

test('el aviso lleva al mismo sitio que el push', () => {
  /* Pulsar la campana y pulsar la notificación del móvil no pueden acabar en
     pantallas distintas. */
  assert.match(sinComentarios, /link\s*:\s*`\/explorar\/\$\{evento\.slug\}`/,
    'la campana lleva a otro sitio que el push');
  assert.match(sinComentarios, /url\s*:\s*`\/explorar\/\$\{evento\.slug\}`/,
    'el push dejó de llevar al evento');
});

test('no quedan llamadas al nombre viejo', () => {
  assert.doesNotMatch(sinComentarios, /correrCicloPush\(/,
    'quedó una llamada a `correrCicloPush`, que ya no existe: el cron reventaría al arrancar');
});
