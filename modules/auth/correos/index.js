'use strict';

/* modules/auth/correos/ — los tres correos que manda la identidad propia.
 *
 * Confirmar el registro, recuperar la contraseña, y el aviso de que alguien
 * intentó registrarse con una dirección que ya tiene cuenta.
 *
 * ── Por qué el envío no puede tumbar el registro ──────────────────────────
 *
 * `sendMail` habla con un servidor SMTP que a veces tarda o falla. Si un fallo
 * de correo hiciera fallar el registro, el usuario vería un error después de
 * que su cuenta YA se creó, y al reintentar le diríamos que el correo está
 * cogido. Así que aquí los fallos se registran y se tragan: la cuenta queda
 * creada y el botón de «reenviar confirmación» arregla el resto.
 *
 * ── El enlace ─────────────────────────────────────────────────────────────
 *
 * Apunta al frontend, no al backend. La pantalla `ConfirmarPage` es la que
 * llama a `/auth/confirmar` con el token en el cuerpo. Si el enlace apuntara al
 * backend, el token viajaría en la URL y acabaría en los registros de acceso
 * del servidor y en la cabecera `Referer` de cualquier recurso externo de la
 * página siguiente — que es justo lo que se corrigió en el commit del QR.
 */

const email = require('../../../lib/email.js');
const config = require('../../../core/config');

function baseFrontend() {
  const url = (config.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return url || 'http://localhost:5173';
}

/* Plantilla mínima y sobria. El correo de confirmación llega a bandejas de
   entrada que nunca han visto la marca; lo que tiene que quedar claro en dos
   segundos es de quién es y qué botón hay que pulsar. */
function envolver({ titulo, cuerpo, boton, enlace, pie }) {
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;padding:32px;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${titulo}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${cuerpo}</p>
          <p style="margin:0 0 24px;">
            <a href="${enlace}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">${boton}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
            Si el botón no funciona, copiá esta dirección en el navegador:<br>
            <span style="color:#374151;word-break:break-all;">${enlace}</span>
          </p>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">${pie}</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">GESTEK</p>
    </td></tr>
  </table>
</body></html>`;
}

async function mandar(opciones) {
  try {
    await email.sendMail(opciones);
    return true;
  } catch (e) {
    console.error('[auth] no se pudo mandar el correo:', e?.message || e);
    return false;
  }
}

async function confirmacion(usuario, token) {
  const enlace = `${baseFrontend()}/confirmar?token=${encodeURIComponent(token)}`;

  /* En desarrollo casi nunca hay SMTP configurado, y sin el enlace por consola
     no hay forma de terminar un registro de prueba. En producción no se imprime
     nunca: sería dejar la llave en el registro del servidor. */
  if (!config.IS_PROD) console.log(`[auth] enlace de confirmación para ${usuario.email}: ${enlace}`);

  return mandar({
    to     : usuario.email,
    subject: 'Confirmá tu correo · GESTEK',
    html   : envolver({
      titulo: 'Confirmá tu correo',
      cuerpo: 'Para terminar de crear tu cuenta hacé clic en el botón. El enlace vale 24 horas.',
      boton : 'Confirmar mi correo',
      enlace,
      pie   : 'Si no fuiste vos quien creó esta cuenta, ignorá este mensaje: sin confirmar, la cuenta no sirve para nada.',
    }),
  });
}

async function recuperacion(usuario, token) {
  const enlace = `${baseFrontend()}/reset-password?token=${encodeURIComponent(token)}`;

  if (!config.IS_PROD) console.log(`[auth] enlace de recuperación para ${usuario.email}: ${enlace}`);

  return mandar({
    to     : usuario.email,
    subject: 'Restablecer tu contraseña · GESTEK',
    html   : envolver({
      titulo: 'Restablecer tu contraseña',
      cuerpo: 'Alguien pidió cambiar la contraseña de esta cuenta. Si fuiste vos, hacé clic en el botón. El enlace vale una hora y sólo se puede usar una vez.',
      boton : 'Elegir contraseña nueva',
      enlace,
      pie   : 'Si no lo pediste, no hace falta que hagas nada: tu contraseña actual sigue funcionando y este enlace caduca solo.',
    }),
  });
}

/* El tercero. Se manda a la dirección real cuando alguien intenta registrarse
   con un correo que ya tiene cuenta, porque el formulario contesta lo mismo que
   a un registro normal para no delatar quién está registrado. El dueño se
   entera; el que lo intentó, no. */
async function avisarIntentoDeRegistro(usuario) {
  return mandar({
    to     : usuario.email,
    subject: 'Alguien intentó crear una cuenta con tu correo · GESTEK',
    html   : envolver({
      titulo: 'Ya tenés una cuenta con este correo',
      cuerpo: 'Se intentó crear una cuenta nueva con tu dirección. No se creó nada y tu cuenta sigue igual. Si fuiste vos y no recordás la contraseña, podés restablecerla.',
      boton : 'Restablecer mi contraseña',
      enlace: `${baseFrontend()}/auth`,
      pie   : 'Si no fuiste vos, no hace falta que hagas nada.',
    }),
  });
}

module.exports = { confirmacion, recuperacion, avisarIntentoDeRegistro, _envolver: envolver };
