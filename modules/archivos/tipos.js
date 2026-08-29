'use strict';

/* modules/archivos/tipos.js — qué es de verdad este archivo, y si cabe aquí.
 *
 * ── Por qué no se mira la extensión ni el Content-Type ────────────────────
 *
 * Los dos los escribe quien sube. Un archivo llamado `foto.jpg` con
 * `Content-Type: image/jpeg` puede ser cualquier cosa por dentro, y hoy nadie
 * lo comprueba: los cinco uploaders del frontend miran `file.type`, que es lo
 * que el navegador deduce de la extensión.
 *
 * Lo que sí es difícil de falsear son los primeros bytes. No es infalible
 * —nada lo es—, pero convierte «subir lo que sea con el nombre correcto» en un
 * trabajo, en vez de en un renombrado.
 *
 * ── El caso raro: DOCX ────────────────────────────────────────────────────
 *
 * Un `.docx` es un ZIP. Por bytes es indistinguible de un `.zip` cualquiera, y
 * aceptarlo significa aceptar cualquier ZIP. Se acepta igual, pero sólo en la
 * carpeta de hojas de vida, que es privada, y sabiendo esto: no es una
 * comprobación, es una decisión.
 */

/* Las firmas, en orden de más específica a menos. `desplazamiento` porque WEBP
   no empieza por su marca: empieza por RIFF, el tamaño, y luego WEBP. */
const FIRMAS = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },     // %PDF
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] , luego: { desplazamiento: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
  /* ZIP. Puede ser un .docx o un .zip pelado; quien lo use decide. */
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x03, 0x04] },
];

const EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png' : '.png',
  'image/webp': '.webp',
  'image/gif' : '.gif',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/zip': '.zip',
};

function empiezaPor(buffer, bytes, desplazamiento = 0) {
  if (buffer.length < desplazamiento + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[desplazamiento + i] !== bytes[i]) return false;
  }
  return true;
}

/* Devuelve el mime deducido, o null si no se reconoce. Con 16 bytes basta para
   todas las firmas de arriba; no hace falta leer el archivo entero. */
function detectar(buffer) {
  if (!buffer || buffer.length < 4) return null;
  for (const f of FIRMAS) {
    if (!empiezaPor(buffer, f.bytes)) continue;
    if (f.luego && !empiezaPor(buffer, f.luego.bytes, f.luego.desplazamiento)) continue;
    return f.mime;
  }
  return null;
}

/* ── Qué admite cada carpeta ──────────────────────────────────────────────
 *
 * Los límites son los de hoy, con dos correcciones que arreglan hallazgos
 * medidos:
 *
 *   · `hojas-de-vida` es carpeta nueva y PRIVADA. Hasta ahora los CV iban a
 *     `form-uploads`, que es público (§3.4c). Y encima no funcionaba: ese
 *     bucket sólo admite jpeg/png/webp de 4 MB mientras el código mandaba PDF
 *     de hasta 8 MB, así que **nunca se subió un CV con éxito** (§3.4d). En
 *     `form-uploads` hay 16 objetos y ninguno es PDF.
 *
 *   · `form-uploads` deja de aceptar subidas de cualquiera. La política de
 *     Supabase era literalmente `bucket_id = 'form-uploads'` para el rol
 *     `public`: con la llave anónima, que va en el bundle, cualquiera en
 *     internet podía escribir ahí. Aquí hace falta o sesión o el código del
 *     expositor, que es quien tiene que poder subir sin cuenta.
 */
const CARPETAS = {
  'avatars': {
    mimes  : ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 4 * 1024 * 1024,
    publico: true,
    exigeSesion: true,
  },
  'event-media': {
    mimes  : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 8 * 1024 * 1024,
    publico: true,
    exigeSesion: true,
  },
  'form-uploads': {
    mimes  : ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 4 * 1024 * 1024,
    publico: true,
    exigeSesion: false,
  },
  'hojas-de-vida': {
    mimes  : ['application/pdf', 'application/zip'],
    maxBytes: 8 * 1024 * 1024,
    publico: false,
    exigeSesion: true,
  },
};

const carpetaValida = (nombre) => Object.prototype.hasOwnProperty.call(CARPETAS, nombre);

const reglasDe = (nombre) => (carpetaValida(nombre) ? CARPETAS[nombre] : null);

/* La extensión sale del tipo detectado, nunca del nombre que mandó el cliente.
   Así un `factura.pdf.exe` se guarda como `.pdf` si es un PDF, y el nombre
   original queda en la ficha para enseñarlo, no para escribirlo en el disco. */
function extensionDe(mime, nombreOriginal) {
  /* El único caso en el que el nombre aporta algo: distinguir un .docx de un
     .zip, porque por bytes son lo mismo. */
  if (mime === 'application/zip' && /\.docx$/i.test(String(nombreOriginal || ''))) return '.docx';
  return EXTENSION[mime] || '.bin';
}

module.exports = { detectar, reglasDe, carpetaValida, extensionDe, CARPETAS, _FIRMAS: FIRMAS };
