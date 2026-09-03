/* Aforo por zonas — la cuenta, en un solo sitio.
 *
 * Tres pantallas preguntan lo mismo (el tablero en vivo, el mapa y el
 * reporte) y antes cada una sumaba por su cuenta. Aquí vive la única
 * definición de "cuánta gente hay en esta zona".
 *
 * Reglas del modelo, que no son obvias:
 *
 * · La zona se identifica por su `id` —de la tabla `zonas` desde la 0091, y
 *   antes de `page_json.zonas`— y no por el nombre.
 *   Los movimientos anteriores a la migración 0079 sólo tienen nombre, así que
 *   cada zona se busca por id Y por nombre, y lo que aparezca se suma.
 *
 * · "Limpiar" no borra: escribe un corte en `zona_cortes`. La ocupación se
 *   cuenta desde el último corte; el reporte sigue viendo el día entero.
 *
 * · El aforo máximo NO bloquea. Pasarse está permitido: se marca `excedido` y
 *   se avisa, pero la gente entra. Todo el sentido de esto es tener el número
 *   real, y un torniquete que rechaza gente devuelve un número falso.
 */
const supabase = require('./supabase.js');
const { leerZonas } = require('./zonasTabla.js');

/* Las zonas declaradas del evento, normalizadas.
 *
 * Desde la 0091 salen de la tabla `zonas` y ya no de `page_json`. La forma que
 * devuelve es LA MISMA de antes a proposito: este archivo tiene tres
 * consumidores y ninguno tiene por que enterarse de que el dato cambio de
 * sitio. `leerZonas` conserva la vuelta atras al JSON mientras exista. */
async function zonasDelEvento(eventoId) {
  return leerZonas(eventoId);
}

/* Suma las filas del agregado que correspondan a una zona (por id o nombre). */
function juntar(filas, zona) {
  const propias = filas.filter(f => f.clave === zona.id || (zona.nombre && f.clave === zona.nombre));
  return propias.reduce((acc, f) => ({
    entradas : acc.entradas + Number(f.entradas || 0),
    salidas  : acc.salidas  + Number(f.salidas  || 0),
    dentro   : acc.dentro   + Number(f.dentro   || 0),
    personas : acc.personas + Number(f.personas || 0),
    manuales : acc.manuales + Number(f.manuales || 0),
    ultima_at: [acc.ultima_at, f.ultima_at].filter(Boolean).sort().pop() || null,
    primera_at: [acc.primera_at, f.primera_at].filter(Boolean).sort()[0] || null,
  }), { entradas: 0, salidas: 0, dentro: 0, personas: 0, manuales: 0, ultima_at: null, primera_at: null });
}

/* Plan B si la 0079 todavía no se aplicó: la suma vieja, fila a fila.
   Trae hasta 50.000 movimientos en páginas de 1.000 — el límite por defecto de
   PostgREST era justo el fallo que la migración viene a arreglar. */
async function agregadoManual(eventoId, { desdePorClave = {} } = {}) {
  const filas = [];
  for (let desde = 0; desde < 50000; desde += 1000) {
    const { data, error } = await supabase.from('ticket_movimientos')
      .select('zona, zona_id, tipo, ticket_id, cantidad, created_at')
      .eq('evento_id', eventoId)
      .order('created_at', { ascending: true })
      .range(desde, desde + 999);
    if (error) break;
    filas.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const porClave = new Map();
  for (const m of filas) {
    const clave = m.zona_id || m.zona;
    if (!clave) continue;
    const corte = desdePorClave[clave];
    if (corte && new Date(m.created_at) <= new Date(corte)) continue;
    const n = Number(m.cantidad) || 1;
    const a = porClave.get(clave) || { clave, zona: m.zona, entradas: 0, salidas: 0, dentro: 0, tickets: new Set(), ultima_at: null };
    if (m.tipo === 'entrada') { a.entradas += n; a.dentro += n; if (m.ticket_id) a.tickets.add(m.ticket_id); }
    else { a.salidas += n; a.dentro -= n; }
    a.zona = m.zona || a.zona;
    a.ultima_at = m.created_at;
    porClave.set(clave, a);
  }
  return [...porClave.values()].map(a => ({ ...a, personas: a.tickets.size, tickets: undefined }));
}

/* Último RESET por clave de zona. Un reporte manual o automático también
   escribe en `zona_cortes` (para el histórico y su foto/nota), pero no debe
   contar aquí: si lo hiciera, el tablero diría "limpiada a las 3pm" de un
   reporte que no limpió nada, y la ocupación en vivo se iría a cero con él. */
async function cortesDelEvento(eventoId) {
  const { data } = await supabase.from('zona_cortes')
    .select('zona_id, zona, created_at, motivo')
    .eq('evento_id', eventoId)
    .eq('tipo', 'reset')
    .order('created_at', { ascending: false });
  const ultimo = {};
  for (const c of data || []) {
    const clave = c.zona_id || c.zona;
    if (clave && !ultimo[clave]) ultimo[clave] = c;
  }
  return ultimo;
}

/* Ocupación viva de cada zona declarada del evento. */
async function ocupacion(eventoId, zonasDadas = null) {
  const todas = zonasDadas || await zonasDelEvento(eventoId);
  /* Las puertas quedan fuera del aforo (0096). Por una puerta se pasa, no se
     está: contarlas diría que hay cuarenta personas «dentro de la entrada
     inicial», y el número de gente en el recinto quedaría sumado dos veces —una
     al cruzar la puerta y otra en la zona a la que se entra—.

     Se filtra aquí y no al leer, porque la puerta SÍ es una zona para todo lo
     demás: sale en el plano, se le cuelgan actividades y tiene su ficha. */
  const zonas = todas.filter((z) => z.tipo !== 'ingreso');
  const cortes = await cortesDelEvento(eventoId).catch(() => ({}));

  let filas = null;
  const { data, error } = await supabase.rpc('aforo_zonas', { p_evento: eventoId });
  if (!error) filas = data || [];
  else {
    const desdePorClave = {};
    for (const [k, c] of Object.entries(cortes)) desdePorClave[k] = c.created_at;
    filas = await agregadoManual(eventoId, { desdePorClave });
  }

  return zonas.map(z => {
    const s = juntar(filas, z);
    const corte = cortes[z.id] || (z.nombre ? cortes[z.nombre] : null);
    const dentro = Math.max(0, s.dentro);
    const pct = z.aforo_max ? Math.round((dentro / z.aforo_max) * 100) : null;
    return {
      id: z.id, nombre: z.nombre, aforo_max: z.aforo_max,
      dentro, entradas: s.entradas, salidas: s.salidas, personas: s.personas,
      excedido: z.aforo_max ? Math.max(0, dentro - z.aforo_max) : 0,
      ocupacion_pct: pct,
      /* Semáforo para el mapa y el tablero: 'en_fuego' al 100% o más,
         'caliente' desde el 85%. null si la zona no tiene tope declarado. */
      nivel: pct == null ? null : pct >= 100 ? 'en_fuego' : pct >= 85 ? 'caliente' : 'normal',
      ultima_at: s.ultima_at,
      corte_at: corte?.created_at || null,
    };
  });
}

/* Qué está pasando DENTRO de cada zona.
 *
 * Una zona es un punto del plano —"Zona Gamer"— y dentro pasan cosas a lo
 * largo del día: el torneo de FIFA a las 3, la final a las 7. El plano decía
 * dónde queda la zona y la agenda decía a qué hora es el torneo, y no había
 * forma de preguntar lo único que importa estando allí: qué hay AHORA aquí.
 *
 * El vínculo es `zona_id` (migración 0080). Se acepta además el nombre escrito
 * en `ubicacion` o `track`, porque los sub-eventos creados antes de la 0080 —o
 * por alguien que escribió el nombre a mano— tienen que seguir apareciendo en
 * su zona en vez de desaparecer sin explicación.
 */
async function agendaPorZona(eventoId, zonas, ahoraISO = null) {
  if (!zonas?.length) return {};
  const ahora = ahoraISO ? new Date(ahoraISO) : new Date();

  const { data: sesiones } = await supabase
    .from('agenda_sessions')
    /* Quien la da y con que boleta se entra vienen con la sesion.
       Las tres relaciones existian en la tabla desde hace tiempo y ninguna
       pantalla las llenaba; ahora que el formulario las ofrece, la ficha de la
       zona puede contestar «quien habla hoy aqui» sin una consulta aparte.
       Son `left join` (PostgREST los hace asi con la columna anulable), asi que
       una sesion sin speaker sigue saliendo, con `speaker: null`. */
    .select(`id, titulo, tipo, inicio, fin, track, ubicacion, zona_id, cupo, inscritos, requiere_inscripcion,
             speaker:speakers!speaker_id(id, nombre, foto_url, empresa),
             expositor:networking_expositores!expositor_id(id, nombre),
             boleta:ticket_types!ticket_type_id(id, nombre)`)
    .eq('evento_id', eventoId)
    .order('inicio', { ascending: true });

  const igual = (a, b) => String(a || '').trim().toLocaleLowerCase('es') === String(b || '').trim().toLocaleLowerCase('es');

  const porZona = {};
  for (const z of zonas) {
    const suyas = (sesiones || []).filter(s =>
      (s.zona_id && s.zona_id === z.id) ||
      (!s.zona_id && z.nombre && (igual(s.ubicacion, z.nombre) || igual(s.track, z.nombre)))
    );

    const conEstado = suyas.map(s => {
      const ini = s.inicio ? new Date(s.inicio) : null;
      /* Sin hora de fin no se puede saber cuándo termina; se le dan dos horas,
         que es lo que dura una charla larga. Es una suposición, y por eso el
         estado que sale de ahí no se presenta como un hecho en la pantalla. */
      const fin = s.fin ? new Date(s.fin) : (ini ? new Date(ini.getTime() + 2 * 3600 * 1000) : null);
      const estado = !ini ? 'sin_hora'
        : ahora < ini ? 'proximo'
        : (fin && ahora > fin) ? 'terminado'
        : 'ahora';
      return {
        id: s.id, titulo: s.titulo, tipo: s.tipo, inicio: s.inicio, fin: s.fin,
        cupo: s.cupo ?? null, inscritos: s.inscritos || 0,
        libres: s.cupo == null ? null : Math.max(0, s.cupo - (s.inscritos || 0)),
        requiere_inscripcion: Boolean(s.requiere_inscripcion),
        fin_estimado: !s.fin && Boolean(s.inicio),
        estado,
        /* Se pasan tal cual, sin aplanar: quien pinta decide si ensena el
           nombre, la foto o la empresa. Aplanar aqui a un `speaker_nombre`
           obligaria a volver a tocar esto la primera vez que alguien quiera la
           foto. */
        speaker  : s.speaker   || null,
        expositor: s.expositor || null,
        boleta   : s.boleta    || null,
      };
    });

    /* Quien habla HOY en esta zona, sin repetidos y en el orden en que
       aparecen. Es la pregunta que antes obligaba a recorrer el calendario
       entero mirando cual cae aqui. */
    const speakers = [];
    for (const s of conEstado) {
      if (s.speaker?.id && !speakers.some(x => x.id === s.speaker.id)) speakers.push(s.speaker);
    }

    porZona[z.id] = {
      agenda   : conEstado,
      ahora    : conEstado.filter(s => s.estado === 'ahora'),
      siguiente: conEstado.find(s => s.estado === 'proximo') || null,
      speakers,
    };
  }
  return porZona;
}

module.exports = { zonasDelEvento, ocupacion, cortesDelEvento, agregadoManual, juntar, agendaPorZona };
