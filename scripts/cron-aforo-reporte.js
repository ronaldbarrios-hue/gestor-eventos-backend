#!/usr/bin/env node
'use strict';

/* scripts/cron-aforo-reporte.js — una pasada del reporte automático de aforo, y se muere.
 *
 * Mismo patrón que scripts/cron-recordatorios.js: Passenger duerme la app
 * cuando nadie la usa, así que un planificador dentro de un proceso dormido
 * no corre. Esto lo llama el cron de cPanel, cada quince minutos —la
 * cadencia real por evento la decide lib/aforoReporteAuto.js (mínimo 60 min),
 * este script sólo ofrece la oportunidad seguido.
 *
 * Sale con código 1 si el ciclo falla, para que el cron lo marque como
 * fallido y se vea en el panel en vez de perderse en un log que nadie abre.
 */

require('dotenv').config();

const { correrCicloReporteAforo } = require('../lib/aforoReporteAuto.js');

const inicio = Date.now();

correrCicloReporteAforo()
  .then(({ eventos_revisados, cortes_escritos }) => {
    console.log(`[cron] aforo-reporte: ${eventos_revisados} evento(s) revisado(s), ${cortes_escritos} corte(s) escrito(s) en ${Date.now() - inicio} ms — ${new Date().toISOString()}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[cron] aforo-reporte: FALLÓ tras ${Date.now() - inicio} ms — ${e.message}`);
    process.exit(1);
  });
