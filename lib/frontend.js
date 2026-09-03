'use strict';

/* De dónde sale la dirección de la aplicación, en un solo sitio.
 *
 * ── El fallo que esto evita, y estaba a medio arreglar ────────────────────
 *
 * `FRONTEND_URL` hace hoy **dos trabajos que no son el mismo**:
 *
 *   1. La dirección canónica que va en los enlaces de los correos. Tiene que
 *      ser UNA.
 *   2. La lista de orígenes que el navegador puede usar para llamar a la API
 *      (CORS). Pueden ser VARIOS: el dominio de producción, el de pruebas, el
 *      del organizador con marca blanca.
 *
 * Y por eso la variable se lee como lista en unos sitios y como texto en otros.
 * Hoy, en este repo: `recordatorios.js`, `google.js` y `enlacePublico.js` hacen
 * `.split(',')[0]`; `avisoExpositor.js`, `emailPlantillas.js`, `waitlistOferta.js`,
 * `routes/equipo.js` y `lib/oauth.js` **no**.
 *
 * O sea: **el día que alguien ponga dos orígenes para que CORS deje pasar al
 * segundo frontend, los correos empezarán a mandar enlaces así**:
 *
 *     https://uno.com,https://dos.com/mi-ticket/P526L9YD
 *
 * No falla nada, no salta nada. Simplemente el enlace de la boleta no abre —y
 * es el único enlace que la persona guarda y reenvía—. El `.split(',')[0]`
 * repetido tres veces es la señal de que esto ya mordió antes y se parcheó
 * donde dolía en vez de en el origen.
 *
 * Aquí están las dos preguntas separadas, y cada una tiene una respuesta.
 */

const PORDEFECTO = 'https://gestor-eventos-frontend.vercel.app';

const limpiar = (u) => String(u || '').trim().replace(/\/+$/, '');

/* Todo lo que se declaró, venga de donde venga. `CORS_ORIGINS` es la variable
   nueva y explícita; `FRONTEND_URL` se sigue mirando porque es la que está
   puesta hoy y nadie va a cambiarla el mismo día que se despliegue esto. */
function declarados() {
  const crudo = [process.env.CORS_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(',');

  const vistos = [];
  for (const parte of crudo.split(',')) {
    const u = limpiar(parte);
    if (u && !vistos.includes(u)) vistos.push(u);
  }
  return vistos;
}

/* La dirección canónica: la que va dentro de un correo.
 *
 * Es SIEMPRE una, y es la primera de `FRONTEND_URL` —no de `CORS_ORIGINS`—,
 * porque quien añade un origen para que CORS lo deje pasar no está diciendo
 * «manda los correos desde ahí». */
function baseFrontend() {
  const canon = limpiar(String(process.env.FRONTEND_URL || '').split(',')[0]);
  return canon || declarados()[0] || PORDEFECTO;
}

/* Los orígenes que pueden llamar a la API desde un navegador. Varios, y sin el
   de fábrica: dejar entrar a un dominio que quizá no es nuestro porque la
   variable esté sin poner es peor que rechazarlo y verlo en el log. */
function origenesFrontend() {
  return declarados();
}

/* Si la dirección canónica está declarada de verdad o se está usando el valor
   de fábrica. Lo usa el diagnóstico del panel: sin esto, los enlaces de los
   correos apuntan a un dominio que no es el del organizador y nadie se entera
   hasta que alguien hace clic. */
const frontendDeclarado = () => Boolean(limpiar(process.env.FRONTEND_URL));

module.exports = { baseFrontend, origenesFrontend, frontendDeclarado, PORDEFECTO };
