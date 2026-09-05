/* Un error que se convierte en lista vacía y se manda como si fuera un hecho.
 *
 * ── El caso que lo trajo ─────────────────────────────────────────────────
 *
 * La pantalla del dinero pedía las transacciones así:
 *
 *     const { data: tx } = await supabase
 *       .from('payment_transactions')
 *       .select('id, proveedor, estado, monto, moneda, created_at')
 *     ...
 *     res.json({ transacciones: tx || [] });
 *
 * Las columnas se llaman `provider`, `status` y `currency`. PostgREST contesta
 * con un ERROR —no con filas a medias—, así que `tx` venía null; y el error se
 * tiraba al desestructurar sólo `data`. El panel de «lo que registraron las
 * pasarelas» llevaba vacío desde que se escribió. Medido en producción: cuatro
 * transacciones de Mercado Pago que nunca se vieron.
 *
 * Y ese panel existe, según su propio comentario, para poder ver cuándo las dos
 * fuentes del dinero no cuadran. Esa comparación no se ha podido hacer nunca.
 *
 * ── Por qué esta forma y no «mira siempre el error» ──────────────────────
 *
 * Porque en este servidor hay 382 consultas que se quedan sólo con `data`, y
 * en la mayoría está bien: una búsqueda donde «no existe» y «no pude preguntar»
 * acaban las dos en el mismo 404. Pedir un motivo escrito en las 382 sería
 * ruido, y una regla que nadie lee es peor que ninguna.
 *
 * Lo que sí es siempre un problema es esta combinación concreta: el error se
 * tira Y el resultado sale por la respuesta como una LISTA. Ahí el vacío deja
 * de ser «no sé» y pasa a ser «no hay», que es una afirmación — y quien la lee
 * decide con ella.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function archivos(dir) {
  const salida = [];
  const completa = path.join(RAIZ, dir);
  if (!fs.existsSync(completa)) return salida;
  for (const nombre of fs.readdirSync(completa)) {
    const ruta = path.join(completa, nombre);
    if (fs.statSync(ruta).isDirectory()) salida.push(...archivos(path.join(dir, nombre)));
    else if (nombre.endsWith('.js')) salida.push(path.join(dir, nombre));
  }
  return salida;
}

/* `data` a secas no se puede rastrear: se reasigna en cada consulta del mismo
   manejador y no hay forma de saber cuál llegó al `res.json`. Se miran las que
   tienen nombre propio, que además son las que viven más lejos de su consulta
   — justo donde el descuido cuesta más de ver. */
const SALE_COMO_LISTA = /\b(\w+)\s*:\s*(\w+)\s*\|\|\s*\[\]/g;

test('ninguna lista de la respuesta esconde un error de consulta', () => {
  const culpables = [];

  for (const rel of [...archivos('routes'), ...archivos('lib')]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r/g, '');

    for (const m of src.matchAll(SALE_COMO_LISTA)) {
      const variable = m[2];
      if (variable === 'data') continue;

      /* ¿Cómo se creó? Si se sacó el error junto al dato, alguien lo tuvo
         delante — mirarlo o no ya es una decisión suya, no un descuido. */
      const conError = new RegExp(`\\{\\s*data:\\s*${variable}\\s*,\\s*error`).test(src);
      const soloData = new RegExp(`\\{\\s*data:\\s*${variable}\\s*\\}\\s*=\\s*await\\s+supabase`).test(src);

      if (soloData && !conError) {
        const linea = src.slice(0, m.index).split('\n').length;
        culpables.push(`${rel}:${linea}  ${m[1]}: ${variable} || []`);
      }
    }
  }

  assert.deepEqual(culpables, [],
    'estas listas salen vacías tanto si no hay nada como si la consulta falló, y\n' +
    'quien las lee no puede distinguirlo. Saca el `error` junto al `data` y, como\n' +
    'mínimo, déjalo en el log:\n  ' + culpables.join('\n  '));
});
