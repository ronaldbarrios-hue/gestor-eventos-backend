#!/usr/bin/env node
/* GESTEK — Probar el SMTP antes de confiar en él.

   Para qué: el día que el proveedor entregue las credenciales, esto dice en
   diez segundos si sirven, SIN desplegar y SIN mandarle nada a un asistente.
   Hasta ahora la única forma de saberlo era desplegar, vender una boleta y
   esperar a ver si llegaba — y si no llegaba, no había forma de saber por qué.

   Uso:
     node scripts/probar-smtp.js
     node scripts/probar-smtp.js --enviar tu@correo.com

   Lee las variables del .env, igual que el servidor. Si la conexión falla,
   prueba el otro puerto por su cuenta: cambiar 465 por 587 (o al revés) es,
   con diferencia, lo que más veces lo arregla. */

require('dotenv').config();

const email = require('../lib/email.js');

const args = process.argv.slice(2);
const destino = (() => {
  const i = args.indexOf('--enviar');
  return i >= 0 ? args[i + 1] : null;
})();

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const A = (s) => `\x1b[33m${s}\x1b[0m`;
const T = (s) => `\x1b[2m${s}\x1b[0m`;

function estado() {
  const cpanel = Boolean(process.env.CPANEL_SMTP_USER && process.env.CPANEL_SMTP_PASS);
  const gmail = Boolean(process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID
    && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  const resend = Boolean(process.env.RESEND_API_KEY);
  return { cpanel, gmail, resend };
}

async function intentar(etiqueta) {
  email.reiniciar();
  const r = await email.verificarConexion();
  if (r.ok) {
    console.log(`${G('  OK')}  ${etiqueta} → ${r.mensaje}`);
    return r;
  }
  console.log(`${R('  MAL')} ${etiqueta} → ${r.mensaje}`);
  if (r.sugerencia) console.log(T(`        ${r.sugerencia}`));
  return r;
}

(async () => {
  console.log('\n── Proveedores configurados ──────────────────────────────');
  const e = estado();
  console.log(`  cPanel SMTP : ${e.cpanel ? G('sí') : T('no')}`);
  console.log(`  Gmail OAuth : ${e.gmail ? G('sí') : T('no')}`);
  console.log(`  Resend      : ${e.resend ? G('sí') : T('no')}`);

  if (!e.cpanel && !e.gmail && !e.resend) {
    console.log(`\n${R('No hay ningún proveedor configurado.')}`);
    console.log(T('  Rellena en el .env: CPANEL_SMTP_USER, CPANEL_SMTP_PASS, CPANEL_SMTP_HOST, CPANEL_SMTP_PORT'));
    console.log(T('  El usuario suele ser el correo COMPLETO. El puerto, 465 (SSL) o 587 (STARTTLS).\n'));
    process.exit(1);
  }

  if (e.cpanel) {
    console.log(`\n  ${T('host')} ${process.env.CPANEL_SMTP_HOST || '(por defecto)'}`);
    console.log(`  ${T('user')} ${process.env.CPANEL_SMTP_USER}`);
    console.log(`  ${T('port')} ${process.env.CPANEL_SMTP_PORT || 465}`);
  }

  console.log('\n── Conexión ──────────────────────────────────────────────');
  let r = await intentar('puerto configurado');

  /* Si falla y es cPanel, se prueba el otro puerto: es lo que más veces lo
     arregla, y decirlo con certeza ahorra una tarde. */
  if (!r.ok && e.cpanel && ['puerto_o_cifrado', 'conexion'].includes(r.causa)) {
    const actual = Number(process.env.CPANEL_SMTP_PORT || 465);
    const otro = actual === 465 ? 587 : 465;
    console.log(T(`\n  Probando el puerto ${otro} por si acaso…`));
    process.env.CPANEL_SMTP_PORT = String(otro);
    const r2 = await intentar(`puerto ${otro}`);
    if (r2.ok) {
      console.log(`\n${A('  ➜ Cambia CPANEL_SMTP_PORT a ' + otro + ' en el servidor.')}`);
      r = r2;
    } else {
      process.env.CPANEL_SMTP_PORT = String(actual);
    }
  }

  if (!r.ok) {
    console.log(`\n${R('La conexión no funciona. No despliegues esto: el correo se descartaría en silencio.')}\n`);
    process.exit(1);
  }

  if (!destino) {
    console.log(`\n${G('La conexión funciona.')}`);
    console.log(T('  Para mandarte un correo de verdad:  node scripts/probar-smtp.js --enviar tu@correo.com\n'));
    process.exit(0);
  }

  console.log('\n── Envío de prueba ───────────────────────────────────────');
  const envio = await email.sendMail({
    to: destino,
    subject: 'Prueba de SMTP · GESTEK',
    fromName: 'GESTEK (prueba)',
    html: `<p>Si estás leyendo esto, el SMTP funciona.</p>
           <p style="color:#666;font-size:13px">Enviado por <code>scripts/probar-smtp.js</code>.</p>`,
  });

  if (envio.ok) {
    console.log(`${G('  OK')}  Enviado a ${destino}.`);
    console.log(T('  Míralo también en spam: si cae ahí, falta SPF/DKIM en el dominio.\n'));
    process.exit(0);
  }
  console.log(`${R('  MAL')} No se pudo enviar: ${envio.error || envio.skipped}\n`);
  process.exit(1);
})().catch(e => {
  console.error(R('\nError inesperado: ') + e.message + '\n');
  process.exit(1);
});
