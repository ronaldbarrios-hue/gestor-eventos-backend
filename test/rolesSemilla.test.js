/* Los roles semilla, contra lo que promete su descripción.
 *
 * ── Qué se vigila ────────────────────────────────────────────────────────
 *
 * Un rol es una promesa escrita: «Atención — atiende asistentes durante el
 * evento». Si sus permisos no alcanzan para eso, el síntoma no es un error:
 * es una pantalla que no está, o un botón que contesta 403 con alguien
 * delante esperando su boleta.
 *
 * Aquí se fija esa correspondencia para los tres que estaban cortos, y algo
 * más barato de comprobar y más fácil de romper: que ningún rol reparta un
 * permiso que no existe en el catálogo. Un permiso inventado no falla al
 * guardarse — simplemente no autoriza nada, para siempre y sin avisar.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TODOS } = require('../core/permisos/catalogo.js');

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '0109_roles_que_hacen_lo_que_dicen.sql'), 'utf8');

/* La semilla tal cual la declara la migración: se leen los pares
   ('Nombre', 'descripción', '[...]'::jsonb, orden) de dentro de `values`. */
function rolesDeLaSemilla() {
  const ini = SQL.indexOf('returns table (nombre text');
  const fin = SQL.indexOf('-- ── 2 ·');
  const cuerpo = SQL.slice(ini, fin);
  const roles = [];
  const re = /\('([^']+)',\s*'([^']*)',\s*'(\[[\s\S]*?\])'::jsonb,\s*(\d+)\)/g;
  for (const m of cuerpo.matchAll(re)) {
    roles.push({ nombre: m[1], descripcion: m[2], permisos: JSON.parse(m[3]), orden: Number(m[4]) });
  }
  return roles;
}

const ROLES = rolesDeLaSemilla();
const porNombre = (n) => ROLES.find(r => r.nombre === n);

test('la semilla se puede leer y trae los once roles', () => {
  /* Si esto falla, todo lo de abajo pasaría por no encontrar nada. */
  assert.equal(ROLES.length, 11, `leí ${ROLES.length} roles de la semilla`);
});

test('ningún rol reparte un permiso que no existe', () => {
  /* Un permiso inventado no revienta: se guarda, se enseña en la pantalla del
     rol, y no autoriza nada. La persona tiene el rol correcto y la pantalla en
     blanco, y nadie relaciona una cosa con la otra. */
  const inventados = [];
  for (const r of ROLES) {
    for (const p of r.permisos) if (!TODOS.includes(p)) inventados.push(`${r.nombre} → ${p}`);
  }
  assert.deepEqual(inventados, [], 'permisos que no están en el catálogo');
});

test('Atención puede atender, no sólo mirar', () => {
  /* Lo primero que hace un puesto de atención es reenviar una boleta que no
     llegó o corregir un correo mal escrito. Las dos cosas piden
     `gestionar_clientes` (routes/clientes.js, PERMS_CLIENTES). Sin él, el rol
     entero se reducía a leer una lista. */
  const r = porNombre('Atención');
  assert.ok(r.permisos.includes('gestionar_clientes'),
    'sin `gestionar_clientes`, «Atención» no puede reenviar una boleta ni corregir un dato');
  assert.ok(r.permisos.includes('checkin'), 'y sigue necesitando escanear');
});

test('quien coordina expositores puede ver a quién sentar', () => {
  /* Desde la 0108 se sienta gente en la rueda con su correo, y para eso hay
     que poder ver quién está inscrito. */
  assert.ok(porNombre('Coordinación de expositores').permisos.includes('ver_clientes'),
    'sin `ver_clientes` no puede saber qué correos están registrados');
});

test('Logística no arma el programa, pero ve el aforo', () => {
  /* `gestionar_agenda` es armar el calendario del evento: no es el trabajo de
     montaje y técnica, y es de los permisos que más cosas mueven. Lo que sí
     necesita el día del evento es ver zonas y aforo, que van con `checkin`. */
  const r = porNombre('Staff · Logística');
  assert.ok(!r.permisos.includes('gestionar_agenda'),
    'Logística vuelve a poder reprogramar el evento entero');
  assert.ok(r.permisos.includes('checkin'), 'y se quedó sin ver zonas ni aforo');
});

test('el Administrador tiene el catálogo entero menos lo que es del dueño', () => {
  /* «Puede todo dentro del evento, salvo transferirlo o borrarlo». Cuando se
     añade un permiso nuevo y nadie se acuerda de este rol, el Administrador
     deja de poder algo que su descripción promete — y se descubre tarde. */
  const admin = porNombre('Administrador');
  const faltan = TODOS.filter(p => !admin.permisos.includes(p));
  assert.deepEqual(faltan, [],
    'el catálogo creció y el rol Administrador se quedó atrás: ' + faltan.join(', '));
});

test('sólo se tocan los roles que nadie ha ajustado', () => {
  /* Si alguien ya cambió su «Atención», esa decisión gana sobre la nuestra.
     La comparación es por CONJUNTO: el orden dentro del jsonb no significa
     nada, y compararlo como texto dejaría fuera filas idénticas. */
  const actualizaciones = [...SQL.matchAll(/update public\.event_roles r([\s\S]*?);/g)].map(m => m[1]);
  assert.ok(actualizaciones.length >= 3, 'no encuentro las actualizaciones de los roles ya creados');
  for (const u of actualizaciones) {
    assert.match(u, /is_system/, 'una actualización toca roles que no son de la semilla');
    assert.match(u, /fn_mismo_conjunto/,
      'una actualización pisa el rol aunque alguien ya lo hubiera ajustado');
  }
  assert.match(SQL, /create or replace function private\.fn_mismo_conjunto/,
    'desapareció la comparación por conjunto');
});
