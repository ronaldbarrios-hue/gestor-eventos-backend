/* GESTEK — Un archivo adjunto en un formulario.
 *
 * ── Los dos sitios, y por qué ────────────────────────────────────────────
 *
 * El bucket `form-uploads` es PÚBLICO: nadie puede listar lo que hay dentro
 * —la 0048 quitó esa política a propósito— pero cualquiera con el enlace lo
 * abre. Y el enlace viaja dentro de `tickets.respuestas`, así que sale en el
 * CSV de asistentes, en los informes y en cualquier pantalla que enseñe las
 * respuestas.
 *
 * Para un pitch deck está bien. Para una cédula escaneada, no: un enlace que no
 * caduca, pegado en una hoja de cálculo que circula por correo, es una
 * filtración esperando a que alguien reenvíe el archivo.
 *
 * Así que lo elige quien hace la pregunta (`event_form_fields.sensible`):
 *
 *   normal   → `form-uploads`, y en `respuestas` va la URL pública. Es
 *              exactamente lo que ya pasa con el campo «foto».
 *   sensible → `form-uploads-privado`, sin lectura pública, y en `respuestas`
 *              NO va una URL: va una referencia a la ruta.
 *
 * ── Por qué una referencia y no una URL ──────────────────────────────────
 *
 * Porque una URL en esa columna acaba en el CSV **por construcción**: el
 * exportador escribe lo que hay, y lo que hay sería un enlace que abre el
 * documento de alguien. Una referencia no se puede abrir sin pasar por el
 * servidor, que comprueba quién pregunta y firma un enlace que caduca.
 *
 * El prefijo es feo a propósito. Si algún día alguien lo pinta sin traducir,
 * se ve que es una referencia interna y no un dato roto — y se arregla. Una
 * URL mal puesta, en cambio, funciona: nadie la reporta nunca.
 */

'use strict';

const BUCKET_PUBLICO = 'form-uploads';
const BUCKET_PRIVADO = 'form-uploads-privado';

/* 15 MB. Por debajo de eso la gente manda el documento por WhatsApp y volvemos
   al problema que esto viene a resolver: un archivo que nadie sabe si llegó. */
const MAX_BYTES = 15 * 1024 * 1024;

/* Lo que de verdad sirve en un formulario de evento. La lista es corta a
   propósito: cada formato que se acepta es uno que alguien del equipo va a
   tener que abrir el día que revise las inscripciones. */
const FORMATOS = [
  { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'Imagen' },
  { mime: 'image/png', ext: 'png', label: 'Imagen' },
  { mime: 'image/webp', ext: 'webp', label: 'Imagen' },
  { mime: 'application/msword', ext: 'doc', label: 'Word' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', label: 'Word' },
];

/* En el público van además las presentaciones: un pitch deck es lo que más se
   va a subir. En el privado no, porque un documento sensible no es una
   presentación y cada formato de más es superficie que abrir. */
const FORMATOS_PUBLICOS = [
  ...FORMATOS,
  { mime: 'application/vnd.ms-powerpoint', ext: 'ppt', label: 'PowerPoint' },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', label: 'PowerPoint' },
];

const PREFIJO_PRIVADO = 'privado:';

function bucketDe(campo) {
  return campo?.sensible ? BUCKET_PRIVADO : BUCKET_PUBLICO;
}

function formatosDe(campo) {
  return campo?.sensible ? FORMATOS : FORMATOS_PUBLICOS;
}

function mimesDe(campo) {
  return formatosDe(campo).map(f => f.mime);
}

/* Lo que se guarda en `respuestas` para un archivo privado. */
function refPrivada(ruta) {
  const r = String(ruta || '').trim();
  return r ? `${PREFIJO_PRIVADO}${r}` : null;
}

function esPrivado(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_PRIVADO);
}

/* La ruta dentro del bucket, o null si eso no es una referencia privada. */
function rutaDe(valor) {
  if (!esPrivado(valor)) return null;
  const ruta = valor.slice(PREFIJO_PRIVADO.length).trim();
  /* Nada de subir por el árbol. La ruta la escribe el navegador de quien sube,
     así que llega de fuera: un `../` aquí leería otro bucket. */
  if (!ruta || ruta.includes('..') || ruta.startsWith('/')) return null;
  return ruta;
}

/* Qué escribe el exportador en una hoja de cálculo.
 *
 * Un archivo privado NO da su enlace: la hoja circula por correo y el enlace no
 * caducaría nunca. Se dice que existe —que es el dato que hace falta para
 * revisar quién adjuntó y quién no— y se abre desde el panel. */
function paraExportar(valor) {
  if (esPrivado(valor)) return 'Archivo adjunto (se abre desde el panel)';
  return valor || '';
}

/* El nombre del archivo dentro del bucket.
 *
 * Lleva la hora, así que nunca hay dos iguales y no hace falta sobrescribir —
 * que es lo que obliga a dar permiso de UPDATE, y con UPDATE cualquiera podría
 * pisar el documento de otro conociendo su ruta. */
function rutaNueva({ eventoId, campoId, extension }) {
  const ext = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `${eventoId}/${campoId}-${Date.now()}.${ext}`;
}

/* Cuánto dura el enlace firmado. Diez minutos: lo que tarda alguien en abrirlo
   o descargarlo, y poco para que sirva de algo si se reenvía. */
const SEGUNDOS_FIRMA = 600;

module.exports = {
  BUCKET_PUBLICO, BUCKET_PRIVADO, MAX_BYTES, SEGUNDOS_FIRMA,
  FORMATOS, FORMATOS_PUBLICOS, PREFIJO_PRIVADO,
  bucketDe, formatosDe, mimesDe,
  refPrivada, esPrivado, rutaDe, paraExportar, rutaNueva,
};
