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

const inicio = Date.now();

correrCicloRecordatorios()
  .then(() => {
    console.log(`[cron] recordatorios: ciclo completo en ${Date.now() - inicio} ms — ${new Date().toISOString()}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[cron] recordatorios: FALLÓ tras ${Date.now() - inicio} ms — ${e.message}`);
    process.exit(1);
  });
