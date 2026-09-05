/* Un aviso de pago que llega dos veces no puede cobrar dos veces.
 *
 * ── El riesgo ────────────────────────────────────────────────────────────
 *
 * Las pasarelas REINTENTAN. Wompi lo hace, y dos avisos pueden llegar a la
 * vez. La guarda que había —leer el ticket, comprobar que no está pagado, y
 * después escribir— deja un hueco entre la lectura y la escritura: los dos
 * avisos leen «emitido», los dos pasan, y todo lo de después corre DOS VECES.
 *
 * Y lo de después mueve números que importan: el aforo del evento sube dos, los
 * `vendidos` del tipo suben dos, el código de descuento se gasta dos veces, y a
 * la persona le llegan dos correos con su entrada. En dinero, contar de más es
 * peor que no contar.
 *
 * ── La cerradura ─────────────────────────────────────────────────────────
 *
 * `.neq('estado','pagado')` DENTRO del propio `update`: comparar y escribir
 * pasan a ser una sola operación en la base. El segundo aviso no encuentra
 * ninguna fila y se va sin hacer nada.
 *
 * Comprobado en Postgres con dos `update` condicionales seguidos sobre la
 * misma fila: el primero actualiza 1, el segundo 0.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'confirmarTicket.js'), 'utf8');

test('la marca de pagada es la cerradura, no una comprobación previa', () => {
  assert.match(SRC, /\.eq\('id', ticketId\)\.neq\('estado', 'pagado'\)\.select\('id'\)/,
    'volvió a marcarse como pagada sin condición: dos avisos a la vez cobran dos veces');
  assert.match(SRC, /if \(!marcada \|\| marcada\.length === 0\) \{/,
    'no se mira si el update tocó alguna fila: el segundo aviso seguiría adelante igual');
});

test('lo que mueve números va DESPUÉS de la cerradura', () => {
  /* Si el aforo, los `vendidos`, el consumo del código o el correo quedaran
     por encima, la cerradura no serviría de nada. */
  const iCerradura = SRC.indexOf("neq('estado', 'pagado')");
  /* Se busca la LLAMADA, no el nombre: los `require` de arriba contienen los
     mismos nombres y estarían siempre por encima de la cerradura. */
  for (const [que, marca] of [
    ['el consumo del código de descuento', 'await consumirPromocion('],
    ['la suma al aforo del evento', 'aforo_vendido:'],
    ['la suma a los vendidos del tipo', 'vendidos: (tt.vendidos'],
    ['el correo con la entrada', 'enviarEmailEvento({'],
  ]) {
    const i = SRC.indexOf(marca);
    assert.ok(i > 0, `no encuentro «${marca}»: ¿se renombró? La prueba se quedó vieja`);
    assert.ok(i > iCerradura, `${que} quedó por encima de la cerradura: se haría dos veces`);
  }
});

test('la firma del proveedor se sigue comprobando', () => {
  /* Sin esto, cualquiera que sepa el id de una boleta la marca como pagada
     mandando un POST. La cerradura de arriba no protege de eso. */
  const wompi = fs.readFileSync(path.join(__dirname, '..', 'routes', 'wompi.js'), 'utf8');
  assert.match(wompi, /if \(!verificarEvento\(req\.body, owner\?\.wompi_events_secret\)\)/,
    'el webhook de Wompi dejó de verificar el checksum del proveedor');
});

/* ── La misma clase de fallo, en las otras dos puertas ──────────────────── */

test('la boleta se marca «usada» con cerradura, no con un `if` previo', () => {
  /* En un evento hay VARIAS puertas escaneando a la vez, y encima la cola sin
     conexión se vacía sola al volver la red. Dos escaneos del mismo QR leían
     los dos «pagado», los dos pasaban, y fallaba justo lo que este control
     existe para impedir: la misma boleta entrando dos veces sin que nadie se
     entere. Y de paso, dos ingresos contados y los puntos de asistencia
     pagados dos veces. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'clientes.js'), 'utf8');
  assert.match(src, /\.eq\('id', ticket\.id\)\s*\n\s*\.neq\('estado', 'usado'\)/,
    'el check-in volvió a marcar «usada» sin condición: dos escáneres a la vez dejarían entrar dos veces');
  assert.match(src, /if \(!marcadas \|\| marcadas\.length === 0\) \{/,
    'no se mira si el update tocó alguna fila');
  assert.match(src, /ya_usada: true,[\s\S]{0,200}\}\);\s*\n\s*\}\s*\n\s*const updated = marcadas\[0\]/,
    'el segundo escaneo ya no cae en el mismo 409 de «ya fue usada»');
});

test('el cupo de un sub-evento se confirma DESPUÉS de insertar', () => {
  /* Leer el contador y después insertar deja pasar a dos personas por la
     última plaza. En un taller eso son dos sillas para una, y se descubre en
     la puerta del taller.
     Comprobado en Postgres: con una plaza libre y dos compitiendo, se queda
     exactamente una. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sesiones.js'), 'utf8');
  assert.match(src, /\.lt\('created_at', inscripcion\.created_at\)/,
    'ya no se cuenta cuántas entraron antes: no hay forma de decidir quién sobra');
  assert.match(src, /await supabase\.from\('sesion_inscripciones'\)\.delete\(\)\.eq\('id', inscripcion\.id\)/,
    'la inscripción que se pasa del cupo ya no se deshace');
});

test('el enlace de cupo de la lista de espera se quema una sola vez', () => {
  /* `validarOferta` sólo LEE. El enlace llega por correo, se abre en el móvil,
     y pulsar dos veces un botón que tarda es lo normal. Las dos peticiones
     pasaban la validación — y también `hayCupoLibre`, porque a quien trae el
     token se le descuenta su propia oferta a propósito: éste es el ÚNICO
     camino donde el control de aforo está desactivado por diseño. Un cupo
     ofrecido salía en dos boletas y el desajuste aparecía en la puerta.

     Comprobado en Postgres: dos updates condicionales sobre la misma fila,
     primera 1 fila, segunda 0. */
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'waitlistOferta.js'), 'utf8');
  assert.match(lib, /\.eq\('id', waitlistId\)\.eq\('estado', 'contacted'\)\.select\('id'\)/,
    'consumirOferta volvió a escribir sin condición: el mismo enlace serviría dos veces');
  assert.match(lib, /return Boolean\(data && data\.length\);/,
    'consumirOferta ya no dice quién se llevó el cupo');

  for (const ruta of ['eventos.publicos.js', 'pagos.js', 'wompi.js']) {
    /* Sin los retornos de carro: los archivos están en CRLF, y un patrón que
       lleve un salto de línea no casaría nunca — o sea una prueba que pasa
       por no encontrar nada. */
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', ruta), 'utf8').replace(/\r/g, '');
    assert.match(src, /if \(oferta\w* && !\(await consumirOferta\(oferta\w*\.id\)\)\) \{[\s\S]{0,300}status\(409\)/,
      `${ruta}: el token de la lista de espera dejó de quemarse con candado`);
    /* Antes de emitir, no después: si se quema después, la segunda petición ya
       creó su boleta y quemarlo no deshace nada. */
    const iQuema = src.indexOf('consumirOferta(oferta');
    const iAlta  = src.indexOf(".from('tickets')\n    .insert(") >= 0
      ? src.indexOf(".from('tickets')\n    .insert(")
      : src.indexOf(".from('tickets').insert(");
    assert.ok(iQuema > 0 && iAlta > 0 && iQuema < iAlta,
      `${ruta}: el cupo se quema DESPUÉS de emitir la boleta, así que la segunda ya salió`);
  }
});
