#!/usr/bin/env node
'use strict';

/* scripts/censar-rutas.js — pasa lista a las rutas y actualiza el inventario.
 *
 *   node scripts/censar-rutas.js              # enseña el estado, no escribe
 *   node scripts/censar-rutas.js --guardar    # anota las nuevas y baja el tope
 *
 * El tope de pendientes sólo baja. Es lo que convierte «habría que declarar los
 * permisos algún día» en algo que se puede medir cada semana: si el número no
 * baja, no se avanzó, y si sube, la prueba se pone roja.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const app = require('../index.js');
const { comparar, leerInventario, guardarInventario } = require('../core/permisos/censo.js');

const GUARDAR = process.argv.includes('--guardar');

const inventario = leerInventario() || { pendientes_maximo: Infinity, rutas: {} };
const r = comparar(app, inventario);

const declaradas = r.actuales.length - r.pendientes.length;

console.log('\n── Rutas registradas ─────────────────────────────────────');
console.log(`   total               ${r.actuales.length}`);
console.log(`   declaradas          ${declaradas}`);
console.log(`   pendientes          ${r.pendientes.length}   (tope anotado: ${inventario.pendientes_maximo})`);

if (r.nuevas.length) {
  console.log(`\n   nuevas desde el último censo: ${r.nuevas.length}`);
  for (const x of r.nuevas) console.log(`     ${x.estado === 'pendiente' ? '✗' : '·'} ${x.id}`);
}
if (r.desaparecidas.length) {
  console.log(`\n   ya no existen: ${r.desaparecidas.length}`);
  for (const id of r.desaparecidas) console.log(`     · ${id}`);
}

if (!GUARDAR) {
  console.log('\n(Sin --guardar no se escribe nada.)\n');
  process.exit(0);
}

const rutas = {};
for (const x of r.actuales) {
  rutas[x.id] = x.estado === 'exige'
    ? { estado: 'exige', acciones: x.acciones }
    : x.estado === 'publica'
      ? { estado: 'publica', motivo: x.motivo }
      : { estado: 'pendiente' };
}

guardarInventario({
  /* El tope nunca sube: si hoy hay más pendientes que el tope anotado, es que
     alguien añadió rutas sin declarar, y eso lo tiene que arreglar quien las
     añadió, no este script. */
  pendientes_maximo: Math.min(inventario.pendientes_maximo ?? Infinity, r.pendientes.length),
  censado_el       : new Date().toISOString().slice(0, 10),
  total            : r.actuales.length,
  rutas,
});

console.log('\n✓ Inventario actualizado.\n');
process.exit(0);
