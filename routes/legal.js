/* GESTEK — Términos y privacidad PROPIOS de cada evento.

   Son dos cosas distintas y por eso viven separadas:

   · Los de GESTEK cubren la plataforma. Están en /terminos y /privacidad y los
     firma GESTEK.
   · Los del evento cubren ese evento: qué datos recoge el organizador, para qué,
     cuánto los guarda y a quién reclamarle. Los firma el organizador.

   Mezclarlos en un solo documento deja al asistente sin saber a quién reclamar.
   El formulario de inscripción enlaza SIEMPRE a los del evento, y eso deja de ser
   opcional: un formulario que pide documento, teléfono y —con la ficha de
   caracterización— etnia, discapacidad o condición de víctima, no puede pedirlos
   sin decir bajo qué condiciones.

   Antes esto era un `terminos_url` opcional en page_json, apagado por defecto y
   que solo aceptaba una URL externa. Si el organizador no tenía web, no había
   nada que enlazar. Ahora puede ESCRIBIRLOS aquí y se sirven en la página pública
   del evento; si tiene los suyos en su web, la URL gana.

   Rutas:
   - GET /eventos/publicos/slug/:slug/legal   → público, sin sesión
   - GET /eventos/:eventoId/legal             → panel
   - PUT /eventos/:eventoId/legal             → panel
*/

const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const publico = express.Router();

/* Los términos y la política de privacidad tienen que poder leerse antes de
   comprar y sin cuenta: es lo que exige la ley que los pide. */
publico.use(require('../core/permisos').publica('Términos y privacidad: legalmente tienen que poder leerse sin cuenta.'));
const panel = express.Router();
panel.use(verifySupabaseJWT);

const COLS = `terminos_texto, privacidad_texto, terminos_url, privacidad_url,
  responsable, contacto_datos, updated_at`;

/* Un documento vale si hay texto escrito o una URL a la que apuntar. */
const hay = (texto, url) => Boolean((texto || '').trim() || (url || '').trim());

function faltaTabla(error) {
  return /evento_legal|does not exist/i.test(String(error?.message || ''));
}

/* ── Público ── */
publico.get('/slug/:slug/legal', async (req, res) => {
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, titulo, slug, estado, deleted_at, organizador:profiles!owner_id(nombre, empresa)')
    .eq('slug', req.params.slug).maybeSingle();

  if (!evento || evento.estado !== 'publicado' || evento.deleted_at) {
    return res.status(404).json({ error: 'Este evento no existe o no está publicado.' });
  }

  const { data, error } = await supabase
    .from('evento_legal').select(COLS).eq('evento_id', evento.id).maybeSingle();

  /* Sin documentos propios no se devuelve un 404: el enlace del formulario
     apunta aquí siempre, y esta página tiene que poder explicar que el
     organizador no publicó los suyos y que rigen los de GESTEK. */
  const legal = (error && faltaTabla(error)) ? null : data;

  res.json({
    evento: { titulo: evento.titulo, slug: evento.slug, organizador: evento.organizador },
    legal: legal || null,
    tiene_terminos: Boolean(legal && hay(legal.terminos_texto, legal.terminos_url)),
    tiene_privacidad: Boolean(legal && hay(legal.privacidad_texto, legal.privacidad_url)),
  });
});

/* ── Panel ── */
const PERMS = ['editar_evento', 'editar_pagina_publica'];

panel.get('/:eventoId/legal', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  try {
    await assertPermiso(req.params.eventoId, req.user.id, PERMS, 'id, owner_id');
    const { data, error } = await supabase
      .from('evento_legal').select(COLS).eq('evento_id', req.params.eventoId).maybeSingle();
    if (error && faltaTabla(error)) {
      return res.json({ legal: null, almacenamiento_listo: false });
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ legal: data || null, almacenamiento_listo: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

panel.put('/:eventoId/legal', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const texto = (v, max) => {
    const s = v == null ? null : String(v).trim();
    return s ? s.slice(0, max) : null;
  };
  /* Solo http(s). Un `javascript:` en un enlace legal que todo el mundo pulsa
     sería el mejor sitio posible para colar algo. */
  const url = (v) => {
    const s = texto(v, 500);
    return s && /^https?:\/\//i.test(s) ? s : null;
  };

  try {
    await assertPermiso(req.params.eventoId, req.user.id, PERMS, 'id, owner_id');

    if (req.body?.terminos_url && !url(req.body.terminos_url)) {
      return res.status(400).json({ error: 'El enlace de los términos debe empezar por http:// o https://' });
    }
    if (req.body?.privacidad_url && !url(req.body.privacidad_url)) {
      return res.status(400).json({ error: 'El enlace de la privacidad debe empezar por http:// o https://' });
    }

    const fila = {
      evento_id: req.params.eventoId,
      terminos_texto  : texto(req.body?.terminos_texto, 40000),
      privacidad_texto: texto(req.body?.privacidad_texto, 40000),
      terminos_url    : url(req.body?.terminos_url),
      privacidad_url  : url(req.body?.privacidad_url),
      responsable     : texto(req.body?.responsable, 200),
      contacto_datos  : texto(req.body?.contacto_datos, 200),
      updated_by      : req.user.id,
      updated_at      : new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('evento_legal').upsert(fila, { onConflict: 'evento_id' }).select(COLS).single();
    if (error) {
      return res.status(503).json({
        error: 'Falta aplicar la migración 0059 para guardar los términos del evento.',
        detalle: error.message,
      });
    }
    res.json({ legal: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = { publico, panel };
