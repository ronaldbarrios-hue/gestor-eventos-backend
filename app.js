'use strict';

/* app.js — el arranque en cPanel, por Passenger.
 *
 * ── Por qué existe este archivo y no se usa index.js ─────────────────────
 *
 * En cPanel, «Setup Node.js App» arranca la aplicación con Passenger, y
 * Passenger la ejecuta como el archivo principal. `index.js` ya sirve para
 * eso... pero hace dos cosas más que en cPanel no queremos: abrir el puerto a
 * mano, y encender el planificador de recordatorios dentro del proceso.
 *
 * Lo segundo es lo importante. **Passenger duerme la aplicación cuando nadie
 * la usa**, y un `node-cron` que vive dentro de un proceso dormido no corre.
 * Los recordatorios saldrían tarde o no saldrían, y peor: sólo fallaría cuando
 * hay poca actividad, que es justo cuando nadie está mirando. Por eso en cPanel
 * los ciclos salen a los *Trabajos de cron* del panel, que los ejecuta el
 * sistema operativo pase lo que pase (`scripts/cron-recordatorios.js` y
 * `scripts/cron-cola.js`).
 *
 * Lo primero, el puerto, lo pone Passenger en `process.env.PORT`.
 *
 * ── Lo que este archivo NO arregla ───────────────────────────────────────
 *
 * Passenger también tiene arranque en frío: la primera petición después de un
 * rato despierta el proceso. La diferencia con Render, que es lo medido, es de
 * escala: allí son **21,4 segundos** —levantar un contenedor entero— y aquí es
 * arrancar un Node que ya tiene el disco caliente, del orden de un segundo.
 * Esa diferencia es la razón de esta fase: es lo que quita el congelamiento sin
 * tocar ni una línea de la interfaz.
 */

const app = require('./index.js');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[cPanel] GESTEK API escuchando en ${PORT} (Passenger)`);
  console.log('[cPanel] los recordatorios NO corren aquí: van en los Trabajos de cron del panel.');
});
