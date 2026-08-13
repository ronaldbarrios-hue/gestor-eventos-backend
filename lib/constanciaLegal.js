/* GESTEK — Constancia de aceptación de los términos DEL EVENTO.

   Enlazar los términos no basta cuando el formulario pide documento, teléfono
   y —con la ficha de caracterización— etnia, discapacidad o condición de
   víctima. Si alguien reclama, hay que poder decir QUÉ aceptó y CUÁNDO.

   No se guarda una copia del texto por inscripción: con 7.000 asistentes
   serían 7.000 copias del mismo documento. Se guarda la huella
   (`evento_legal.version`, un md5 que mantiene un trigger de la 0069) más la
   fecha. Si el organizador edita sus términos, la huella cambia y las
   aceptaciones viejas siguen señalando la versión que de verdad se aceptó. */

const supabase = require('./supabase.js');

const faltaColumna = (e) => /column .* does not exist|does not exist/i.test(String(e?.message || ''));
const hay = (texto, url) => Boolean((texto || '').trim() || (url || '').trim());

/* Lee el documento vigente del evento.
   Devuelve { exige, version }:
     · `exige`  — el organizador publicó términos propios, así que la casilla
                  del formulario es obligatoria en el navegador.
     · `version`— la huella a guardar, o null si la 0069 no está aplicada.

   Tolera las dos migraciones que pueden faltar: la 0059 (no existe la tabla)
   y la 0069 (no existe la columna). En los dos casos se sigue adelante sin
   constancia en vez de romper una venta. */
async function estadoLegal(eventoId) {
  if (!eventoId) return { exige: false, version: null };

  let { data, error } = await supabase
    .from('evento_legal')
    .select('terminos_texto, terminos_url, version')
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (error && faltaColumna(error)) {
    /* Sin la 0069 todavía: se puede saber si exige, no qué versión. */
    const reintento = await supabase
      .from('evento_legal')
      .select('terminos_texto, terminos_url')
      .eq('evento_id', eventoId)
      .maybeSingle();
    if (reintento.error) return { exige: false, version: null };
    data = reintento.data ? { ...reintento.data, version: null } : null;
    error = null;
  }

  if (error || !data) return { exige: false, version: null };
  return {
    exige: hay(data.terminos_texto, data.terminos_url),
    version: data.version || null,
  };
}

/* Las columnas que hay que añadir a la fila de una inscripción.
   Devuelve {} cuando no hay nada que registrar, para poder hacer
   `{ ...fila, ...await constancia(...) }` sin condicionales en el llamador.

   OJO — no rechaza la inscripción cuando el evento exige términos y no llegó
   la aceptación, y es a propósito: el frontend de este proyecto se despliega
   a mano y va por detrás del backend. Rechazar aquí dejaría sin vender a todo
   evento con documentos propios en cuanto suba el backend, que es exactamente
   el incidente de las 31 páginas públicas en blanco. La casilla la exige el
   navegador; el servidor registra lo que llega. Cuando el frontend esté
   confirmado arriba, se puede endurecer aquí en una línea. */
async function constancia(eventoId, aceptado) {
  if (!aceptado) return {};
  const { version } = await estadoLegal(eventoId);
  return {
    legal_aceptado_at: new Date().toISOString(),
    legal_version: version,
  };
}

/* Anota la constancia DESPUÉS de crear la fila, nunca dentro del insert.
   Es deliberado: mientras la 0069 no esté aplicada, un insert que mencione
   `legal_aceptado_at` falla ENTERO y se cae la venta. Un update aparte que
   falle sólo pierde la constancia, y eso se puede rehacer; una boleta que no
   se emite, no.

   Por eso tampoco se espera el resultado en el llamador: es mejor esfuerzo. */
async function anotarConstancia(tabla, filaId, eventoId, aceptado) {
  if (!aceptado || !filaId) return;
  try {
    const campos = await constancia(eventoId, aceptado);
    if (!Object.keys(campos).length) return;
    const { error } = await supabase.from(tabla).update(campos).eq('id', filaId);
    if (error) {
      console.warn('[legal] no se pudo anotar la constancia (¿falta la 0069?):', error.message);
    }
  } catch (e) {
    console.warn('[legal] no se pudo anotar la constancia:', e.message);
  }
}

module.exports = { estadoLegal, constancia, anotarConstancia };
