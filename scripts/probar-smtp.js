#!/usr/bin/env node
/* GESTEK — Probar el SMTP antes de confiar en él.

   Para qué: el día que el proveedor entregue las credenciales, esto dice en
   diez segundos si sirven, SIN desplegar y SIN mandarle nada a un asistente.
   Hasta ahora la única forma de saberlo era desplegar, vender una boleta y
   esperar a ver si llegaba — y si no llegaba, no había forma de saber por qué.

   Uso:
     node scripts/probar-smtp.js
     node scripts/probar-smtp.js --enviar tu@correo.com

   Lee las variables del .env, igual que el servidor. Si sólo hay UN buzón SMTP
   configurado y falla, prueba el otro puerto por su cuenta: cambiar 465 por
   587 (o al revés) es, con diferencia, lo que más veces lo arregla. Con DOS
   buzones (alternando), cada uno se verifica por separado — si uno de los dos
   falla, este script no adivina el puerto por ti: dilo tú y vuelve a correr. */

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
  const smtp2  = Boolean(process.env.CPANEL_SMTP_USER2 && process.env.CPANEL_SMTP_PASS2);
  const gmail = Boolean(process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID
    && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  const resend = Boolean(process.env.RESEND_API_KEY);
  return { cpanel, smtp2, gmail, resend };
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
  const totalBuzones = [e.cpanel, e.smtp2].filter(Boolean).length;
  console.log(`  Buzón 1 (CPANEL_SMTP_*)  : ${e.cpanel ? G('sí') : T('no')}`);
  console.log(`  Buzón 2 (CPANEL_SMTP_*2) : ${e.smtp2 ? G('sí') : T('no')}`);
  console.log(`  Gmail OAuth              : ${e.gmail ? G('sí') : T('no')}`);
  console.log(`  Resend                   : ${e.resend ? G('sí') : T('no')}`);
  if (totalBuzones === 2) console.log(A('  → los dos buzones están activos: los envíos van a alternar entre ellos.'));

  if (!e.cpanel && !e.smtp2 && !e.gmail && !e.resend) {
    console.log(`\n${R('No hay ningún proveedor configurado.')}`);
    console.log(T('  Rellena en el .env: CPANEL_SMTP_USER, CPANEL_SMTP_PASS, CPANEL_SMTP_HOST, CPANEL_SMTP_PORT'));
    console.log(T('  El usuario suele ser el correo COMPLETO. El puerto, 465 (SSL) o 587 (STARTTLS).\n'));
    process.exit(1);
  }

  if (e.cpanel) {
    console.log(`\n  ${T('buzón 1 · host')} ${process.env.CPANEL_SMTP_HOST || '(por defecto)'}`);
    console.log(`  ${T('buzón 1 · user')} ${process.env.CPANEL_SMTP_USER}`);
    console.log(`  ${T('buzón 1 · port')} ${process.env.CPANEL_SMTP_PORT || 465}`);
  }
  if (e.smtp2) {
    console.log(`\n  ${T('buzón 2 · host')} ${process.env.CPANEL_SMTP_HOST2 || '(sin definir)'}`);
    console.log(`  ${T('buzón 2 · user')} ${process.env.CPANEL_SMTP_USER2}`);
    console.log(`  ${T('buzón 2 · port')} ${process.env.CPANEL_SMTP_PORT2 || 465}`);
  }

  console.log('\n── Conexión ──────────────────────────────────────────────');
  let r = await intentar('configuración actual');

  /* El truco de probar el otro puerto sólo tiene sentido con UN buzón activo:
     con dos, `verificarConexion()` ya prueba cada uno por separado y cambiar
     "el" puerto sería ambiguo — no se sabría de cuál de los dos. */
  if (!r.ok && totalBuzones === 1 && ['puerto_o_cifrado', 'conexion'].includes(r.causa)) {
    const sufijo = e.cpanel ? '' : '2';
    const varPuerto = `CPANEL_SMTP_PORT${sufijo}`;
    const actual = Number(process.env[varPuerto] || 465);
    const otro = actual === 465 ? 587 : 465;
    console.log(T(`\n  Probando el puerto ${otro} por si acaso…`));
    process.env[varPuerto] = String(otro);
    const r2 = await intentar(`puerto ${otro}`);
    if (r2.ok) {
      console.log(`\n${A('  ➜ Cambia ' + varPuerto + ' a ' + otro + ' en el servidor.')}`);
      r = r2;
    } else {
      process.env[varPuerto] = String(actual);
    }
  }

  if (!r.ok) {
    console.log(`\n${R('La conexión no funciona. No despliegues esto: el correo se descartaría en silencio.')}\n`);
    process.exit(1);
  }
  if (totalBuzones === 2 && r.buzones?.some(b => !b.ok)) {
    console.log(`\n${A('  Uno de los dos buzones falla — el otro cubre el envío, pero conviene arreglarlo:')}`);
    for (const b of r.buzones.filter(b => !b.ok)) {
      console.log(`${R('  MAL')} ${b.id} → ${b.mensaje}`);
      if (b.sugerencia) console.log(T(`        ${b.sugerencia}`));
    }
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
