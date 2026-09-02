/* GESTEK — Los dos buzones: «falta esto en la lista» y «falta esta dinámica».

   Son dos cosas distintas y por eso son dos tablas y dos rutas:

     · `sugerencias_catalogo` (0063) — la lista se quedó corta. Una línea, al
       lado del `<select>` que no tenía lo suyo. Sin mínimo de longitud: quien
       escribe «feria de adopción» ya dijo todo lo que hacía falta.
     · `sugerencias_dinamica` (0075) — pedir una mecánica que no existe. Ahí sí
       se exige explicar cómo funciona, porque sin eso no se puede construir.

   Confundirlas fue un fallo real: el buzón de catálogo llamaba a una ruta que
   nunca se escribió (`/me/sugerencias`) y devolvía 404 desde el 2026-08-12,
   en las dos pantallas donde está puesto. La tabla existía, el formulario
   existía, faltaba esto de en medio.

   ── Pedir una dinámica que la plataforma todavía no tiene ──

   La categoría de un espacio la fija la plataforma (charla, taller, competencia,
   stand…) y eso es deliberado: es lo que permite que un torneo active sus
   llaves y una charla pida ponente. Si fuera texto libre habría que adivinar el
   comportamiento comparando contra lo que cada quien escribiera.

   La consecuencia honesta es que quien monta un show de stand-up no encuentra
   su dinámica. Sin un sitio donde pedirla, la salida es elegir «Otro» y
   apañárselas — y nosotros no nos enteramos nunca de qué falta, que es la peor
   parte: el catálogo se queda congelado porque nadie sabe que se quedó corto.

   Lo que se pide en la solicitud es `como_funciona`, y es lo único que de
   verdad importa. Saber que alguien quiere «stand-up» no permite construir
   nada; saber que necesita turnos, inscripción de comediantes y votación del
   público, sí. Preguntarlo aquí ahorra la conversación de vuelta. */

const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();

const LIMITES = { titulo: 120, como_funciona: 4000, alternativa: 500 };

function validar(body) {
  const titulo = String(body?.titulo || '').trim();
  const como = String(body?.como_funciona || '').trim();

  if (titulo.length < 3) return { error: 'Ponle un nombre a la dinámica.' };
  if (titulo.length > LIMITES.titulo) return { error: `El nombre no puede pasar de ${LIMITES.titulo} caracteres.` };

  /* El mínimo no es capricho. Una solicitud que dice «stand-up comedy» y nada
     más obliga a escribir de vuelta para preguntar lo básico, y ahí se muere la
     mitad de las solicitudes. */
  if (como.length < 40) {
    return { error: 'Cuéntanos cómo funciona: si hay inscritos, si hay turnos o rondas, si el público vota, qué se ve en la agenda. Con eso podemos construirla; sólo con el nombre, no.' };
  }
  if (como.length > LIMITES.como_funciona) return { error: 'La descripción es demasiado larga.' };

  return {
    ok: true,
    fila: {
      titulo,
      como_funciona: como,
      alternativa: String(body?.alternativa || '').trim().slice(0, LIMITES.alternativa) || null,
    },
  };
}

/* POST /sugerencias/dinamica */
router.post('/sugerencias/dinamica', verifySupabaseJWT, sesion("Cuelga del usuario: la consulta filtra por su propio id y no admite mirar la de otro."), async (req, res) => {
  const v = validar(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  /* El evento se guarda sólo si es de quien escribe: sirve de contexto para
     entender la solicitud, no para dar acceso a nada. */
  let eventoId = null;
  if (req.body?.evento_id) {
    const { data } = await supabase
      .from('eventos').select('id').eq('id', req.body.evento_id).eq('owner_id', req.user.id).maybeSingle();
    eventoId = data?.id || null;
  }

  const { data, error } = await supabase
    .from('sugerencias_dinamica')
    .insert({ ...v.fila, owner_id: req.user.id, evento_id: eventoId })
    .select('id, titulo, estado, created_at')
    .single();

  if (error) {
    if (/sugerencias_dinamica|does not exist/i.test(error.message)) {
      return res.status(503).json({ error: 'Falta aplicar la migración 0075.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ ok: true, sugerencia: data });
});

/* GET /sugerencias/dinamica — las propias, con la respuesta del equipo si la
   hubo. Que quien pidió algo pueda ver en qué quedó es lo que hace que vuelva
   a pedir; un buzón sin respuesta se usa una vez. */
router.get('/sugerencias/dinamica', verifySupabaseJWT, sesion("Cuelga del usuario: la consulta filtra por su propio id y no admite mirar la de otro."), async (req, res) => {
  const { data, error } = await supabase
    .from('sugerencias_dinamica')
    .select('id, titulo, como_funciona, estado, respuesta, created_at, evento_id')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    if (/sugerencias_dinamica|does not exist/i.test(error.message)) return res.json({ sugerencias: [] });
    return res.status(500).json({ error: error.message });
  }
  res.json({ sugerencias: data || [] });
});

/* ── El otro buzón: la lista se quedó corta ────────────────────────────────
 *
 * Monta sobre `sugerencias_catalogo` (0063). A diferencia del de dinámicas,
 * aquí NO hay mínimo de longitud a propósito: se pregunta al lado del
 * desplegable, en el segundo en que alguien no encuentra lo suyo, y exigirle
 * un párrafo ahí es la forma segura de no recibir ninguna respuesta.
 *
 * `catalogo` se valida contra la misma lista que el CHECK de la tabla, para
 * devolver un 400 legible en vez de un error de Postgres.
 */
const CATALOGOS = ['evento', 'vacante'];
const MAX_TEXTO = 400;          // igual que el `maxLength` del formulario
const MAX_CONTEXTO = 2000;      // serializado; es contexto, no un adjunto

/* Aparte del handler para poder probarla: es la única parte con reglas. */
function validarCatalogo(body) {
  const catalogo = String(body?.catalogo || '').trim();
  const texto = String(body?.texto || '').trim();

  if (!CATALOGOS.includes(catalogo)) return { error: 'No sé de qué lista hablas.' };
  if (!texto) return { error: 'Escribe qué te faltaba.' };
  if (texto.length > MAX_TEXTO) return { error: `No puede pasar de ${MAX_TEXTO} caracteres.` };

  /* El contexto llega libre desde el formulario y se guarda tal cual, pero
     acotado: sirve para entender la sugerencia meses después, no para meter
     un objeto de cualquier tamaño en la fila. Un array no es contexto. */
  let contexto = {};
  const bruto = body?.contexto;
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
    contexto = JSON.stringify(bruto).length <= MAX_CONTEXTO ? bruto : {};
  }

  return { ok: true, fila: { catalogo, texto, contexto } };
}

/* POST /me/sugerencias — y también /sugerencias, porque este router se monta
   en los dos sitios (index.js). Las dos piden sesión. */
router.post('/sugerencias', verifySupabaseJWT, sesion('Cuelga del usuario: se guarda a su nombre y sólo él la vuelve a leer.'), async (req, res) => {
  const v = validarCatalogo(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const { data, error } = await supabase
    .from('sugerencias_catalogo')
    .insert({ ...v.fila, user_id: req.user.id })
    .select('id, catalogo, estado, created_at')
    .single();

  if (error) {
    if (/sugerencias_catalogo|does not exist/i.test(error.message)) {
      return res.status(503).json({ error: 'Falta aplicar la migración 0063.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ ok: true, sugerencia: data });
});

/* GET /me/sugerencias — las propias. */
router.get('/sugerencias', verifySupabaseJWT, sesion('Cuelga del usuario: la consulta filtra por su propio id y no admite mirar la de otro.'), async (req, res) => {
  const { data, error } = await supabase
    .from('sugerencias_catalogo')
    .select('id, catalogo, texto, contexto, estado, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    if (/sugerencias_catalogo|does not exist/i.test(error.message)) return res.json({ sugerencias: [] });
    return res.status(500).json({ error: error.message });
  }
  res.json({ sugerencias: data || [] });
});

module.exports = router;
module.exports._test = { validar, validarCatalogo, CATALOGOS, MAX_TEXTO };
