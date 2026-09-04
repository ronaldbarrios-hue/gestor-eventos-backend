/* El catálogo de permisos, contra lo que las rutas comprueban de verdad.
 *
 * ── Lo que esto obliga ───────────────────────────────────────────────────
 *
 * Que añadir un permiso nuevo sea imposible de dejar a medias. Hoy, proteger
 * una ruta con `exige(['lo_que_sea'])` y olvidarse del resto no da ningún
 * error: da un 403 a alguien que debería poder, en una pantalla que quizá
 * tarda semanas en abrirse.
 *
 * Con esta prueba, un permiso nuevo rompe la suite hasta que esté en el
 * catálogo — y como «Administrador» se define como `[...TODOS]`, ahí ya no hay
 * nada que recordar.
 *
 * Correr: npm test */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const { CATALOGO, TODOS, SOLO_DUENO } = require('../core/permisos/catalogo.js');
const { ROLES } = (() => {
  const m = require('../modules/eventos/semillas.js');
  return { ROLES: m.ROLES || m.roles || null };
})();

/* Cada permiso que una ruta comprueba, venga como venga: en una constante
   `PERMS_X`, en un array suelto dentro de `exige(...)`, o con `.has('...')`. */
function permisosQueSeComprueban() {
  const encontrados = new Set();
  const dirs = ['routes', 'lib', 'core', 'modules'];
  const archivos = [];
  const anda = (d) => {
    const abs = path.join(RAIZ, d);
    if (!fs.existsSync(abs)) return;
    for (const f of fs.readdirSync(abs)) {
      const rel = `${d}/${f}`;
      if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) anda(rel);
      else if (f.endsWith('.js')) archivos.push(rel);
    }
  };
  dirs.forEach(anda);

  for (const rel of archivos) {
    /* El catálogo y la semilla los nombran todos por definición: contarlos
       haría que la prueba se confirmara a sí misma. */
    if (rel.endsWith('permisos/catalogo.js') || rel.endsWith('eventos/semillas.js')) continue;
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    const patrones = [
      /PERMS_[A-Z_]+\s*=\s*\[([^\]]*)\]/g,
      /exige\(\s*\[([^\]]*)\]/g,
      /assertPermiso\([^;]{0,160}?\[([^\]]*)\]/g,
      /assertOwner\([^;]{0,160}?\[([^\]]*)\]/g,
      /(?:tienePermiso|permisos\??\.has\??)\(([^)]*)\)/g,
    ];
    for (const re of patrones) {
      for (const m of src.matchAll(re)) {
        for (const id of (m[1] || '').match(/'[a-z_]{4,}'/g) || []) encontrados.add(id.replace(/'/g, ''));
      }
    }
  }
  return encontrados;
}

test('el catálogo no tiene repetidos y trae etiqueta y grupo', () => {
  assert.equal(new Set(TODOS).size, TODOS.length, 'hay un permiso repetido');
  for (const p of CATALOGO) {
    assert.ok(p.id && p.grupo && p.label, `«${p.id}» está incompleto: falta grupo o etiqueta`);
  }
});

test('todo permiso que una ruta comprueba está en el catálogo', () => {
  const comprobados = permisosQueSeComprueban();
  assert.ok(comprobados.size >= 15,
    `sólo se detectaron ${comprobados.size} permisos en el código: los patrones dejaron de encajar`);

  /* Se descartan los que son del dueño y nunca se conceden por rol. */
  const fuera = [...comprobados].filter((p) => !TODOS.includes(p) && !SOLO_DUENO.includes(p));
  assert.deepEqual(fuera, [],
    `estas rutas comprueban permisos que el catálogo no ofrece: ${fuera.join(', ')}.\n` +
    'Añádelos a core/permisos/catalogo.js — si no, nadie puede concederlos y la ruta es inalcanzable.');
});

test('«Administrador» se define como TODOS, no como una lista escrita a mano', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'modules', 'eventos', 'semillas.js'), 'utf8');
  const i = src.indexOf("nombre: 'Administrador'");
  assert.notEqual(i, -1, 'desapareció el rol Administrador');
  const bloque = src.slice(i, src.indexOf('},', i));
  assert.match(bloque, /permissions:\s*\[\.\.\.TODOS\]/,
    'el Administrador volvió a una lista literal: el día que se añada un permiso, no lo tendrá');
});

test('el rol Administrador acaba teniendo los 21', () => {
  /* Se comprueba el resultado además de la forma: `[...TODOS]` podría
     apuntar a una lista vacía y la prueba de arriba pasaría igual. */
  assert.ok(Array.isArray(ROLES), 'la semilla no exporta ROLES: no se puede comprobar el resultado');
  const admin = ROLES.find((r) => r.nombre === 'Administrador');
  assert.ok(admin, 'no hay rol Administrador en la semilla');
  assert.deepEqual([...admin.permissions].sort(), [...TODOS].sort());
});
