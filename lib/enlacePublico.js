/* De qué dominio salen los enlaces que le llegan al asistente.
 *
 * Los correos y las confirmaciones armaban la URL con `FRONTEND_URL`, que es
 * el dominio de la plataforma. Un organizador con marca blanca personalizaba
 * logo, colores y hasta el nombre… y el enlace de la boleta seguía diciendo
 * el nuestro, que es justo lo único que la persona guarda y reenvía.
 *
 * Si el evento tiene `page_json.branding.dominio`, se usa ese. Es fachada, no
 * alojamiento: ese dominio tiene que apuntar a la app o el enlace no abre. Por
 * eso, vacío o mal escrito, se cae al de siempre sin avisar a nadie: un correo
 * con un enlace roto es peor que un correo con el enlace de la plataforma.
 */
const supabase = require('./supabase.js');
const { baseFrontend } = require('./frontend.js');

function baseDeFabrica() {
  return baseFrontend();
}

function normalizarDominio(valor) {
  const s = String(valor || '').trim();
  if (!s) return null;
  const con = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(con);
    if (!u.hostname.includes('.')) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

/* Acepta el id del evento o la fila (si ya trae page_json, no consulta nada). */
async function baseDelEvento(evento) {
  try {
    let pageJson = evento && typeof evento === 'object' ? evento.page_json : null;
    const id = typeof evento === 'string' ? evento : evento?.id;
    if (!pageJson && id) {
      const { data } = await supabase.from('eventos').select('page_json').eq('id', id).maybeSingle();
      pageJson = data?.page_json;
    }
    return normalizarDominio(pageJson?.branding?.dominio) || baseDeFabrica();
  } catch {
    return baseDeFabrica();
  }
}

async function enlaceBoleta(evento, codigo) {
  return `${await baseDelEvento(evento)}/mi-ticket/${codigo}`;
}

module.exports = { baseDeFabrica, normalizarDominio, baseDelEvento, enlaceBoleta };
