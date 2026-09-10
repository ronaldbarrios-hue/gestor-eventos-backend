/* El catálogo de permisos viaja al panel, y quien reparte roles no se asciende.
 *
 * Tres cosas que salieron de preparar a quien va a llevar la logística de un
 * evento — la persona que asigna tareas, mira el aforo, revoca permisos y
 * limpia zonas.
 *
 * 1 · El panel mantenía su propia copia de la lista de permisos, «a mano y a
 *     propósito idéntica». Duró lo que duran esas cosas: `borrar_boletas` se
 *     añadió aquí, se protegió la ruta con él, y en el panel no apareció la
 *     casilla. El permiso existía y no había forma de concederlo. Ahora el
 *     catálogo viaja con los roles.
 *
 * 2 · Limpiar el aforo de una zona estaba detrás de `gestionar_clientes` — el
 *     permiso de tocar las boletas de la gente. Para dejar que alguien ponga a
 *     cero una zona al terminar una charla había que darle además poder sobre
 *     los asistentes de todo el evento.
 *
 * 3 · Quien tiene `gestionar_roles` podía cambiarse el rol a sí mismo: un clic
 *     de «Logística» a «Administrador».
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const { CATALOGO } = require('../core/permisos/catalogo.js');

test('el catálogo viaja con los roles, con lo que el panel necesita para pintarlo', () => {
  assert.match(leer('routes/roles.js'), /catalogo:\s*CATALOGO/,
    'el panel sigue teniendo que adivinar qué permisos existen');

  /* Sin `label` no se puede pintar la casilla y sin `grupo` no se puede
     ordenar: mandar sólo los ids dejaría al panel igual de ciego. */
  for (const p of CATALOGO) {
    assert.ok(p.id && p.label && p.grupo, `el permiso ${p.id} viaja sin etiqueta o sin grupo`);
  }
});

test('limpiar una zona es de logística, no de atención', () => {
  const src = leer('routes/clientes.js');
  const lista = src.match(/const PERMS_LIMPIAR = \[([^\]]*)\]/)?.[1] || '';
  assert.match(lista, /gestionar_accesos/,
    'quien lleva las puertas y las zonas todavía no puede poner un aforo a cero');
  /* Y el de antes se queda: quien hoy puede limpiar tiene que poder seguir
     limpiando mañana. Un permiso que empieza quitando acceso se descubre en
     mitad de un evento. */
  assert.match(lista, /gestionar_clientes/, 'a alguien se le quitó algo que ya tenía');

  /* El guardia de la puerta y el de dentro tienen que pedir lo mismo: si
     `exige()` deja pasar y el `assert` de dentro no, sale un 403 después de
     haber dejado entrar. */
  const ruta = src.slice(src.indexOf("router.post('/:eventoId/zonas/limpiar'"), src.indexOf('reporte-manual'));
  assert.match(ruta, /exige\(PERMS_LIMPIAR\)/);
  assert.match(ruta, /assertOwner\(eventoId, req\.user\.id, PERMS_LIMPIAR\)/);
});

test('nadie se cambia el rol a sí mismo', () => {
  const ruta = leer('routes/equipo.js');
  const patch = ruta.slice(ruta.indexOf("router.patch('/:eventoId/equipo/:miembroId'"), ruta.indexOf("router.delete('/:eventoId/equipo/:miembroId'"));
  assert.match(patch, /objetivo\.user_id\)\s*===\s*String\(req\.user\.id\)/,
    'quien reparte los roles puede ascenderse solo');
  /* El dueño sí puede: es su evento y no hay a quien pedirle permiso. */
  assert.match(patch, /ev\.owner_id\)\s*!==\s*String\(req\.user\.id\)/,
    'la guardia también atrapa al dueño, que no tiene a quién pedírselo');
});

test('lo que necesita quien lleva la logística se puede conceder', () => {
  /* Sus cuatro tareas y el permiso que las abre. Si mañana alguna cambia de
     permiso, esta prueba lo dice en vez de descubrirse el día de la
     capacitación. */
  const ids = new Set(CATALOGO.map(p => p.id));
  for (const p of ['gestionar_accesos', 'checkin', 'gestionar_roles', 'remover_miembros']) {
    assert.ok(ids.has(p), `${p} no está en el catálogo: no se puede conceder`);
  }
  /* Asignar tareas no pide permiso: basta con estar en el equipo. Se comprueba
     para que nadie lo «arregle» poniéndole uno sin querer. */
  assert.doesNotMatch(leer('routes/tareas.js'), /exige\(\[/,
    'las tareas empezaron a pedir un permiso: revisa quién se queda fuera');
});
