/* GESTEK — Que el reparto entre dos buzones SMTP alterne de verdad, y que un
   fallo de uno no le cueste el correo al otro.

   No hay servidor SMTP real en las pruebas, así que se sustituye
   `nodemailer.createTransport` por una fábrica de transportes falsos: cada
   llamada de `lib/email.js` a `require('nodemailer')` recibe el mismo objeto
   de módulo (Node lo cachea por ruta), así que mutar su `createTransport`
   antes de disparar `init()` alcanza sin flags experimentales de mock. */

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

const email = require('../lib/email.js');

const ENV_KEYS = [
  'CPANEL_SMTP_USER', 'CPANEL_SMTP_PASS', 'CPANEL_SMTP_HOST', 'CPANEL_SMTP_PORT',
  'CPANEL_SMTP_USER2', 'CPANEL_SMTP_PASS2', 'CPANEL_SMTP_HOST2', 'CPANEL_SMTP_PORT2',
  'GMAIL_USER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'RESEND_API_KEY',
];

function limpiarEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function ponerDosBuzones() {
  process.env.CPANEL_SMTP_USER = 'uno@dominio-a.com';
  process.env.CPANEL_SMTP_PASS = 'secreto1';
  process.env.CPANEL_SMTP_HOST = 'mail.dominio-a.com';
  process.env.CPANEL_SMTP_PORT = '465';
  process.env.CPANEL_SMTP_USER2 = 'dos@dominio-b.com';
  process.env.CPANEL_SMTP_PASS2 = 'secreto2';
  process.env.CPANEL_SMTP_HOST2 = 'smtp.dominio-b.com';
  process.env.CPANEL_SMTP_PORT2 = '465';
}

/* Sustituye createTransport por una fábrica que etiqueta cada transporte
   falso con su host, para poder saber luego POR CUÁL se mandó cada correo. */
function falsearTransportes({ falla = [] } = {}) {
  const llamadas = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = (opts) => {
    const host = opts.host || opts.service;
    return {
      sendMail: async (msg) => {
        llamadas.push({ host, msg });
        if (falla.includes(host)) throw Object.assign(new Error(`fallo simulado en ${host}`), { code: 'ECONNECTION' });
        return { messageId: `fake-${host}-${llamadas.length}` };
      },
      verify: async () => {
        if (falla.includes(host)) throw Object.assign(new Error(`fallo simulado en ${host}`), { code: 'ECONNECTION' });
        return true;
      },
    };
  };
  return { llamadas, restaurar: () => { nodemailer.createTransport = original; } };
}

test('con dos buzones, los envíos alternan uno por uno (round-robin)', async () => {
  const guardado = { ...process.env };
  limpiarEnv();
  ponerDosBuzones();
  const { llamadas, restaurar } = falsearTransportes();
  email.reiniciar();

  try {
    for (let i = 0; i < 4; i++) {
      const r = await email.sendMail({ to: 'destino@correo.com', subject: 'Prueba', html: '<p>hola</p>' });
      assert.equal(r.ok, true, `el envío ${i} debería salir OK`);
    }
    const hosts = llamadas.map(l => l.host);
    assert.deepEqual(hosts, ['mail.dominio-a.com', 'smtp.dominio-b.com', 'mail.dominio-a.com', 'smtp.dominio-b.com'],
      'debe alternar A, B, A, B — no quedarse siempre en el mismo buzón');
  } finally {
    restaurar();
    email.reiniciar();
    Object.assign(process.env, guardado);
  }
});

test('si al buzón que le toca el turno falla, se intenta el otro antes de rendirse', async () => {
  const guardado = { ...process.env };
  limpiarEnv();
  ponerDosBuzones();
  const { llamadas, restaurar } = falsearTransportes({ falla: ['mail.dominio-a.com'] });
  email.reiniciar();

  try {
    const r = await email.sendMail({ to: 'destino@correo.com', subject: 'Prueba', html: '<p>hola</p>' });
    assert.equal(r.ok, true, 'debe salir OK por el buzón que sí funciona');
    assert.equal(r.via, 'smtp2', 'via debe decir cuál buzón mandó de verdad (el A falló, así que fue el B)');
    const hosts = llamadas.map(l => l.host);
    assert.deepEqual(hosts, ['mail.dominio-a.com', 'smtp.dominio-b.com'],
      'debe haber intentado el buzón A primero (y fallar) antes de caer al B');
  } finally {
    restaurar();
    email.reiniciar();
    Object.assign(process.env, guardado);
  }
});

test('si los dos buzones fallan, el error que vuelve es el real, no un "sin proveedor"', async () => {
  const guardado = { ...process.env };
  limpiarEnv();
  ponerDosBuzones();
  const { restaurar } = falsearTransportes({ falla: ['mail.dominio-a.com', 'smtp.dominio-b.com'] });
  email.reiniciar();

  try {
    const r = await email.sendMail({ to: 'destino@correo.com', subject: 'Prueba', html: '<p>hola</p>' });
    assert.equal(r.ok, false);
    assert.match(r.error, /fallo simulado/);
  } finally {
    restaurar();
    email.reiniciar();
    Object.assign(process.env, guardado);
  }
});

test('con un solo buzón configurado, el comportamiento es el de siempre (sin alternar)', async () => {
  const guardado = { ...process.env };
  limpiarEnv();
  process.env.CPANEL_SMTP_USER = 'solo@dominio-a.com';
  process.env.CPANEL_SMTP_PASS = 'secreto1';
  process.env.CPANEL_SMTP_HOST = 'mail.dominio-a.com';
  process.env.CPANEL_SMTP_PORT = '465';
  const { llamadas, restaurar } = falsearTransportes();
  email.reiniciar();

  try {
    for (let i = 0; i < 3; i++) {
      const r = await email.sendMail({ to: 'destino@correo.com', subject: 'Prueba', html: '<p>hola</p>' });
      assert.equal(r.ok, true);
      assert.equal(r.via, 'cpanel');
    }
    assert.deepEqual(llamadas.map(l => l.host), ['mail.dominio-a.com', 'mail.dominio-a.com', 'mail.dominio-a.com']);
  } finally {
    restaurar();
    email.reiniciar();
    Object.assign(process.env, guardado);
  }
});
