/* GESTEK — Guardar secretos de terceros sin poder leerlos por accidente.

   Lo usan las credenciales que el organizador nos confía: la contraseña de su
   buzón de correo, su llave de Anthropic, y lo que venga después. Estaba
   escrito dentro de smtpEvento.js; al aparecer el segundo secreto se saca
   aquí, porque copiar criptografía es exactamente como se acaba teniendo una
   versión buena y otra con un fallo.

   AES-256-GCM, no sólo cifrado: GCM además AUTENTICA. Si alguien altera la
   fila en la base, el descifrado falla en vez de devolver basura que el resto
   del código trataría como una contraseña.

   La llave vive en SMTP_CRYPTO_KEY (el nombre se queda por compatibilidad con
   lo ya desplegado, aunque ahora cifre más cosas). Si cambia o se pierde,
   TODOS los secretos guardados dejan de poder descifrarse y cada organizador
   tiene que volver a escribir los suyos. Es del mismo tipo que QR_JWT_SECRET:
   se genera una vez y no se rota a la ligera. */

const crypto = require('crypto');

function llave() {
  const hex = process.env.SMTP_CRYPTO_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

const listo = () => Boolean(llave());

function cifrar(texto) {
  const k = llave();
  if (!k) throw new Error('Falta SMTP_CRYPTO_KEY en el servidor (32 bytes en hexadecimal).');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv.toString('hex'), c.getAuthTag().toString('hex'), datos.toString('hex')].join(':');
}

function descifrar(guardado) {
  const k = llave();
  if (!k) throw new Error('Falta SMTP_CRYPTO_KEY en el servidor.');
  const [ivHex, tagHex, datosHex] = String(guardado || '').split(':');
  if (!ivHex || !tagHex || !datosHex) throw new Error('El secreto guardado está corrupto.');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(datosHex, 'hex')), d.final()]).toString('utf8');
}

/* Para enseñar en pantalla sin enseñar el secreto: «sk-ant-…4f2a».
   Nunca se devuelve el valor entero, ni siquiera a su dueño — si lo perdió,
   genera otro donde lo generó. */
function pista(secreto) {
  const s = String(secreto || '');
  if (s.length <= 12) return '••••';
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
}

module.exports = { cifrar, descifrar, listo, pista };
