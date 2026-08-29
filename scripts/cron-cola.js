#!/usr/bin/env node
'use strict';

/* scripts/cron-cola.js — una pasada de la cola de correo, y se muere.
 *
 * La cola va cada minuto y aparte de los recordatorios a propósito: su gracia
 * es repartir los envíos en el tiempo. Con la cadencia de quince minutos, los
 * correos saldrían a ráfagas, que es justo lo que la cola existe para evitar —
 * y lo que hace que un proveedor de SMTP corte por spam.
 *
 * Cada minuto, en el cron de cPanel. La línea exacta está en
 * DESPLIEGUE-CPANEL.md.
 *
 * Si la cola está apagada (`EMAIL_COLA_ACTIVA` sin poner), esto no hace nada y
 * sale en silencio: el envío es directo y no hay nada que drenar.
 */

require('dotenv').config();

const { drenarCola } = require('../lib/recordatorios.js');

drenarCola()
  .then((r) => {
    /* Sólo se imprime si hubo algo. Un cron que escribe una línea cada minuto
       llena el disco de la cuenta —9,81 GB compartidos con todo lo demás— con
       medio millón de líneas al año que dicen «nada que hacer». */
    if (r?.enviados || r?.fallidos) {
      console.log(`[cron] cola: ${r.enviados} enviados, ${r.fallidos} fallidos — ${new Date().toISOString()}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[cron] cola: FALLÓ — ${e.message}`);
    process.exit(1);
  });
