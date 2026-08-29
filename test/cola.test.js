'use strict';

/* La contingencia de la cola de correo.
 *
 * El agujero que esto cierra: una fila se marca `enviando` ANTES de intentar el
 * envío, a propósito, para que un proceso que muere a mitad no reenvíe la
 * boleta al arrancar otra vez —dos QR distintos confunden más que uno que no
 * llegó—. El precio es que esa fila se queda en `enviando` y ya no la mira
 * nadie: el correo se pierde EN SILENCIO.
 *
 * Mientras el proceso vivía para siempre eso casi no pasaba. Con el backend en
 * cPanel pasa a ser rutina: Passenger recicla la aplicación cuando nadie la
 * usa, y el cron puede caer en mitad de una pasada.
 *
 * Lo que se comprueba aquí es que el rescate no rompe la regla original: lo
 * colgado NO se reenvía solo, se marca como fallido con el motivo escrito y
 * reenviarlo pasa a ser una decisión de alguien.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';
process.env.EMAIL_COLA_ACTIVA = '1';

const test = require('node:test');
const assert = require('node:assert');

/* Un doble de `supabase` con la forma encadenable del cliente de verdad.
   Guarda lo que se le pidió para poder mirarlo después: qué se actualizó, con
   qué filtros y sobre qué tabla. */
function crearSupabaseFalso({ filas = [], alActualizar } = {}) {
  const registro = { updates: [], selects: [] };

  function consulta(tabla) {
    const estado = { tabla, filtros: [], parche: null, cols: null, limite: null };

    /* Todo devuelve el mismo objeto, y el objeto es «thenable»: así se comporta
       el cliente de verdad, donde `select()` no cierra la cadena —se le pueden
       seguir colgando filtros— y lo que dispara la consulta es el `await`.
       Con un doble que cerrara en `select()`, la prueba pasaría con código que
       en producción revienta. */
    const api = {
      update(parche) { estado.parche = parche; return api; },
      select(cols)   { estado.cols = cols; return api; },
      eq(col, val)   { estado.filtros.push(['eq', col, val]); return api; },
      lt(col, val)   { estado.filtros.push(['lt', col, val]); return api; },
      lte(col, val)  { estado.filtros.push(['lte', col, val]); return api; },
      order()        { return api; },
      limit(n)       { estado.limite = n; return api; },

      then(resolver, rechazar) {
        let resultado;
        if (estado.parche) {
          registro.updates.push({ ...estado });
          resultado = { data: alActualizar ? alActualizar(estado) : [], error: null };
        } else {
          registro.selects.push({ ...estado });
          resultado = { data: filas, error: null };
        }
        return Promise.resolve(resultado).then(resolver, rechazar);
      },
    };
    return api;
  }

  return { _registro: registro, from: (tabla) => consulta(tabla) };
}

function cargarCola(supabaseFalso) {
  const ruta = require.resolve('../lib/supabase.js');
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: supabaseFalso };
  delete require.cache[require.resolve('../lib/colaCorreo.js')];
  return require('../lib/colaCorreo.js');
}

/* ── El rescate ────────────────────────────────────────────────────────── */

test('lo que lleva demasiado en «enviando» se marca fallido, no se reenvía', async () => {
  const falso = crearSupabaseFalso({ alActualizar: () => [{ id: 'a' }, { id: 'b' }] });
  const cola = cargarCola(falso);

  const r = await cola.rescatarColgados();

  assert.equal(r.rescatados, 2);

  const upd = falso._registro.updates.at(-1);
  assert.equal(upd.tabla, 'email_cola');
  /* Fallido, NO pendiente: reenviar solo duplicaría la boleta, que es lo que
     la regla original evitaba. */
  assert.equal(upd.parche.estado, 'fallido');
  assert.match(upd.parche.ultimo_error, /Interrumpido/);
  /* Y el motivo dice qué hacer, porque lo va a leer alguien que no escribió
     este código. */
  assert.match(upd.parche.ultimo_error, /reintentar desde el panel/i);
});

test('el rescate sólo toca lo que estaba «enviando» y es viejo', async () => {
  const falso = crearSupabaseFalso({ alActualizar: () => [] });
  const cola = cargarCola(falso);

  const antes = Date.now();
  await cola.rescatarColgados({ minutos: 10 });

  const { filtros } = falso._registro.updates.at(-1);
  assert.deepEqual(filtros[0], ['eq', 'estado', 'enviando']);

  const [tipo, columna, valor] = filtros[1];
  assert.equal(tipo, 'lt');
  /* `proximo_intento` y no una columna de «última modificación»: la tabla no
     tiene ninguna, y añadirla habría sido una migración en producción para
     algo que ésta ya sabe decir. */
  assert.equal(columna, 'proximo_intento');

  const corte = new Date(valor).getTime();
  const esperado = antes - 10 * 60_000;
  assert.ok(Math.abs(corte - esperado) < 5_000, 'el corte no son diez minutos atrás');
});

test('un envío en curso, reciente, no se toca', async () => {
  /* El filtro es del servidor, así que aquí se comprueba la intención: con el
     corte a diez minutos, una fila marcada hace un segundo queda fuera. */
  const falso = crearSupabaseFalso({ alActualizar: (estado) => {
    const [, , corte] = estado.filtros.find(f => f[0] === 'lt');
    const marcadaHaceUnSegundo = new Date(Date.now() - 1000).toISOString();
    return marcadaHaceUnSegundo < corte ? [{ id: 'x' }] : [];
  } });
  const cola = cargarCola(falso);

  const r = await cola.rescatarColgados();
  assert.equal(r.rescatados, 0);
});

test('si la tabla no existe, el rescate no rompe la pasada', async () => {
  /* La cola es opcional: hay instalaciones sin ella. Que falte no puede hacer
     que el cron entero se caiga. */
  const falso = crearSupabaseFalso();
  const roto = {
    update: () => roto, select: () => roto, eq: () => roto, lt: () => roto,
    then: (r) => Promise.resolve({ data: null, error: { message: 'relation "email_cola" does not exist' } }).then(r),
  };
  falso.from = () => roto;
  const cola = cargarCola(falso);

  const r = await cola.rescatarColgados();
  assert.equal(r.rescatados, 0);
  assert.equal(r.saltado, true);
});

/* ── El reintento, que es de alguien ───────────────────────────────────── */

test('reintentar devuelve los fallidos a la cola, con los intentos a cero', async () => {
  const falso = crearSupabaseFalso({ alActualizar: () => [{ id: '1' }, { id: '2' }, { id: '3' }] });
  const cola = cargarCola(falso);

  const r = await cola.reintentarFallidos('evt-1');

  assert.equal(r.ok, true);
  assert.equal(r.reencolados, 3);

  const upd = falso._registro.updates.at(-1);
  assert.equal(upd.parche.estado, 'pendiente');
  /* A cero: si se quedaran en 3, la cola los daría por agotados en el primer
     fallo y el botón de reintentar no serviría de nada. */
  assert.equal(upd.parche.intentos, 0);
  assert.deepEqual(upd.filtros[0], ['eq', 'evento_id', 'evt-1']);
  assert.deepEqual(upd.filtros[1], ['eq', 'estado', 'fallido']);
});

/* ── Y en su sitio dentro de la pasada ─────────────────────────────────── */

test('la pasada rescata antes de mandar nada', async () => {
  /* Va dentro de `drenar` y no en un cron aparte porque es justo el momento en
     que importa: si no, esas filas se quedan invisibles hasta que alguien las
     busque a mano. */
  const falso = crearSupabaseFalso({ filas: [], alActualizar: () => [{ id: 'colgada' }] });
  const cola = cargarCola(falso);

  const r = await cola.drenar(async () => ({ ok: true }));

  assert.equal(r.rescatados, 1);
  /* El primer toque a la tabla fue el rescate, antes de leer el lote. */
  assert.equal(falso._registro.updates[0].parche.estado, 'fallido');
});

test('con la cola apagada no se toca nada', async () => {
  const previo = process.env.EMAIL_COLA_ACTIVA;
  process.env.EMAIL_COLA_ACTIVA = '';
  try {
    const falso = crearSupabaseFalso();
    const cola = cargarCola(falso);

    const r = await cola.drenar(async () => ({ ok: true }));
    assert.equal(r.saltado, 'apagada');
    assert.equal(falso._registro.updates.length, 0);
  } finally {
    process.env.EMAIL_COLA_ACTIVA = previo;
  }
});
