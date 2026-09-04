/* Quién puede atender una puerta.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Una puerta declara qué staff la atiende (`zonas.reglas.staff`, y antes
 * `page_json.accesos[].staff`). `leerPuerta` lo devolvía fielmente y **no lo
 * comprobaba nadie**: se elegía con cuidado quién atiende la puerta VIP y
 * cualquiera con `checkin` podía marcar entradas por ella.
 *
 * Y `vip_zone` llevaba en el catálogo desde siempre con la nota «sin efecto
 * todavía». Ésta es su función, y compone con la lista en vez de duplicarla.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* La función se prueba de verdad, no por su texto: se extrae del archivo y se
   evalúa. Es fea y es honesta — `routes/clientes.js` no se puede importar sin
   arrancar medio servidor, y una prueba que sólo mirase el código no sabría
   decir si el orden de las condiciones es el correcto. */
function cargarPuedeAtender() {
  const src = leer('routes/clientes.js');
  const i = src.indexOf('function puedeAtenderPuerta');
  assert.notEqual(i, -1, 'ya no existe `puedeAtenderPuerta`: la puerta volvió a no comprobar nada');
  const fin = src.indexOf('\n}', i) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(i, fin)}; return puedeAtenderPuerta;`)();
}

const puedeAtender = cargarPuedeAtender();
const OWNER = 'owner-1';
const ctx = (perms = []) => ({ owner_id: OWNER, permisos: new Set(perms) });

test('una puerta sin lista de staff no restringe a nadie', () => {
  assert.equal(puedeAtender({ nombre: 'General', staff: [] }, 'x', ctx()), true);
  assert.equal(puedeAtender({ nombre: 'General' }, 'x', ctx()), true,
    'sin la propiedad siquiera: no haber puesto a nadie es no restringir');
});

test('quien está en la lista pasa', () => {
  assert.equal(puedeAtender({ staff: ['a', 'b'] }, 'b', ctx()), true);
});

test('quien NO está en la lista no pasa', () => {
  assert.equal(puedeAtender({ staff: ['a', 'b'] }, 'c', ctx()), false,
    'la lista de staff de la puerta no restringe nada');
});

test('el dueño del evento pasa siempre, aunque no esté apuntado', () => {
  assert.equal(puedeAtender({ staff: ['a'] }, OWNER, ctx()), true);
});

test('`vip_zone` es la llave maestra: atiende puertas sin estar apuntado', () => {
  assert.equal(puedeAtender({ staff: ['a'] }, 'c', ctx(['vip_zone'])), true);
  assert.equal(puedeAtender({ staff: ['a'] }, 'c', ctx(['checkin'])), false,
    '`checkin` a secas no puede abrir una puerta restringida: entonces la lista no serviría de nada');
});

test('los ids se comparan como texto: un uuid y su string son el mismo', () => {
  assert.equal(puedeAtender({ staff: [123] }, '123', ctx()), true);
});

test('el check-in llama a la comprobación antes de marcar la boleta', () => {
  const src = leer('routes/clientes.js');
  const iCheck = src.indexOf('puedeAtenderPuerta(puerta');
  const iUpdate = src.indexOf("estado: 'usado'");
  assert.ok(iCheck > 0 && iCheck < iUpdate,
    'se comprueba la puerta después de marcar la entrada, o no se comprueba');
});
