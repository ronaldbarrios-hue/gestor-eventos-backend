/* La dirección de la aplicación: una para los enlaces, varias para CORS.
 *
 * ── El fallo que esto vigila ─────────────────────────────────────────────
 *
 * `FRONTEND_URL` hacía dos trabajos distintos: la URL canónica de los correos
 * (una) y la lista de orígenes permitidos por CORS (varios). Media docena de
 * archivos la leía como texto y otros tres hacían `.split(',')[0]` — el mismo
 * parche aplicado tres veces, que es la señal de que ya había mordido.
 *
 * El día que alguien añadiera un segundo origen para CORS, los correos habrían
 * mandado `https://uno.com,https://dos.com/mi-ticket/XYZ`. Sin error, sin aviso,
 * y roto justo el único enlace que la persona guarda.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

test('con dos orígenes, el enlace sigue siendo uno', () => {
  const antes = process.env.FRONTEND_URL;
  const antesCors = process.env.CORS_ORIGINS;
  try {
    process.env.FRONTEND_URL = 'https://gestek.co, https://otra.com';
    process.env.CORS_ORIGINS = 'https://preview.vercel.app';
    delete require.cache[require.resolve('../lib/frontend.js')];
    const f = require('../lib/frontend.js');

    assert.equal(f.baseFrontend(), 'https://gestek.co',
      'el enlace de los correos volvió a llevar la lista entera');
    /* Y CORS sí los ve todos: son preguntas distintas con respuestas distintas. */
    assert.deepEqual(f.origenesFrontend(),
      ['https://preview.vercel.app', 'https://gestek.co', 'https://otra.com']);
  } finally {
    process.env.FRONTEND_URL = antes;
    process.env.CORS_ORIGINS = antesCors;
    delete require.cache[require.resolve('../lib/frontend.js')];
  }
});

test('nadie arma la URL leyendo la variable por su cuenta', () => {
  /* Si vuelve a aparecer, vuelve el fallo: el que se olvide de partir por comas
     mandará enlaces con dos dominios pegados. */
  const sospechosos = [];
  for (const dir of ['routes', 'lib', 'modules']) {
    const base = path.join(RAIZ, dir);
    if (!fs.existsSync(base)) continue;
    const pila = [base];
    while (pila.length) {
      const d = pila.pop();
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) { pila.push(p); continue; }
        if (!n.endsWith('.js')) continue;
        const rel = path.relative(RAIZ, p).split(path.sep).join('/');
        if (rel === 'lib/frontend.js') continue;
        if (/process\.env\.FRONTEND_URL/.test(fs.readFileSync(p, 'utf8'))) sospechosos.push(rel);
      }
    }
  }
  assert.deepEqual(sospechosos, [], 'Usa `baseFrontend()` de lib/frontend.js');
});

test('un origen rechazado por CORS se dice en el log', () => {
  /* Un rechazo le llega al navegador como «Failed to fetch» y nada más: la
     página se queda vacía y no hay dónde mirar. Con la línea en el log, el
     servidor dice quién llamó y contra qué lista se comparó. */
  const seg = leer('config/security.js');
  assert.match(seg, /console\.warn\(`\[cors\]/, 'CORS volvió a rechazar en silencio');
});
