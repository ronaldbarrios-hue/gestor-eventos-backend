/* Montar el plano hablando.
 *
 * ── El hueco ─────────────────────────────────────────────────────────────
 *
 * Montando el concierto de prueba salió esto: por el agente se podía crear el
 * evento, las boletas, los artistas, la agenda y los descuentos — y **no lo
 * que hace que sea un concierto**: dónde se sienta la gente. El módulo del
 * plano existía y ninguna de las 73 herramientas llegaba a él.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const AGENTE = leer('lib/agente.js');

const decl = (n) => {
  const i = AGENTE.indexOf(`name: '${n}'`);
  return i < 0 ? '' : AGENTE.slice(i, AGENTE.indexOf('\n  },', i));
};
const ejec = (n) => {
  const i = AGENTE.indexOf(`async ${n}(userId, input)`);
  return i < 0 ? '' : AGENTE.slice(i, AGENTE.indexOf('\n  },', i));
};

test('el agente sabe montar un plano', () => {
  for (const n of ['crear_zona_plano', 'generar_sitios', 'ver_plano']) {
    assert.ok(decl(n), `falta la declaración de ${n}`);
    assert.ok(ejec(n), `falta el ejecutor de ${n}`);
  }
});

test('y son tres, no ocho', () => {
  /* Editar y borrar sitio a sitio se hace en el panel, donde se ve lo que se
     está tocando. Pedirle a un modelo que borre «la fila G» sobre 124 unidades
     es invitarle a acertar. */
  const delPlano = ['crear_zona_plano', 'generar_sitios', 'ver_plano', 'borrar_sitio', 'editar_sitio', 'mover_sitio']
    .filter(n => AGENTE.includes(`name: '${n}'`));
  assert.deepEqual(delPlano, ['crear_zona_plano', 'generar_sitios', 'ver_plano']);
});

test('nada se valida ni se nombra dos veces', () => {
  /* Todo pasa por `lib/espacios.js`, el mismo que usan las rutas del panel.
     Reescribirlo aquí haría que montar un plano hablando aceptara cosas que la
     pantalla rechaza —o al revés— y esa diferencia no se ve hasta que alguien
     compara. */
  const e = ejec('generar_sitios');
  assert.match(e, /espaciosLib\.generarUnidades\(/);
  assert.match(e, /espaciosLib\.filaEspacio\(/);
  assert.match(ejec('crear_zona_plano'), /espaciosLib\.validarEspacio\(/);
  assert.match(ejec('ver_plano'), /espaciosLib\.mapaPublico\(/);
  /* Y no una copia del nombrado de filas. */
  assert.doesNotMatch(e, /Fila |String\.fromCharCode/);
});

test('la zona se busca por su nombre, como la escribe quien habla', () => {
  /* Nadie dicta un UUID. Y sin tildes ni mayúsculas: «pista vip» tiene que
     encontrar «Pista VIP». */
  const e = ejec('generar_sitios');
  assert.match(e, /normalize\('NFD'\)/);
  assert.match(e, /limpia\(z\.nombre\) === limpia\(input\.zona\)/);
});

test('si la zona no existe, dice cuáles hay', () => {
  /* «No existe» a secas obliga a adivinar. Con la lista, el modelo se corrige
     solo en el siguiente intento en vez de preguntar. */
  assert.match(ejec('generar_sitios'), /Las que hay: \$\{\(zonas \|\| \[\]\)\.map/);
});

test('avisa cuando los sitios se quedan sin precio', () => {
  /* Un sitio sin tipo de boleta se ve en el mapa y NADIE lo puede comprar: el
     servidor no sabe qué cobrar y la venta no falla, simplemente no ocurre.
     Se avisa al crearlos y no se deja para el aviso de publicar, que llega
     mucho después. */
  const e = ejec('generar_sitios');
  assert.match(e, /nadie los puede comprar/);
  assert.match(ejec('ver_plano'), /nadie los puede comprar/);
});

test('crear una zona lleva al paso siguiente', () => {
  /* Una zona vacía no vende nada. Decir qué sigue evita el plano a medias, que
     es el estado en el que se queda quien no sabe que faltaba un paso. */
  assert.match(ejec('crear_zona_plano'), /generar_sitios, zona:/);
});

test('la zona que va a contener sitios se crea por aforo', () => {
  /* Lo vendible son sus hijos, no ella. Pedir «vendible» para una sección casi
     siempre quiere decir «aquí dentro se vende», no «se vende esta zona
     entera» — y una sección vendible sería una unidad de 112 asientos. */
  assert.match(sinComentarios(ejec('crear_zona_plano')), /modo: 'aforo'/);
});

test('leer el plano no ensucia la auditoría', () => {
  /* `ver_plano` empieza por `ver_`, así que el filtro de `auditarAgente` lo
     deja fuera solo. */
  const { SOLO_LEEN } = require('../lib/auditarAgente.js');
  assert.ok(SOLO_LEEN.test('ver_plano'));
  assert.ok(!SOLO_LEEN.test('crear_zona_plano'));
  assert.ok(!SOLO_LEEN.test('generar_sitios'));
});

test('y las tres salen por MCP', () => {
  /* Nada las excluye: no empiezan por `_` y no están en la lista de las que
     nunca salen. */
  const { herramientasPara } = require('../lib/alcanceMcp.js');
  const tools = [{ name: 'crear_zona_plano' }, { name: 'generar_sitios' }, { name: 'ver_plano' }];
  const vistas = herramientasPara(tools, null).map(t => t.name);
  assert.deepEqual(vistas.sort(), ['crear_zona_plano', 'generar_sitios', 'ver_plano']);
});
