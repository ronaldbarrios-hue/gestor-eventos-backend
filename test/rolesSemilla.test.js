/* Que las dos semillas de roles no se separen, y que ningún rol prometa de más.
 *
 * Los roles se siembran en DOS sitios: `private.fn_roles_semilla()` en SQL
 * —que es la que corre hoy, por el trigger `seed_event_roles`— y el array
 * `ROLES` de `modules/eventos/semillas.js`, que es el camino de MySQL del
 * Frente A. Hoy dicen lo mismo. El día que alguien añada un permiso a uno y no
 * al otro, un evento tendrá permisos distintos según por qué camino nació — y
 * eso ya pasó una vez: los 31 eventos anteriores a la 0054 llevan el «Editor»
 * traducido del inglés de la 0007, sin `gestionar_agenda`.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROLES } = require('../modules/eventos/semillas.js');

/* La última migración que (re)define la semilla SQL. Se busca por contenido y
   no por número: así una 0095 que la vuelva a tocar se coge sola. */
function semillaSql() {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let ultima = null;
  for (const f of archivos) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/create\s+or\s+replace\s+function\s+\w+\.fn_roles_semilla/i.test(txt)) ultima = txt;
  }
  assert.ok(ultima, 'no encuentro ninguna migración que defina fn_roles_semilla');

  /* Desde la DECLARACIÓN de la función, no desde la última vez que se nombra:
     la 0089 la vuelve a llamar más abajo (`from private.fn_roles_semilla()`) y
     cortar por ahí dejaba fuera el bloque `values` entero — la prueba leía
     cero roles y se declaraba vieja en vez de comparar nada. */
  const inicio = ultima.search(/create\s+or\s+replace\s+function\s+\w+\.fn_roles_semilla/i);
  const cuerpo = ultima.slice(inicio);
  const roles = [];
  const re = /\('([^']+)',\s*'([^']*)',\s*'(\[[^']*\])'::jsonb,\s*(\d+)\)/g;
  let m;
  while ((m = re.exec(cuerpo))) {
    roles.push({
      nombre: m[1],
      permissions: JSON.parse(m[3].replace(/\s+/g, ' ')),
      orden: Number(m[4]),
    });
  }
  return roles;
}

const orden = (a) => [...a].sort();

test('la semilla SQL y la de JS reparten exactamente los mismos permisos', () => {
  const sql = semillaSql();
  assert.ok(sql.length >= 10, `sólo leo ${sql.length} roles del SQL: la prueba se quedó vieja`);
  assert.equal(sql.length, ROLES.length, 'las dos semillas tienen distinto número de roles');

  for (const rolSql of sql) {
    const rolJs = ROLES.find(r => r.nombre === rolSql.nombre);
    assert.ok(rolJs, `«${rolSql.nombre}» está en el SQL y no en semillas.js`);
    assert.deepEqual(
      orden(rolJs.permissions), orden(rolSql.permissions),
      `«${rolSql.nombre}» concede cosas distintas según por dónde nazca el evento`,
    );
    assert.equal(rolJs.orden, rolSql.orden, `«${rolSql.nombre}» sale en otro sitio de la lista`);
  }
});

test('existe un rol que puede todo', () => {
  /* Sin él, delegar «todo» obliga a traspasar el evento: el dueño no es un rol,
     es una columna. */
  const admin = ROLES.find(r => r.nombre === 'Administrador');
  assert.ok(admin, 'no hay rol «Administrador»');
  for (const otro of ROLES) {
    for (const p of otro.permissions) {
      assert.ok(admin.permissions.includes(p),
        `«${otro.nombre}» puede «${p}» y el Administrador no: deja de poder todo`);
    }
  }
});

test('ningún rol concede un permiso que no esté en el catálogo', () => {
  /* El catálogo vive en el frontend (`src/lib/permisos.js`) porque es lo que
     pinta la pantalla de roles. Un permiso sembrado que no esté ahí no se
     puede ni ver ni quitar desde la interfaz: queda concedido a ciegas. */
  const catalogo = path.join(
    __dirname, '..', '..', 'gestor-eventos-frontend', 'src', 'lib', 'permisos.js',
  );
  if (!fs.existsSync(catalogo)) return;   // repos separados: no es un fallo

  const txt = fs.readFileSync(catalogo, 'utf8');
  const conocidos = new Set([...txt.matchAll(/id:\s*'([\w_]+)'/g)].map(m => m[1]));
  assert.ok(conocidos.size > 15, 'no reconozco el catálogo de permisos: revisa la prueba');

  const sueltos = [];
  for (const r of ROLES) {
    for (const p of r.permissions) {
      if (!conocidos.has(p)) sueltos.push(`${r.nombre} → ${p}`);
    }
  }
  assert.deepEqual(sueltos, [], 'permisos sembrados que la pantalla de roles no conoce');
});
