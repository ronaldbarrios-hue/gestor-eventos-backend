/* El código con el que se entra al evento.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * El backend acepta el código corto ADEMÁS del token firmado, así que esto no
 * es un identificador bonito: es una credencial. Estaba copiado en cinco
 * archivos y las cinco copias usaban `Math.random()`.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const { generarCodigo, normalizarCodigo, ALFABETO } = require('../lib/codigos.js');

/* Sin comentarios. La primera versión de la prueba de abajo se delataba a sí
   misma: el archivo EXPLICA por qué ya no se usa `Math.random`, y ese texto
   contiene las palabras que la prueba prohíbe. Un comentario que cuenta lo que
   NO se hace no puede contar como haberlo hecho. */
function sinComentarios(src) {
  const sinBloques = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return sinBloques
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10));
}

test('el código no sale de Math.random', () => {
  /* `Math.random()` no es criptográfico: su estado se puede reconstruir
     observando suficientes salidas y de ahí predecir las siguientes. Para un
     color da igual; para algo que abre una puerta, no — y menos cuando los
     códigos se emiten en tanda y salen impresos uno detrás de otro. */
  const src = sinComentarios(leer('lib/codigos.js'));
  assert.match(src, /crypto\.randomBytes/, 'el generador ya no usa crypto');
  assert.ok(!/Math\.random/.test(src), 'volvió Math.random al generador de códigos');
});

test('nadie más genera códigos por su cuenta', () => {
  /* Cinco copias idénticas. El problema no era el aseo: el día que haya que
     alargarlo o cambiar el alfabeto, el sitio que se olvide sigue emitiendo de
     la forma vieja — y no se nota, porque los códigos se ven igual. */
  const sospechosos = [];
  for (const dir of ['routes', 'lib', 'modules', 'core']) {
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
        if (rel === 'lib/codigos.js') continue;
        if (/function generarCodigo|generarCodigo\s*=\s*\(/.test(fs.readFileSync(p, 'utf8'))) {
          sospechosos.push(rel);
        }
      }
    }
  }
  assert.deepEqual(sospechosos, [], 'Usa `lib/codigos.js` en vez de escribir otro generador');
});

test('el alfabeto no confunde a quien lo teclea', () => {
  /* Este código se lee en voz alta en una puerta. Un cero y una O se confunden
     a la primera, y quien está en la fila no tiene por qué adivinar. */
  for (const ch of ['I', 'O', '0', '1']) {
    assert.ok(!ALFABETO.includes(ch), `el alfabeto volvió a incluir «${ch}»`);
  }
});

test('el reparto no queda sesgado', () => {
  /* 256 es múltiplo de 32, así que `byte % 32` reparte por igual. Si alguien
     quita una letra del alfabeto, aparece un sesgo que nadie vería. */
  assert.equal(256 % ALFABETO.length, 0,
    'el alfabeto ya no divide a 256: el módulo introduce sesgo');
});

test('no se repiten, y salen del alfabeto', () => {
  const vistos = new Set();
  for (let i = 0; i < 5000; i++) vistos.add(generarCodigo());
  assert.equal(vistos.size, 5000, 'hubo repetidos en 5.000 códigos seguidos');
  for (const c of vistos) {
    assert.equal(c.length, 8);
    for (const ch of c) assert.ok(ALFABETO.includes(ch), `«${ch}» no está en el alfabeto`);
  }
});

test('normalizar no inventa códigos nuevos', () => {
  /* Mayúsculas y espacios sí; confusiones NO. Cambiar un 0 por una O
     «arreglaría» un código convirtiéndolo en otro distinto que también existe. */
  assert.equal(normalizarCodigo('  ab cd12  '), 'ABCD12');
  assert.equal(normalizarCodigo('0O1I'), '0O1I');
});
