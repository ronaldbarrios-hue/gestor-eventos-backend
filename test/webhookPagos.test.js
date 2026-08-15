const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* El webhook de Mercado Pago era un amplificador abierto a internet.

   Cuando el aviso trae un `payment_id` que no está en `payment_transactions`,
   el código prueba el pago contra el token de CADA organizador conectado. Y ese
   no es un caso raro: la fila se crea con `preference_id` y sin `payment_id`,
   así que el PRIMER aviso de cada pago cae siempre ahí.

   Con eso, una petición barata —un id inventado, sin autenticar— costaba una
   llamada saliente a Mercado Pago por organizador conectado. El limitador no
   lo frenaba porque el webhook responde 200 antes de procesar y `authLimiter`
   lleva `skipSuccessfulRequests`.

   El arreglo no fue quitar el recorrido (rompería los pagos) sino exigirle
   firma verificada. Estas pruebas vigilan las dos mitades: que el recorrido
   siga detrás del guardia, y que el limitador del webhook cuente de verdad.

   Se miden sobre el código fuente, como `montaje.test.js`, porque el riesgo
   está en la forma del archivo y no en un valor que se pueda llamar. */

const RAIZ = path.join(__dirname, '..');
const pagos = fs.readFileSync(path.join(RAIZ, 'routes', 'pagos.js'), 'utf8');
const seguridad = fs.readFileSync(path.join(RAIZ, 'config', 'security.js'), 'utf8');

/* El recorrido caro: leer todos los perfiles con token de MP. */
const RE_FAN_OUT = /\.from\(\s*'profiles'\s*\)\s*\.select\(\s*'id, mp_access_token'\s*\)/;
/* El guardia que lo protege. */
const RE_GUARDIA = /if\s*\(\s*!MP_WEBHOOK_SECRET\s*\)\s*\{[^}]*return;?[^}]*\}/;

test('la prueba sigue reconociendo el recorrido caro del webhook', () => {
  assert.ok(
    RE_FAN_OUT.test(pagos),
    'ya no se encuentra el barrido de tokens en pagos.js: si se quitó, borra esta prueba; si se reescribió, actualiza la expresión'
  );
});

test('el barrido de tokens de todos los organizadores exige firma verificada', () => {
  const iFanOut = pagos.search(RE_FAN_OUT);
  assert.ok(iFanOut > 0, 'no se localizó el barrido');

  /* El guardia tiene que estar ANTES del barrido y dentro del mismo manejador.
     Se busca hacia atrás desde el barrido, no en todo el archivo: hay otros
     `if (!MP_WEBHOOK_SECRET)` (el aviso de arranque y la firma) que no
     protegen nada aquí. */
  const antes = pagos.slice(0, iFanOut);
  const iManejador = antes.lastIndexOf("router.post('/webhooks/mercadopago'");
  assert.ok(iManejador > 0, 'no se localizó el manejador del webhook');

  const tramo = antes.slice(iManejador);
  assert.ok(
    RE_GUARDIA.test(tramo),
    'el barrido de tokens quedó accesible sin MP_WEBHOOK_SECRET: cualquiera con la URL puede provocar una llamada a Mercado Pago por cada organizador conectado'
  );
});

test('el webhook pasa por un limitador propio', () => {
  assert.match(
    pagos,
    /router\.post\(\s*'\/webhooks\/mercadopago'\s*,\s*webhookLimiter/,
    'el webhook perdió su limitador'
  );
});

test('el limitador del webhook cuenta también las peticiones que responden 200', () => {
  const i = seguridad.indexOf('const webhookLimiter');
  assert.ok(i > 0, 'no existe webhookLimiter en config/security.js');
  const bloque = seguridad.slice(i, i + 400);
  assert.ok(
    !/skipSuccessfulRequests\s*:\s*true/.test(bloque),
    'webhookLimiter con skipSuccessfulRequests: el webhook siempre responde 200, así que no contaría nada y no protegería de nada'
  );
});
