/* GESTEK — Auditoría (lectura).
   GET /eventos/:eventoId/auditoria  — solo el owner del evento.
   Se monta en /eventos.

   Antes esto estaba detrás del plan Pro, y no devolvía 402: devolvía una lista
   vacía con requierePro:true, así que la auditoría se veía como un evento sin
   actividad en vez de como una función bloqueada. */
const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { tramoPedido, datosDelTramo, paraBuscar } = require('../lib/tramoDeLista.js');
const router = express.Router();
router.use(verifySupabaseJWT);

router.get('/:eventoId/auditoria', sesion("El registro de quién tocó qué lo ve sólo el dueño del evento."), async (req, res) => {
  const { eventoId } = req.params;
  /* Se servian las ultimas 100 y no se decia. En un evento con equipo, cien
     apuntes son un dia — o sea que «quien toco que» contestaba sobre hoy y
     parecia contestar sobre el evento. Y esa es justo la pregunta que se hace
     cuando algo salio mal la semana pasada.

     Con filtro por accion y por quien: buscar a mano entre cien es viable,
     entre mil no, y el registro crece toda la vida del evento. */
  const tramo = tramoPedido(req.query);
  const { accion, q } = req.query;

  /* Owner check */
  const { data: ev, error: e1 } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (ev.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  let query = supabase
    .from('audit_log')
    .select(`id, accion, entidad, entidad_id, detalle, actor_email, created_at,
             actor:profiles!actor_id(id, nombre, avatar_url)`, { count: 'exact' })
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false })
    .range(tramo.desde, tramo.hasta);

  /* Por accion exacta y no por parecido: las acciones son un vocabulario
     cerrado —`evento.formulario.editar`, `aforo.limpiar`— y un `ilike` sobre
     ellas devolveria «boleta.borrar» buscando «borrar» en cualquier sitio del
     texto, incluido el correo de quien lo hizo. */
  if (accion) query = query.eq('accion', accion);
  /* Y por quien: el correo del actor queda en la fila incluso si esa cuenta ya
     no esta en el equipo, que es cuando de verdad se busca. */
  if (q) {
    const t = paraBuscar(q);
    if (t) query = query.ilike('actor_email', `%${t}%`);
  }

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  /* Que acciones EXISTEN en este evento, para poder ofrecer el filtro sin que
     nadie mantenga a mano una lista de acciones posibles — que es como se
     acaba ofreciendo una que ya nadie escribe y faltando la nueva.
     Se lee sobre el maximo de una pagina grande: si el evento tiene mas
     apuntes que eso, las acciones que faltan son las mas raras, y el filtro
     sigue sirviendo para las que se usan. */
  const { data: vistas } = await supabase
    .from('audit_log').select('accion').eq('evento_id', eventoId).limit(1000);
  const acciones = [...new Set((vistas || []).map(v => v.accion).filter(Boolean))].sort();

  res.json({ auditoria: data || [], acciones, ...datosDelTramo(tramo, count) });
});

module.exports = router;
