/* GESTEK — El cierre de una reunión de la rueda.
 *
 * ── Qué es «cerrar» una cita ─────────────────────────────────────────────
 *
 * Dos cosas, y son distintas:
 *
 *   · `resultado` — si la reunión OCURRIÓ. `realizada` o `no_asistio`.
 *   · La expectativa — cuánto negocio se espera de ella, en cuánto tiempo, y
 *     si hubo acuerdo.
 *
 * Lo primero es lo que convierte una agenda en un informe. Lo segundo es lo
 * que una cámara de comercio le presenta a su junta: sin eso, la plataforma
 * organiza la rueda y no puede contestar para qué sirvió.
 *
 * ── Quién puede cerrarla ─────────────────────────────────────────────────
 *
 * Quien asistió (sobre su propia cita) y el equipo del evento (sobre
 * cualquiera). Las dos vías escriben lo mismo y por eso la limpieza vive aquí
 * y no en cada ruta: dos copias de estas reglas acabarían aceptando cosas
 * distintas, y el informe sumaría peras con manzanas.
 *
 * ── Lo que NO se limpia aquí ─────────────────────────────────────────────
 *
 * Quién lo registró y cuándo: eso lo pone la ruta, que es la que sabe quién
 * está autenticado.
 */

'use strict';

const RESULTADOS = ['realizada', 'no_asistio'];
const PLAZOS = ['inmediato', '3_meses', '6_meses', '12_meses'];

/* El tope es el mismo del CHECK de la 0110: si aquí pasara algo mayor, el
   guardado fallaría con el error crudo de Postgres en vez de con una frase. */
const MONTO_MAX = 999999999999;

/* Devuelve `{ campos }` con lo que hay que escribir, o `{ error }`.
 *
 * `body` es lo que llegó; sólo se miran las claves PRESENTES, para que cerrar
 * una reunión y editar la nota más tarde no se pisen: mandar sólo `notas` no
 * puede borrar la expectativa que se registró antes. */
function camposDeCierre(body = {}, { moneda = null } = {}) {
  const campos = {};

  if ('resultado' in body) {
    const v = body.resultado;
    /* `null` es un valor legítimo: es «me equivoqué, todavía no lo sé». */
    if (v === null || v === '') campos.resultado = null;
    else if (!RESULTADOS.includes(v)) {
      return { error: `Resultado inválido. Usa: ${RESULTADOS.join(', ')}.` };
    } else campos.resultado = v;
  }

  if ('expectativa_monto' in body) {
    const v = body.expectativa_monto;
    if (v === null || v === '') campos.expectativa_monto = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return { error: 'La expectativa de negocio tiene que ser un número positivo.' };
      }
      if (n > MONTO_MAX) {
        return { error: 'Esa cifra es demasiado grande. Revisa los ceros.' };
      }
      campos.expectativa_monto = n;
      /* La moneda se copia del evento AL ESCRIBIR. Si el evento cambia de
         moneda después, lo ya registrado no cambia de significado. */
      campos.expectativa_moneda = moneda || null;
    }
  }

  if ('expectativa_plazo' in body) {
    const v = body.expectativa_plazo;
    if (v === null || v === '') campos.expectativa_plazo = null;
    else if (!PLAZOS.includes(v)) {
      return { error: `Plazo inválido. Usa: ${PLAZOS.join(', ')}.` };
    } else campos.expectativa_plazo = v;
  }

  if ('hubo_acuerdo' in body) {
    const v = body.hubo_acuerdo;
    campos.hubo_acuerdo = v === null || v === '' ? null : Boolean(v);
  }

  if ('resultado_nota' in body) {
    const v = body.resultado_nota;
    campos.resultado_nota = typeof v === 'string' && v.trim() ? v.slice(0, 1000) : null;
  }

  return { campos };
}

/* ── El informe ────────────────────────────────────────────────────────
 *
 * Cuenta lo que hay y NO adivina lo que falta. «Sin registrar» es una columna
 * propia y no se reparte entre las otras dos: una rueda donde nadie cerró sus
 * reuniones tiene que verse como lo que es —sin datos—, y no como una rueda
 * con cero reuniones realizadas.
 *
 * El porcentaje de efectividad se calcula sobre lo REGISTRADO, y se dice sobre
 * cuántas. Calcularlo sobre el total convertiría «no lo sabemos» en «no
 * ocurrió», que es mentir en la dirección que más duele.
 */
function informeDeCitas(citas = []) {
  const base = {
    total: 0, canceladas: 0, agendadas: 0,
    realizadas: 0, no_asistio: 0, sin_registrar: 0,
    con_acuerdo: 0, con_expectativa: 0,
    expectativa_por_moneda: {},
    por_plazo: {},
  };

  for (const c of citas) {
    base.total++;
    if (c.estado === 'cancelada') { base.canceladas++; continue; }
    base.agendadas++;

    if (c.resultado === 'realizada') base.realizadas++;
    else if (c.resultado === 'no_asistio') base.no_asistio++;
    else base.sin_registrar++;

    if (c.hubo_acuerdo) base.con_acuerdo++;

    const monto = Number(c.expectativa_monto);
    if (Number.isFinite(monto) && monto > 0) {
      base.con_expectativa++;
      const m = c.expectativa_moneda || 'COP';
      base.expectativa_por_moneda[m] = (base.expectativa_por_moneda[m] || 0) + monto;
      const p = c.expectativa_plazo || 'sin_plazo';
      base.por_plazo[p] = (base.por_plazo[p] || 0) + monto;
    }
  }

  const registradas = base.realizadas + base.no_asistio;
  return {
    ...base,
    registradas,
    /* null y no 0: «no se puede calcular» no es «cero por ciento». */
    efectividad: registradas > 0 ? Math.round((base.realizadas / registradas) * 100) : null,
  };
}

module.exports = { RESULTADOS, PLAZOS, MONTO_MAX, camposDeCierre, informeDeCitas };
