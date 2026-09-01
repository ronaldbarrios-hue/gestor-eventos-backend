'use strict';

/* Reporte automático de aforo — Fase 3 del Camino unitario (PLAN-TRABAJO.md §2).
 *
 * Un corte 'auto' es la misma fila que un corte 'manual' (migración 0087):
 * mismo tipo de registro en `zona_cortes`, mismo `contexto` (ocupación de
 * todas las zonas del evento + qué sesión de agenda corría en ésta). La
 * única diferencia es que aquí no hay foto ni nota, y que decide la
 * cadencia sola en vez de que alguien apriete un botón.
 *
 * Lo llama `scripts/cron-aforo-reporte.js`, desde el cron de cPanel — mismo
 * patrón que `lib/recordatorios.js` + `scripts/cron-recordatorios.js`.
 */
const supabase = require('./supabase.js');
const { zonasDelEvento, ocupacion, agendaPorZona } = require('./aforoZonas.js');

/* El plan dice "mínimo 60": una cadencia menor convertiría un evento
   olvidado en pausa (nadie lo puso a 15 a propósito, sólo no lo tocó) en un
   chorro de cortes. Se respeta lo que el organizador configuró, pero nunca
   por debajo de esto. */
const CADENCIA_MINIMA_MIN = 60;

/* Publicados, dentro de su ventana (ya empezaron, no han terminado) y con la
   cadencia configurada en page_json.aforo.reporte_cada_min. Sin esto último,
   el cron correría sobre todos los eventos publicados del sistema. */
async function eventosConReporteAuto() {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from('eventos')
    .select('id, page_json, fecha_inicio, fecha_fin')
    .eq('estado', 'publicado')
    .lte('fecha_inicio', ahora)
    .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);
  if (error) throw new Error(`No se pudo listar eventos: ${error.message}`);
  return (data || []).filter(e => Number(e.page_json?.aforo?.reporte_cada_min) > 0);
}

/* Último corte 'auto' de esa zona. Si nunca hubo uno, toca escribir ya. */
async function ultimoAutoDe(eventoId, zonaId) {
  const { data } = await supabase.from('zona_cortes')
    .select('created_at')
    .eq('evento_id', eventoId).eq('zona_id', zonaId).eq('tipo', 'auto')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.created_at || null;
}

async function tomarReporteAuto(eventoId, zona, zonasAhora, agendaPorZonaId) {
  const { error } = await supabase.from('zona_cortes').insert({
    evento_id: eventoId, zona_id: zona.id, zona: zona.nombre, tipo: 'auto',
    dentro_antes: zonasAhora.find(z => z.id === zona.id)?.dentro ?? null,
    contexto: {
      hora: new Date().toISOString(),
      zonas: zonasAhora.map(z => ({ id: z.id, nombre: z.nombre, dentro: z.dentro, aforo_max: z.aforo_max })),
      sesiones_en_zona: agendaPorZonaId[zona.id]?.agenda || [],
    },
  });
  if (error) throw new Error(error.message);
}

/* Una pasada: por cada evento con cadencia configurada, por cada una de sus
   zonas, si ya pasó la cadencia desde su último 'auto' (o nunca hubo uno),
   escribe un corte nuevo. Un evento sin zonas, o una zona sin nada que
   contar, simplemente no genera cortes — no es un error. */
async function correrCicloReporteAforo() {
  const eventos = await eventosConReporteAuto();
  let escritos = 0;
  for (const ev of eventos) {
    const cadenciaMin = Math.max(CADENCIA_MINIMA_MIN, Number(ev.page_json?.aforo?.reporte_cada_min) || CADENCIA_MINIMA_MIN);
    const zonas = await zonasDelEvento(ev.id);
    if (!zonas.length) continue;

    const [zonasAhora, agendaPorZonaId] = await Promise.all([
      ocupacion(ev.id, zonas),
      agendaPorZona(ev.id, zonas).catch(() => ({})),
    ]);

    for (const zona of zonas) {
      const ultimo = await ultimoAutoDe(ev.id, zona.id);
      const yaToca = !ultimo || (Date.now() - new Date(ultimo).getTime()) >= cadenciaMin * 60_000;
      if (!yaToca) continue;
      await tomarReporteAuto(ev.id, zona, zonasAhora, agendaPorZonaId);
      escritos++;
    }
  }
  return { eventos_revisados: eventos.length, cortes_escritos: escritos };
}

module.exports = { correrCicloReporteAforo, CADENCIA_MINIMA_MIN };
