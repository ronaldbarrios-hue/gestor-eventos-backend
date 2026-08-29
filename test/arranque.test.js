'use strict';

/* El arranque tiene dos formas y no pueden mezclarse:
 *
 *   · `node index.js` — desarrollo. Abre el puerto y enciende el planificador
 *     de recordatorios dentro del proceso.
 *   · `app.js` con Passenger — cPanel. Passenger pone el puerto, y los ciclos
 *     los corre el cron del panel, porque Passenger duerme la aplicación
 *     cuando nadie la usa y un planificador dormido no corre.
 *
 * Lo que estas pruebas protegen es el borde entre las dos. Si alguien quita el
 * `require.main === module` de index.js, requerirlo desde una prueba abriría un
 * puerto y encendería dos crones — y en cPanel habría dos planificadores
 * mandando los mismos recordatorios, o sea correos duplicados a los asistentes.
 * Es un fallo que no se ve en desarrollo y se ve en la bandeja de la gente. */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

test('requerir index.js no abre ningún puerto', () => {
  const app = require('../index.js');

  /* Si escuchara, `listen` habría dejado un servidor colgado y el proceso de
     pruebas no terminaría solo. Se comprueba además que lo exportado es una
     aplicación de Express y no otra cosa. */
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
  assert.ok(app._router || app.router, 'lo exportado no parece una app de Express');
});

test('index.js sólo arranca si se le llama directamente', () => {
  const fuente = leer('index.js');
  assert.match(fuente, /require\.main === module/,
    'index.js volvió a arrancar al importarlo: eso abre un puerto y enciende el cron desde cualquier prueba');
  assert.match(fuente, /module\.exports = app/);
});

test('app.js existe, escucha, y no enciende el cron', () => {
  /* Es el archivo que cPanel arranca. Si encendiera el planificador, en el
     servidor correrían a la vez el cron del panel y el de dentro del proceso, y
     cada asistente recibiría dos correos. */
  const fuente = leer('app.js');

  assert.match(fuente, /require\('\.\/index\.js'\)/);
  assert.match(fuente, /app\.listen\(/);
  assert.doesNotMatch(fuente, /iniciarCronRecordatorios/,
    'app.js no debe encender el planificador: en cPanel los ciclos van en los Trabajos de cron');
});

test('los dos scripts de cron corren una pasada y se mueren', () => {
  for (const archivo of ['scripts/cron-recordatorios.js', 'scripts/cron-cola.js']) {
    const fuente = leer(archivo);
    /* Sin `process.exit` explícito, un script que dejó una conexión abierta se
       queda vivo, y el cron acumula procesos hasta que la cuenta se queda sin
       ellos. */
    assert.match(fuente, /process\.exit\(0\)/, `${archivo} no sale al terminar`);
    assert.match(fuente, /process\.exit\(1\)/, `${archivo} no marca el fallo, y el cron lo daría por bueno`);
    assert.doesNotMatch(fuente, /cron\.schedule/, `${archivo} no debe programar nada: lo programa cPanel`);
  }
});

test('el despliegue reinicia Passenger', () => {
  /* La línea que más se olvida: sin tocar `tmp/restart.txt`, el código nuevo
     está en el disco y el proceso viejo sigue sirviendo el de antes. */
  const yml = leer('.cpanel.yml');
  assert.match(yml, /restart\.txt/);
  assert.match(yml, /npm ci/);
});
