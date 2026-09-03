#!/usr/bin/env node
'use strict';

/* scripts/cron-recordatorios.js — una pasada de recordatorios, y se muere.
 *
 * Es lo que llama el cron de cPanel cada quince minutos. Sustituye al
 * `node-cron` que hoy vive dentro del proceso, y no por gusto: en cPanel
 * Passenger duerme la aplicación cuando nadie la usa, y un planificador dentro
 * de un proceso dormido no corre. El fallo sería silencioso y sólo aparecería
 * cuando hay poca actividad — o sea, de madrugada, que es cuando salen los
 * recordatorios del día siguiente.
 *
 * En el cron de cPanel, cada quince minutos. La línea exacta está en
 * DESPLIEGUE-CPANEL.md — aquí no se puede escribir porque la expresión lleva
 * una barra pegada a un asterisco y eso cierra este comentario.
 *
 * La ruta de `node` sale de «Setup Node.js App» → botón de copiar el comando
 * de entorno; NO es el `node` del sistema, que suele ser más viejo.
 *
 * Sale con código 1 si el ciclo falla, para que el cron lo marque como fallido
 * y se vea en el panel en vez de perderse en un log que nadie abre.
 */

require('dotenv').config();

const { correrCicloRecordatorios } = require('../lib/recordatorios.js');
const { barrerOauth } = require('../lib/oauthBarrido.js');

const inicio = Date.now();

correrCicloRecordatorios()
  .then(async () => {
    /* De paso, el barrido de OAuth. La 0073 dejó `oauth_barrer()` escrita
       diciendo que la llamaría «el mismo ciclo que ya corre cada quince
       minutos», y ese paso nunca se dio: `oauth_codes` y `oauth_tokens`
       llevan creciendo sin límite desde entonces.

       Va DESPUÉS y en su propio `try`: los recordatorios son lo que la gente
       nota si falla, y perder un ciclo de correos porque no se pudo borrar un
       token caducado sería cambiar un problema silencioso por uno visible. */
    try {
      await barrerOauth();
    } catch (e) {
      console.error(`[cron] recordatorios: el barrido de OAuth falló — ${e.message}`);
    }
    console.log(`[cron] recordatorios: ciclo completo en ${Date.now() - inicio} ms — ${new Date().toISOString()}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[cron] recordatorios: FALLÓ tras ${Date.now() - inicio} ms — ${e.message}`);
    process.exit(1);
  });
