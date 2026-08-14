/* GESTEK — La cuenta de IA la pone el organizador, no la plataforma.

   Antes el asistente corría con la llave de Anthropic del .env: cada evento
   que lo usara nos costaba dinero. Ahora cada organizador conecta la suya,
   igual que conecta Mercado Pago o Wompi desde Ajustes, y paga su propio
   consumo. La llave del .env se queda como respaldo para que nada deje de
   funcionar de golpe.

   La llave se guarda cifrada (lib/secretos.js) y NO se devuelve nunca: el
   panel enseña una pista y la fecha de la última comprobación. Si su dueño la
   perdió, la regenera en console.anthropic.com — nosotros no somos su gestor
   de contraseñas. */

const supabase = require('./supabase.js');
const secretos = require('./secretos.js');

const TIPO = 'anthropic';

/* El modelo por defecto para quien no elige. `claude-opus-5` cuesta lo mismo
   que el 4.7 que había antes y es la generación actual. */
const MODELO_DEFECTO = 'claude-opus-5';

const faltaTabla = (e) => /organizador_conexiones|does not exist/i.test(String(e?.message || ''));

/* Las llaves de Anthropic empiezan por `sk-ant-`. Comprobarlo aquí evita
   guardar una llave de otro proveedor y descubrirlo en el primer mensaje. */
function validar(llave) {
  const s = String(llave || '').trim();
  if (!s) return 'Falta la llave.';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(s)) {
    return 'Eso no parece una llave de Anthropic. Empiezan por «sk-ant-» y se generan en console.anthropic.com → API Keys.';
  }
  return null;
}

/* ── Lectura ─────────────────────────────────────────────────────────── */

/* Lo que puede ver el panel: nunca la llave. */
async function verConexion(ownerId) {
  const { data, error } = await supabase
    .from('organizador_conexiones')
    .select('pista, opciones, activo, verificado_at, verificado_ok, verificado_error, updated_at')
    .eq('owner_id', ownerId).eq('tipo', TIPO).maybeSingle();

  if (error) {
    if (faltaTabla(error)) return { disponible: false, cifrado_listo: secretos.listo(), cifrado: secretos.diagnostico() };
    return { disponible: true, conexion: null, cifrado_listo: secretos.listo(), cifrado: secretos.diagnostico() };
  }
  return {
    disponible: true,
    conexion: data || null,
    cifrado_listo: secretos.listo(),
    cifrado: secretos.diagnostico(),
    modelo_defecto: MODELO_DEFECTO,
  };
}

/* La llave en claro, para el motor del asistente. Nunca sale por una ruta
   HTTP. Devuelve null si no hay, si está apagada, o si no se puede descifrar
   — y en ese caso el agente cae a la llave de la plataforma. */
async function llaveDe(ownerId) {
  if (!ownerId) return null;
  const { data, error } = await supabase
    .from('organizador_conexiones')
    .select('valor_cifrado, opciones, activo')
    .eq('owner_id', ownerId).eq('tipo', TIPO).maybeSingle();

  if (error || !data || !data.activo) return null;
  try {
    return {
      apiKey: secretos.descifrar(data.valor_cifrado),
      modelo: data.opciones?.modelo || MODELO_DEFECTO,
    };
  } catch (e) {
    console.warn(`[ia] no se pudo descifrar la llave de ${ownerId}:`, e.message);
    return null;
  }
}

/* ── Comprobar contra Anthropic ──────────────────────────────────────── */

/* Una llamada mínima de verdad. Pedir la lista de modelos vale: confirma que
   la llave existe y sirve, y no gasta tokens de generación. */
async function probarLlave(apiKey) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (r.status === 401) return { ok: false, error: 'Anthropic rechazó la llave. Genera otra en console.anthropic.com → API Keys.' };
    if (r.status === 403) return { ok: false, error: 'La llave es válida pero no tiene permiso. Revisa a qué espacio de trabajo pertenece.' };
    if (r.status === 429) return { ok: false, error: 'Tu cuenta de Anthropic está al límite de peticiones ahora mismo. Vuelve a probar en un minuto.' };
    if (!r.ok) return { ok: false, error: `Anthropic respondió ${r.status}.` };
    return { ok: true, mensaje: 'La llave funciona. El asistente correrá con tu cuenta.' };
  } catch (e) {
    return { ok: false, error: `No se pudo contactar con Anthropic: ${e.message}` };
  }
}

/* ── Guardado ────────────────────────────────────────────────────────── */

async function guardar(ownerId, { llave, modelo, activo } = {}) {
  const fallo = validar(llave);
  if (fallo) return { ok: false, error: fallo };
  if (!secretos.listo()) {
    return { ok: false, error: 'El servidor no tiene SMTP_CRYPTO_KEY configurada, así que no puede guardar una llave de forma segura.' };
  }

  /* Se prueba ANTES de guardar: una llave que no sirve no debería quedar
     escrita como si sirviera. */
  const prueba = await probarLlave(String(llave).trim());

  const fila = {
    owner_id: ownerId,
    tipo: TIPO,
    valor_cifrado: secretos.cifrar(String(llave).trim()),
    pista: secretos.pista(String(llave).trim()),
    opciones: { modelo: modelo || MODELO_DEFECTO },
    activo: activo !== false,
    verificado_at: new Date().toISOString(),
    verificado_ok: prueba.ok,
    verificado_error: prueba.ok ? null : String(prueba.error).slice(0, 300),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('organizador_conexiones').upsert(fila, { onConflict: 'owner_id,tipo' });

  if (error) {
    if (faltaTabla(error)) return { ok: false, error: 'Falta aplicar la migración 0072.' };
    return { ok: false, error: error.message };
  }
  return { ok: true, conexion: prueba };
}

async function borrar(ownerId) {
  const { error } = await supabase
    .from('organizador_conexiones').delete().eq('owner_id', ownerId).eq('tipo', TIPO);
  if (error && !faltaTabla(error)) return { ok: false, error: error.message };
  return { ok: true };
}

/* Vuelve a comprobar la llave ya guardada. */
async function verificar(ownerId) {
  const cred = await llaveDe(ownerId);
  if (!cred) return { ok: false, error: 'No tienes una llave de Anthropic conectada.' };

  const prueba = await probarLlave(cred.apiKey);
  try {
    await supabase.from('organizador_conexiones').update({
      verificado_at: new Date().toISOString(),
      verificado_ok: prueba.ok,
      verificado_error: prueba.ok ? null : String(prueba.error).slice(0, 300),
    }).eq('owner_id', ownerId).eq('tipo', TIPO);
  } catch { /* anotar es mejor esfuerzo */ }

  return prueba;
}

module.exports = { verConexion, llaveDe, guardar, borrar, verificar, probarLlave, validar, MODELO_DEFECTO, TIPO };
