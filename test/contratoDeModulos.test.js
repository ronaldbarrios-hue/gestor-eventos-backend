/* Lo que un módulo pide y lo que otro exporta.
 *
 * ── El fallo que caza ────────────────────────────────────────────────────
 *
 * Esto:
 *
 *     const { confirmarTicketPagado } = require('./confirmarTicket.js');
 *
 * cuando `confirmarTicket.js` exporta otra cosa, o cuando alguien renombra la
 * función y se deja un sitio sin cambiar. No falla al arrancar: la constante
 * queda `undefined` y el servidor se levanta tan tranquilo. Revienta el día que
 * se llame — que puede ser el día del evento, dentro del webhook de un pago,
 * y con la respuesta de la pasarela ya recibida.
 *
 * El frontend tiene un linter con `no-undef` para esta misma familia de fallos.
 * Aquí no hay linter, y meter una dependencia por una regla no es gratis. Esto
 * cubre la parte que más muerde —el borde entre archivos— sin instalar nada:
 * se leen los `require` locales y se comprueba contra lo que el otro exporta
 * de verdad, cargándolo.
 *
 * ── Lo que NO cubre, para no venderlo de más ─────────────────────────────
 *
 * Una variable inventada DENTRO de una función. Para eso hace falta un parser,
 * y eso ya es un linter. Si algún día se añade uno, esta prueba sobra.
 *
 * Correr: npm test */
/* Las mismas variables de mentira que usan las otras pruebas. Hacen falta
   ANTES de cualquier require: `lib/supabase.js` no lanza cuando faltan, hace
   `process.exit(1)` — y eso no lo atrapa ningún try/catch: se lleva por
   delante el proceso de pruebas entero y el fallo se lee como «la prueba
   falló», sin decir por qué. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-que-no-es-el-de-produccion';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const CARPETAS = ['lib', 'routes', 'core', 'middleware', 'modules', 'scripts'];

function archivos(dir, out = []) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return out;
  for (const f of fs.readdirSync(abs)) {
    const rel = `${dir}/${f}`;
    if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) archivos(rel, out);
    else if (f.endsWith('.js')) out.push(rel);
  }
  return out;
}

const TODOS = CARPETAS.flatMap((d) => archivos(d));

test('hay archivos que revisar', () => {
  assert.ok(TODOS.length > 50, `sólo encontré ${TODOS.length} archivos: la lista de carpetas se quedó corta`);
});

test('todo `require` local apunta a un archivo que existe', () => {
  const rotos = [];
  for (const rel of TODOS) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    for (const m of src.matchAll(/require\(\s*'(\.[^']+)'\s*\)/g)) {
      const destino = path.resolve(path.dirname(path.join(RAIZ, rel)), m[1]);
      const existe = fs.existsSync(destino)
        || fs.existsSync(`${destino}.js`)
        || fs.existsSync(path.join(destino, 'index.js'));
      if (!existe) rotos.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepEqual(rotos, [], `estos require apuntan a archivos que no existen:\n  ${rotos.join('\n  ')}`);
});

test('lo que se saca de un módulo local, ese módulo lo exporta', () => {
  /* Se cargan los módulos de verdad. Los que necesitan `.env` —cualquiera que
     acabe requiriendo supabase— revientan al cargarse, y eso NO es un fallo de
     contrato: se saltan y se dice cuántos. Que la prueba se calle sobre lo que
     no pudo mirar sería peor que no tenerla. */
  const rotos = [];
  let saltados = 0;
  let comprobados = 0;

  for (const rel of TODOS) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(\s*'(\.[^']+)'\s*\)/g)) {
      const nombres = m[1].split(',')
        .map((n) => n.split(':')[0].trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
      if (!nombres.length) continue;

      let mod;
      try {
        mod = require(path.resolve(path.dirname(path.join(RAIZ, rel)), m[2]));
      } catch { saltados++; continue; }
      if (!mod || typeof mod !== 'object') continue;

      for (const n of nombres) {
        comprobados++;
        if (!(n in mod)) rotos.push(`${rel} saca \`${n}\` de ${m[2]}, que no lo exporta`);
      }
    }
  }

  if (saltados) console.log(`[contrato] ${saltados} require no se pudieron cargar (piden .env): no se comprobaron.`);

  /* El suelo. Sin esto, el día que la expresión de arriba deje de encajar
     —porque alguien escriba los require de otra forma— la prueba pasaría
     comprobando CERO nombres y en verde. Una prueba que no puede fallar es
     peor que no tenerla: ocupa el sitio de la que sí serviría. */
  assert.ok(comprobados > 100,
    `sólo se comprobaron ${comprobados} nombres: la expresión que lee los require dejó de encajar`);
  console.log(`[contrato] ${comprobados} nombres comprobados contra lo que exporta cada módulo.`);

  assert.deepEqual(rotos, [],
    `alguien se dejó un renombrado a medias:\n  ${rotos.join('\n  ')}`);
});
