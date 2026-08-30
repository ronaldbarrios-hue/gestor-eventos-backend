/* GESTEK — Pedir una dinámica que la plataforma todavía no tiene.

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

module.exports = router;
