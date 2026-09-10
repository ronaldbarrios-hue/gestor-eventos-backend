'use strict';

/* ¿Esta persona ya sacó esta misma boleta gratuita?
 *
 * ── De dónde sale ────────────────────────────────────────────────────────
 *
 * De medir un evento real. En FESTECH IBAGUÉ, 22 correos tenían más de una
 * boleta y sumaban 48 repeticiones. Al separarlas:
 *
 *   45  repiten la MISMA actividad     ← esto es lo que no debería pasar
 *    3  son de otra actividad          ← correcto: el registro general y un taller
 *
 * Y de esas 45, la mitad exacta ocurrió a menos de dos minutos de la anterior:
 * 22 el mismo día, con separaciones de 1 a 59 segundos. Ese día el servidor
 * insertaba la boleta y DESPUÉS reventaba con un 500, así que la persona veía
 * un error y volvía a darle a Enviar. El fallo está corregido, pero el hueco
 * que lo dejó doler sigue abierto: nada impide que el mismo correo saque dos
 * veces la misma boleta gratuita, y cualquier otro error —una conexión que se
 * cae al confirmar, un doble toque en el móvil— produce lo mismo.
 *
 * ── Por qué el nombre también tiene que coincidir ────────────────────────
 *
 * Porque un correo NO es una persona. En esos mismos datos, 12 de las 45
 * repeticiones traían un nombre distinto: alguien inscribiendo a su equipo o a
 * su familia con su propio correo, que es legítimo y frecuente. Cortar por
 * correo a secas le habría dicho «ya estás registrado» a quien iba por la
 * segunda persona.
 *
 * Con el nombre dentro, la regla habría atrapado 33 de 45 y no habría estorbado
 * a ninguna de las 12. Se prefiere quedarse corto: dejar pasar un duplicado se
 * arregla borrándolo; impedir un registro legítimo no se entera nadie hasta que
 * esa persona no aparece en la lista.
 *
 * ── Sólo gratis ──────────────────────────────────────────────────────────
 *
 * Comprar dos entradas iguales para ir con alguien es normal y no se toca. Esto
 * es el registro sin dinero de por medio, donde una segunda boleta idéntica no
 * significa nada salvo que algo salió mal.
 */

/* Una boleta anulada no bloquea: si a alguien le invalidaron la suya, tiene que
   poder volver a registrarse. `usado` sí bloquea — ya entró. */
const NO_CUENTAN = ['invalido', 'reembolsado', 'cancelado'];

const normal = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');

/* Devuelve la boleta que ya tenía, o `null`.
 *
 * Nunca lanza: esto corre en mitad de un registro, y un fallo consultando no
 * puede ser el motivo de que alguien no se pueda inscribir. Si no se sabe, se
 * deja pasar — que es como estaba antes de esta función. */
async function boletaQueYaTenia({ eventoId, tipoId, email, nombre }) {
  const correo = normal(email);
  const quien = normal(nombre);
  /* Sin correo no hay a quién reconocer, y sin nombre no se puede distinguir a
     dos personas del mismo correo: en los dos casos se deja pasar. */
  if (!eventoId || !tipoId || !correo || !quien) return null;

  const supabase = require('./supabase.js');
  const { data, error } = await supabase
    .from('tickets')
    .select('id, codigo, estado, guest_nombre, guest_email, created_at')
    .eq('evento_id', eventoId)
    .eq('ticket_type_id', tipoId)
    .eq('guest_email', correo)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    console.error(`[registro] no se pudo mirar si ya estaba: ${error.message}`);
    return null;
  }

  /* El nombre se compara aquí y no en la consulta: en la base está tal como lo
     escribió la persona —con mayúsculas y espacios de más— y una igualdad
     exacta contra eso deja fuera a «  Ana  Pérez» frente a «Ana Pérez», que es
     la misma persona escribiendo dos veces. */
  return (data || []).find(t =>
    normal(t.guest_nombre) === quien && !NO_CUENTAN.includes(t.estado)) || null;
}

module.exports = { boletaQueYaTenia, NO_CUENTAN, normal };
