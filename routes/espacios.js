'use strict';

/* El plano del evento: crear, generar y asignar los sitios que se venden.
 *
 * ── Qué resuelve ─────────────────────────────────────────────────────────
 *
 * Vender un sitio CONCRETO —la silla C-14, la mesa 3 de ringside, el palco
 * norte— en vez de «una entrada». Migración 0117; diseño completo en la nota 22
 * de la bóveda.
 *
 * Estas rutas son la mitad del organizador: montar el plano y decir qué
 * localidad es cada cosa. La mitad de quien compra —ver el mapa, retener,
 * soltar— vive en `eventos.publicos.js`, porque quien compra no tiene cuenta.
 */

const express = require('express');
const { exige } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');
const {
  COLUMNAS, validarEspacio, filaEspacio, generarUnidades,
  armarArbol, MAX_POR_LOTE,
} = require('../lib/espacios.js');
const geometria = require('../lib/geometriaDelPlano.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* El mismo permiso que los tipos de boleta: quien decide precios y cupos es
   quien decide el plano. Inventar un permiso nuevo aquí obligaría a repartirlo
   otra vez en todos los roles que ya existen, y a que alguien se enterara. */
const PERMS = ['gestionar_tickets'];
const puedo = (eventoId, userId) => assertPermiso(eventoId, userId, PERMS, 'id, owner_id');

const fallo = (res, e) =>
  res.status(e.message === 'No autorizado.' ? 403 : e.message === 'Evento no encontrado.' ? 404 : 400)
     .json({ error: e.message });

/* ── GET /eventos/:eventoId/espacios — el plano entero ──────────────────
 *
 * Todo el árbol de una lectura, y las reservas vivas aparte. El panel necesita
 * las dos cosas juntas: un plano donde no se ve qué está vendido no sirve para
 * decidir nada.
 *
 * Aquí SÍ viaja quién compró —es el organizador quien mira—, al revés que en el
 * mapa público, que sale agregado.
 */
router.get('/:eventoId/espacios', exige(PERMS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const { data: espacios, error } = await supabase
      .from('espacios').select(COLUMNAS)
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    /* Los errores se miran. Un `|| []` sobre una consulta fallida enseña el
       plano entero libre —porque «no hay reservas»— y el organizador lo cree.
       Es el modo de fallo de esta base: falta algo y no hay error. */
    const { data: reservas, error: eRes } = await supabase
      .from('espacio_reservas')
      .select('espacio_id, estado, expira_at, ticket_id')
      .eq('evento_id', eventoId)
      .in('estado', ['retenido', 'vendido']);
    if (eRes) return res.status(500).json({ error: eRes.message });

    /* Las localidades de ESTE evento.
     *
     * Antes esta consulta no llevaba filtro: se traía `ticket_type_espacios`
     * entera —la de todos los eventos de la plataforma— y se descartaba en
     * JavaScript lo que no era de aquí. Funcionaba porque la tabla es joven, y
     * habría ido creciendo hasta que abrir el plano de un evento pequeño
     * costara traerse el de todos los demás.
     *
     * `ticket_type_espacios` no tiene `evento_id` —cuelga del tipo de boleta,
     * que sí lo tiene—, así que el filtro son los tipos del evento: una lista
     * corta, no una por cada silla. */
    const { data: tipos, error: eTipos } = await supabase
      .from('ticket_types').select('id, nombre, precio, currency').eq('evento_id', eventoId);
    if (eTipos) return res.status(500).json({ error: eTipos.message });

    /* El color, aparte. Es de la 0119, y pedirlo junto a lo demás haría que en
       un despliegue sin la migración el select fallara ENTERO y el plano se
       quedara sin precios. Sin color, la paleta reparte por posición. */
    let colorDe = new Map();
    try {
      const { data: c } = await supabase.from('ticket_types').select('id, color').eq('evento_id', eventoId);
      colorDe = new Map((c || []).map(x => [x.id, geometria.colorValido(x.color)]));
    } catch { /* sin la 0119 */ }

    const porPrecio = [...(tipos || [])].sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
    const conColor = new Map(porPrecio.map((t, i) => [t.id, {
      ...t, color: colorDe.get(t.id) || geometria.colorPorDefecto(i),
    }]));

    const { data: localidades, error: eLoc } = await supabase
      .from('ticket_type_espacios')
      .select('ticket_type_id, espacio_id')
      .in('ticket_type_id', [...conColor.keys()]);
    if (eLoc) return res.status(500).json({ error: eLoc.message });

    const deEsteEvento = new Set((espacios || []).map(e => e.id));

    res.json({
      espacios: espacios || [],
      arbol: armarArbol(espacios || []),
      reservas: reservas || [],
      localidades: (localidades || [])
        .filter(l => deEsteEvento.has(l.espacio_id))
        .map(l => ({ ...l, ticket: conColor.get(l.ticket_type_id) || null })),
      /* La leyenda del plano: las localidades con su color, de más cara a más
         barata. Va aparte de `localidades` —que dice qué silla es de cuál—
         porque el mapa necesita las dos cosas y unirlas obligaría a recorrer
         dos mil sillas para saber que hay tres colores. */
      leyenda: porPrecio.map(t => conColor.get(t.id)),
      max_por_lote: MAX_POR_LOTE,
    });
  } catch (e) { fallo(res, e); }
});

/* ── POST /eventos/:eventoId/espacios — uno a mano ──────────────────────
 *
 * Para el pabellón, la sección, la gradería. Las unidades vendibles se hacen
 * con el generador de abajo: nadie crea 240 sillas de una en una.
 */
router.post('/:eventoId/espacios', exige(PERMS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const malo = validarEspacio(req.body);
    if (malo) return res.status(400).json({ error: malo });

    /* Un padre de otro evento colgaría el plano de este debajo del de otro, y
       no fallaría nada: la clave foránea sólo mira que el id exista. */
    if (req.body.parent_id) {
      const { data: padre } = await supabase
        .from('espacios').select('evento_id').eq('id', req.body.parent_id).maybeSingle();
      if (!padre) return res.status(400).json({ error: 'Ese espacio padre no existe.' });
      if (padre.evento_id !== eventoId) {
        return res.status(400).json({ error: 'Ese espacio padre es de otro evento.' });
      }
    }

    const { data, error } = await supabase
      .from('espacios').insert(filaEspacio(req.body, eventoId)).select(COLUMNAS).single();
    if (error) return res.status(500).json({ error: error.message });

    auditar(req, eventoId, 'espacio.crear', { entidad: 'espacio', entidadId: data.id, detalle: { nombre: data.nombre } });
    res.status(201).json({ espacio: data });
  } catch (e) { fallo(res, e); }
});

/* ── POST /eventos/:eventoId/espacios/generar — la sección entera ───────
 *
 * «Sección Norte: 12 filas de 20» y salen 240 sillas con su nombre. Es el único
 * camino razonable: a mano son 240 formularios.
 */
router.post('/:eventoId/espacios/generar', exige(PERMS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const { parent_id } = req.body;
    if (!parent_id) return res.status(400).json({ error: 'Dime dentro de qué espacio se generan.' });

    const { data: padre } = await supabase
      .from('espacios').select('id, evento_id, nombre').eq('id', parent_id).maybeSingle();
    if (!padre) return res.status(400).json({ error: 'Ese espacio no existe.' });
    if (padre.evento_id !== eventoId) return res.status(400).json({ error: 'Ese espacio es de otro evento.' });

    const { unidades, error: malo } = generarUnidades(req.body);
    if (malo) return res.status(400).json({ error: malo });

    const filas = unidades.map(u => ({ ...filaEspacio(u, eventoId), parent_id }));
    const { data, error } = await supabase.from('espacios').insert(filas).select('id');
    if (error) return res.status(500).json({ error: error.message });

    auditar(req, eventoId, 'espacio.generar', {
      entidad: 'espacio', entidadId: parent_id,
      detalle: { dentro_de: padre.nombre, cuantas: filas.length },
    });
    res.status(201).json({ creados: data?.length || 0 });
  } catch (e) { fallo(res, e); }
});

/* ── PATCH /eventos/:eventoId/espacios/:id ─────────────────────────────── */
router.patch('/:eventoId/espacios/:id', exige(PERMS), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const { data: actual } = await supabase
      .from('espacios').select('id, evento_id, modo').eq('id', id).maybeSingle();
    if (!actual || actual.evento_id !== eventoId) {
      return res.status(404).json({ error: 'Ese espacio no es de este evento.' });
    }

    const malo = validarEspacio({ ...actual, ...req.body });
    if (malo) return res.status(400).json({ error: malo });

    /* Dejar de vender algo que ya se vendió deja boletas apuntando a un espacio
       que ya no se vende, y el día del evento nadie sabe dónde sentar a esa
       persona. Se avisa en vez de dejarlo pasar. */
    if (actual.modo === 'vendible' && req.body.modo && req.body.modo !== 'vendible') {
      const { count } = await supabase
        .from('espacio_reservas').select('id', { count: 'exact', head: true })
        .eq('espacio_id', id).eq('estado', 'vendido');
      if (count) {
        return res.status(409).json({
          error: `«${req.body.nombre || actual.nombre}» ya está vendido. Anula esa venta antes de cambiarle el modo.`,
        });
      }
    }

    const { data, error } = await supabase
      .from('espacios').update(filaEspacio({ ...actual, ...req.body }, eventoId))
      .eq('id', id).select(COLUMNAS).single();
    if (error) return res.status(500).json({ error: error.message });

    auditar(req, eventoId, 'espacio.editar', { entidad: 'espacio', entidadId: id });
    res.json({ espacio: data });
  } catch (e) { fallo(res, e); }
});

/* ── PUT /eventos/:eventoId/espacios/geometria — mover muchos de una vez ──
 *
 * Arrastrar una sección son doscientas sillas que cambian de sitio a la vez. Con
 * el PATCH de arriba eso serían doscientas peticiones por cada empujón del
 * ratón: el editor iría a tirones y el servidor se llevaría una tormenta.
 *
 * Sólo toca `geometria`. Es lo que hace que esta ruta sea segura de usar desde
 * un editor que dispara sin parar: no puede cambiar precios, ni modos, ni
 * nombres, ni convertir una silla vendida en otra cosa. Mover de sitio una
 * silla vendida SÍ se permite —el plano se corrige, la venta no se toca— y es
 * justo lo que hace falta cuando el recinto se dibujó torcido.
 */
router.put('/:eventoId/espacios/geometria', exige(PERMS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const cambios = Array.isArray(req.body?.cambios) ? req.body.cambios : null;
    if (!cambios?.length) return res.status(400).json({ error: 'No hay nada que mover.' });
    if (cambios.length > MAX_POR_LOTE) {
      return res.status(400).json({ error: `Son ${cambios.length} de una vez y el máximo es ${MAX_POR_LOTE}.` });
    }

    /* Que todos los ids sean de ESTE evento, comprobado contra la base y no
       contra lo que dice quien llama. Sin esto, un id de otro evento en la
       lista movería el plano de otra empresa. */
    const ids = [...new Set(cambios.map(c => c.id).filter(Boolean))];
    const { data: mios, error: eMios } = await supabase
      .from('espacios').select('id').eq('evento_id', eventoId).in('id', ids);
    if (eMios) return res.status(500).json({ error: eMios.message });
    const permitido = new Set((mios || []).map(e => e.id));
    if (permitido.size !== ids.length) {
      return res.status(400).json({ error: 'Alguno de esos espacios no es de este evento.' });
    }

    let movidos = 0;
    for (const c of cambios) {
      const forma = geometria.formaDe(c.geometria);
      /* Una geometría que no se reconoce se salta en vez de guardarse: dejar
         entrar `{}` borraría la posición de la silla y el plano se rompería
         justo donde alguien creía estar arreglándolo. */
      if (!forma) continue;
      const { error } = await supabase.from('espacios')
        .update({ geometria: c.geometria }).eq('id', c.id).eq('evento_id', eventoId);
      if (error) return res.status(500).json({ error: error.message });
      movidos += 1;
    }

    /* Una sola anotación por lote, con el número. Doscientas líneas de auditoría
       por arrastre harían ilegible el histórico del evento. */
    auditar(req, eventoId, 'espacio.mover', { entidad: 'espacio', detalle: { movidos } });
    res.json({ movidos });
  } catch (e) { fallo(res, e); }
});

/* ── PUT /eventos/:eventoId/localidades/:tipoId/color ───────────────────
 *
 * El color de una localidad. Va aquí, junto al plano, porque es una decisión
 * del plano: en el mapa de un concierto el color ES el precio.
 */
router.put('/:eventoId/localidades/:tipoId/color', exige(PERMS), async (req, res) => {
  const { eventoId, tipoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    /* `null` es válido y quiere decir «vuelve al color de la paleta». Sin esa
       opción, elegir un color sería irreversible. */
    const color = req.body?.color == null || req.body.color === ''
      ? null
      : geometria.colorValido(req.body.color);
    if (req.body?.color && !color) {
      return res.status(400).json({ error: 'El color tiene que ser un código como #dc2626.' });
    }

    const { data, error } = await supabase.from('ticket_types')
      .update({ color }).eq('id', tipoId).eq('evento_id', eventoId).select('id, color').maybeSingle();
    if (error) {
      /* Sin la 0119 aplicada la columna no existe. Se dice qué pasa en vez de
         devolver un error de base que nadie sabe leer. */
      return res.status(500).json({ error: 'No se pudo guardar el color. ¿Está aplicada la migración 0119?' });
    }
    if (!data) return res.status(404).json({ error: 'Esa localidad no es de este evento.' });

    auditar(req, eventoId, 'localidad.color', { entidad: 'ticket_type', entidadId: tipoId, detalle: { color } });
    res.json({ id: data.id, color: data.color });
  } catch (e) { fallo(res, e); }
});

/* ── DELETE /eventos/:eventoId/espacios/:id ────────────────────────────── */
router.delete('/:eventoId/espacios/:id', exige(PERMS), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const { data: actual } = await supabase
      .from('espacios').select('id, evento_id, nombre').eq('id', id).maybeSingle();
    if (!actual || actual.evento_id !== eventoId) {
      return res.status(404).json({ error: 'Ese espacio no es de este evento.' });
    }

    /* Borrar arrastra a los hijos —`on delete cascade`— así que hay que contar
       lo vendido en TODO el subárbol, no sólo en este nodo. Borrar una sección
       con 240 sillas vendidas por no mirar hacia abajo es irreversible. */
    const { data: todos, error: eArbol } = await supabase
      .from('espacios').select('id, parent_id').eq('evento_id', eventoId);
    /* Si esto falla, `descendientes` devolvería sólo este nodo y el conteo de
       vendidos daría cero: se borraría una sección con 240 sillas vendidas
       porque una consulta falló en silencio. */
    if (eArbol) return res.status(500).json({ error: eArbol.message });
    const bajo = descendientes(todos, id);

    const { count, error: eCuenta } = await supabase
      .from('espacio_reservas').select('id', { count: 'exact', head: true })
      .in('espacio_id', bajo).eq('estado', 'vendido');
    if (eCuenta) return res.status(500).json({ error: eCuenta.message });
    if (count) {
      return res.status(409).json({
        error: `No se puede borrar «${actual.nombre}»: hay ${count} ${count === 1 ? 'sitio vendido' : 'sitios vendidos'} dentro.`,
      });
    }

    const { error } = await supabase.from('espacios').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    auditar(req, eventoId, 'espacio.borrar', {
      entidad: 'espacio', entidadId: id,
      detalle: { nombre: actual.nombre, con_hijos: bajo.length - 1 },
    });
    res.json({ ok: true, borrados: bajo.length });
  } catch (e) { fallo(res, e); }
});

/* El subárbol, incluido él mismo. En memoria y no con una consulta recursiva:
   son decenas o cientos de filas, ya están leídas, y evita un `WITH RECURSIVE`
   que PostgREST no sabe hacer. */
function descendientes(todos, raizId) {
  const hijosDe = new Map();
  for (const e of todos) {
    if (!hijosDe.has(e.parent_id)) hijosDe.set(e.parent_id, []);
    hijosDe.get(e.parent_id).push(e.id);
  }
  const out = [];
  const pila = [raizId];
  /* Un tope por si alguna vez hay un ciclo: mejor un plano incompleto que un
     servidor colgado. */
  while (pila.length && out.length < 10000) {
    const id = pila.pop();
    if (out.includes(id)) continue;
    out.push(id);
    for (const h of hijosDe.get(id) || []) pila.push(h);
  }
  return out;
}

/* ── PUT /eventos/:eventoId/espacios/:id/localidad ──────────────────────
 *
 * Qué tipo de boleta abre este espacio, o sea cuánto cuesta.
 *
 * El precio vive en la LOCALIDAD y no en la silla: «Platea» es un tipo de
 * boleta asociado a la sección, y sus sillas heredan el precio. Subir un 10 %
 * es tocar un tipo de boleta, no dos mil filas.
 */
router.put('/:eventoId/espacios/:id/localidad', exige(PERMS), async (req, res) => {
  const { eventoId, id } = req.params;
  const { ticket_type_id } = req.body;
  try {
    await puedo(eventoId, req.user.id);

    const { data: esp } = await supabase
      .from('espacios').select('id, evento_id').eq('id', id).maybeSingle();
    if (!esp || esp.evento_id !== eventoId) {
      return res.status(404).json({ error: 'Ese espacio no es de este evento.' });
    }

    /* Sin tipo = quitar la localidad. El espacio deja de venderse por precio
       aunque siga siendo vendible; es cómo se saca una sección de la venta sin
       borrarla. */
    if (!ticket_type_id) {
      await supabase.from('ticket_type_espacios').delete().eq('espacio_id', id);
      return res.json({ ok: true, ticket_type_id: null });
    }

    const { data: tipo } = await supabase
      .from('ticket_types').select('id, evento_id, nombre').eq('id', ticket_type_id).maybeSingle();
    if (!tipo || tipo.evento_id !== eventoId) {
      return res.status(400).json({ error: 'Ese tipo de boleta no es de este evento.' });
    }

    /* Uno solo por espacio: dos localidades sobre la misma silla son dos
       precios para la misma silla, y quien compre verá el que salga primero. */
    await supabase.from('ticket_type_espacios').delete().eq('espacio_id', id);
    const { error } = await supabase
      .from('ticket_type_espacios').insert({ ticket_type_id, espacio_id: id });
    if (error) return res.status(500).json({ error: error.message });

    auditar(req, eventoId, 'espacio.localidad', {
      entidad: 'espacio', entidadId: id, detalle: { boleta: tipo.nombre },
    });
    res.json({ ok: true, ticket_type_id });
  } catch (e) { fallo(res, e); }
});

/* Aplicar la localidad a todo un subárbol de una vez. Sin esto, poner precio a
   una sección de 240 sillas son 240 peticiones. */
router.put('/:eventoId/espacios/:id/localidad-en-cascada', exige(PERMS), async (req, res) => {
  const { eventoId, id } = req.params;
  const { ticket_type_id } = req.body;
  try {
    await puedo(eventoId, req.user.id);

    const { data: todos } = await supabase
      .from('espacios').select('id, parent_id, modo, evento_id').eq('evento_id', eventoId);
    if (!(todos || []).some(e => e.id === id)) {
      return res.status(404).json({ error: 'Ese espacio no es de este evento.' });
    }

    const bajo = new Set(descendientes(todos || [], id));
    /* Sólo las hojas vendibles: poner localidad a un pabellón no significa nada
       —no se vende un pabellón— y ensuciaría la tabla con filas que nadie mira. */
    const objetivo = (todos || []).filter(e => bajo.has(e.id) && e.modo === 'vendible').map(e => e.id);
    if (!objetivo.length) return res.status(400).json({ error: 'Ahí dentro no hay nada que se venda.' });

    await supabase.from('ticket_type_espacios').delete().in('espacio_id', objetivo);

    if (ticket_type_id) {
      const { data: tipo } = await supabase
        .from('ticket_types').select('id, evento_id').eq('id', ticket_type_id).maybeSingle();
      if (!tipo || tipo.evento_id !== eventoId) {
        return res.status(400).json({ error: 'Ese tipo de boleta no es de este evento.' });
      }
      const { error } = await supabase
        .from('ticket_type_espacios')
        .insert(objetivo.map(espacio_id => ({ ticket_type_id, espacio_id })));
      if (error) return res.status(500).json({ error: error.message });
    }

    auditar(req, eventoId, 'espacio.localidad-cascada', {
      entidad: 'espacio', entidadId: id, detalle: { cuantos: objetivo.length },
    });
    res.json({ ok: true, aplicados: objetivo.length });
  } catch (e) { fallo(res, e); }
});

/* ── POST /eventos/:eventoId/espacios/:id/liberar ───────────────────────
 *
 * La salida de emergencia del organizador: soltar una silla retenida.
 *
 * Hace falta porque las retenciones caducan solas en diez minutos, pero una
 * VENDIDA no caduca — y una venta anulada, un pago devuelto o una prueba del
 * día anterior dejan la silla ocupada para siempre sin esto.
 */
router.post('/:eventoId/espacios/:id/liberar', exige(PERMS), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await puedo(eventoId, req.user.id);

    const { data: esp } = await supabase
      .from('espacios').select('id, evento_id, nombre').eq('id', id).maybeSingle();
    if (!esp || esp.evento_id !== eventoId) {
      return res.status(404).json({ error: 'Ese espacio no es de este evento.' });
    }

    const { data, error } = await supabase
      .from('espacio_reservas')
      .update({ estado: 'liberado', updated_at: new Date().toISOString() })
      .eq('espacio_id', id).in('estado', ['retenido', 'vendido'])
      .select('id, estado, ticket_id');
    if (error) return res.status(500).json({ error: error.message });

    /* Queda anotado, y con la boleta: soltar a mano una silla vendida es la
       clase de cosa que alguien va a tener que explicar. */
    auditar(req, eventoId, 'espacio.liberar-a-mano', {
      entidad: 'espacio', entidadId: id,
      detalle: { nombre: esp.nombre, tickets: (data || []).map(r => r.ticket_id).filter(Boolean) },
    });
    res.json({ ok: true, liberadas: data?.length || 0 });
  } catch (e) { fallo(res, e); }
});

module.exports = router;
