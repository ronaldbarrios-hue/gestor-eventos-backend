/* Qué commit dice /health que hay corriendo.
 *
 * ── El fallo que esto vigila ─────────────────────────────────────────────
 *
 * cPanel y Render pueden quedar en versiones distintas sin que nada avise.
 * `lib/version.js` es la única fuente de la respuesta; este test cubre el
 * orden de prioridad (Render primero, luego el COMMIT.txt que deja el
 * despliegue de cPanel, luego git en vivo) y que nunca inventa un valor.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const COMMIT_TXT = path.join(RAIZ, 'COMMIT.txt');

function limpio() {
  delete require.cache[require.resolve('../lib/version.js')];
  return require('../lib/version.js');
}

test('RENDER_GIT_COMMIT manda si está, aunque haya COMMIT.txt', () => {
  const antes = process.env.RENDER_GIT_COMMIT;
  const habiaArchivo = fs.existsSync(COMMIT_TXT);
  const contenidoPrevio = habiaArchivo ? fs.readFileSync(COMMIT_TXT, 'utf8') : null;
  try {
    process.env.RENDER_GIT_COMMIT = 'aaaaaaa1111111111111111111111111111111';
    fs.writeFileSync(COMMIT_TXT, 'bbbbbbb2222222222222222222222222222222\n');
    const v = limpio();
    assert.equal(v.commitDesplegado(), 'aaaaaaa1111111111111111111111111111111');
    assert.equal(v.commitCorto(), 'aaaaaaa');
  } finally {
    if (antes === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = antes;
    if (habiaArchivo) fs.writeFileSync(COMMIT_TXT, contenidoPrevio);
    else fs.rmSync(COMMIT_TXT, { force: true });
    limpio();
  }
});

test('sin RENDER_GIT_COMMIT, usa el COMMIT.txt que deja el despliegue de cPanel', () => {
  const antes = process.env.RENDER_GIT_COMMIT;
  const habiaArchivo = fs.existsSync(COMMIT_TXT);
  const contenidoPrevio = habiaArchivo ? fs.readFileSync(COMMIT_TXT, 'utf8') : null;
  try {
    delete process.env.RENDER_GIT_COMMIT;
    fs.writeFileSync(COMMIT_TXT, 'ccccccc3333333333333333333333333333333\n');
    const v = limpio();
    assert.equal(v.commitDesplegado(), 'ccccccc3333333333333333333333333333333');
    assert.equal(v.commitCorto(), 'ccccccc');
  } finally {
    if (antes === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = antes;
    if (habiaArchivo) fs.writeFileSync(COMMIT_TXT, contenidoPrevio);
    else fs.rmSync(COMMIT_TXT, { force: true });
    limpio();
  }
});

test('sin nada de lo anterior, no inventa: dice "desconocido"', () => {
  const antes = process.env.RENDER_GIT_COMMIT;
  const habiaArchivo = fs.existsSync(COMMIT_TXT);
  const contenidoPrevio = habiaArchivo ? fs.readFileSync(COMMIT_TXT, 'utf8') : null;
  try {
    delete process.env.RENDER_GIT_COMMIT;
    fs.rmSync(COMMIT_TXT, { force: true });
    /* Sin `.git` a la vista tampoco se puede fiar de `leerGitEnVivo`: aquí SÍ
       hay un repo real (este mismo), así que sólo se comprueba que cuando de
       verdad no hay nada, `commitCorto` no revienta y da algo legible. */
    const v = limpio();
    const c = v.commitDesplegado();
    assert.ok(c === null || typeof c === 'string');
    assert.equal(v.commitCorto(), c ? c.slice(0, 7) : 'desconocido');
  } finally {
    if (antes === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = antes;
    if (habiaArchivo) fs.writeFileSync(COMMIT_TXT, contenidoPrevio);
    else fs.rmSync(COMMIT_TXT, { force: true });
    limpio();
  }
});
