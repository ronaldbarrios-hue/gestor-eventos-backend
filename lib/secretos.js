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
  const hex = (process.env.SMTP_CRYPTO_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

const listo = () => Boolean(llave());

/* Por qué NO está lista, en cristiano.

   Antes esto sólo devolvía «falta SMTP_CRYPTO_KEY», que es exactamente el
   mensaje que no ayuda cuando la variable SÍ está puesta pero mal. Pasó de
   verdad: alguien pegó la llave dos veces seguidas —128 caracteres en vez de
   64— y el panel decía que faltaba, cuando lo que sobraba era la mitad.

   AES-256 quiere una llave de 32 bytes, que en hexadecimal son 64 caracteres
   exactos. Ni 63 ni 128. */
function diagnostico() {
  const bruto = process.env.SMTP_CRYPTO_KEY || '';
  const hex = bruto.trim();

  if (!hex) {
    return { listo: false, motivo: 'sin_definir',
      mensaje: 'Falta SMTP_CRYPTO_KEY en el servidor.',
      arreglo: 'Genérala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' };
  }
  if (hex !== bruto) {
    return { listo: false, motivo: 'espacios',
      mensaje: 'SMTP_CRYPTO_KEY tiene espacios o un salto de línea alrededor.',
      arreglo: 'Vuelve a pegarla sin espacios ni comillas.' };
  }
  if (!/^[0-9a-f]+$/i.test(hex)) {
    return { listo: false, motivo: 'no_hex',
      mensaje: 'SMTP_CRYPTO_KEY tiene caracteres que no son hexadecimales.',
      arreglo: 'Sólo dígitos del 0 al 9 y letras de la a a la f. Genérala con el comando de arriba.' };
  }
  if (hex.length !== 64) {
    /* La mitad exacta repetida es el fallo de copiado más común. */
    const mitad = hex.length / 2;
    const duplicada = hex.length === 128 && hex.slice(0, mitad) === hex.slice(mitad);
    return {
      listo: false, motivo: 'longitud',
      mensaje: duplicada
        ? `SMTP_CRYPTO_KEY está pegada dos veces: tiene ${hex.length} caracteres y son la misma mitad repetida.`
        : `SMTP_CRYPTO_KEY tiene ${hex.length} caracteres y hacen falta exactamente 64.`,
      arreglo: duplicada
        ? 'Deja sólo la primera mitad — o, mejor, genera una nueva: si se pegó mal, puede haber quedado a la vista en algún sitio.'
        : 'AES-256 usa 32 bytes, que en hexadecimal son 64 caracteres.',
    };
  }
  return { listo: true };
}

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

module.exports = { cifrar, descifrar, listo, pista, diagnostico };
