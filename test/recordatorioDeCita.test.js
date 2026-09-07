/* Avisar de una cita antes de que empiece.
 *
 * ── Por qué esto vale ────────────────────────────────────────────────────
 *
 * En una rueda, la reunión a la que nadie se presenta es el peor resultado
 * posible: la mesa esperó, la casilla figuraba ocupada —así que nadie más pudo
 * pedirla— y no salió nada de ella. Desde la 0110 eso se mide; esto es lo
 * único que mueve ese número.
 *
 * ── Lo que hay que no romper ─────────────────────────────────────────────
 *
 * Que no se repita. El cron corre cada quince minutos: sin la marca, una
 * persona con quince citas recibiría sesenta correos por hora y a partir del
 * segundo dejaría de leerlos — incluidos los que sí importan.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const SRC = leer('lib/recordatorioDeCita.js');

/* Las constantes se LEEN del archivo en vez de importarlo: el modulo tira de
   `lib/supabase.js`, que necesita el .env y aqui no lo hay. Importarlo haria
   que estas pruebas sólo corrieran en una maquina configurada — o sea, que no
   corrieran en la que importa. */
const num = (nombre) => {
  const m = SRC.match(new RegExp(`const ${nombre} = (\\d+);`));
  assert.ok(m, `no encuentro la constante ${nombre}`);
  return Number(m[1]);
};
const MINUTOS_ANTES   = num('MINUTOS_ANTES');
const VENTANA_MIN     = num('VENTANA_MIN');
const TOPE_POR_PASADA = num('TOPE_POR_PASADA');

test('se avisa una hora antes, no la víspera', () => {
  /* Una rueda entera cabe en una mañana: avisar la víspera de quince reuniones
     es un correo que se archiva. Una hora antes es cuando alguien todavía
     puede reorganizarse o cancelar. */
  assert.equal(MINUTOS_ANTES, 60);
  /* Y la ventana es más ancha que la cadencia del cron (15 min): con una más
     estrecha, una cita podría caer entre dos pasadas y no avisarse nunca. */
  assert.ok(VENTANA_MIN > 15, `la ventana (${VENTANA_MIN} min) no cubre el hueco entre pasadas del cron`);
});

test('se marca ANTES de mandar, y con candado', () => {
  /* Si se marcara después y el envío tardara, la siguiente pasada mandaría el
     mismo aviso otra vez. Perder un recordatorio es molesto; mandar cuatro es
     lo que hace que se dejen de leer todos. */
  const iMarca = SRC.indexOf("recordatorio_at: new Date().toISOString() })\n        .eq('id', cita.id)");
  const iEnvio = SRC.indexOf('await enviarEmailEvento(');
  assert.ok(iMarca > 0 && iEnvio > iMarca,
    'el aviso se manda antes de marcarlo: el cron lo repetiría en la siguiente pasada');

  assert.match(SRC, /\.is\('recordatorio_at', null\)\s*\n\s*\.select\('id'\);/,
    'la marca dejó de ser condicional: dos pasadas a la vez mandarían dos correos');
  assert.match(SRC, /if \(!marcada \|\| marcada\.length === 0\) continue;/,
    'no se comprueba si la marca tocó alguna fila');
});

test('sólo las confirmadas', () => {
  /* Una cita pedida y sin aprobar todavía puede no existir: recordarle a
     alguien que vaya a una reunión que el equipo no ha aceptado es mandarlo a
     una mesa que no lo espera. */
  assert.match(SRC, /\.eq\('estado', 'confirmada'\)/);
});

test('a quien no tiene cuenta también se le avisa', () => {
  /* Desde la 0108 hay citas de invitados sin cuenta: su `guest_email` es su
     único canal, y son justo quienes menos contexto tienen del evento. */
  assert.match(SRC, /if \(cita\.guest_email\) \{/);
});

test('una cita sin destinatario no se mira en cada pasada', () => {
  /* Sin marcarla, el cron la volvería a leer cada quince minutos durante toda
     la mañana del evento sin poder hacer nada con ella. */
  assert.match(SRC, /if \(!quien\) \{[\s\S]{0,200}recordatorio_at: new Date\(\)\.toISOString\(\) \}\)/,
    'una cita sin correo se queda dando vueltas en el cron para siempre');
});

test('un evento con muchas citas no se come la cuota de golpe', () => {
  /* Seiscientas citas serían seiscientos correos en una sola vuelta. Lo que
     sobra se manda en la siguiente pasada: hay cuatro por hora. */
  assert.ok(TOPE_POR_PASADA <= 200, `el tope por pasada (${TOPE_POR_PASADA}) es demasiado alto`);
  assert.match(SRC, /\.slice\(0, TOPE_POR_PASADA\)/);
});

test('la hora se dice en la zona del evento', () => {
  /* Una hora escrita en la zona del servidor manda a alguien a su mesa con
     cinco horas de diferencia. */
  assert.match(SRC, /timeZone: tz/);
  assert.match(SRC, /ev\?\.timezone \|\| 'America\/Bogota'/);
});

test('una cita que falla no se lleva las otras noventa y nueve', () => {
  assert.match(SRC, /catch \(e\) \{[\s\S]{0,200}no se pudo recordar la cita/);
});

test('sin la migración, el cron no se cae', () => {
  /* Sin la 0112 la columna no existe y PostgREST contesta error. El resto del
     ciclo —los avisos del evento, la lista de espera— no tiene por qué caerse
     con esto. */
  assert.match(SRC, /¿falta la 0112\?/);
  assert.match(SRC, /return \[\];/);
});

test('cuelga del cron que ya existe', () => {
  /* Misma cadencia y una pieza menos que mantener que un tercer planificador
     para algo que mira lo mismo cada quince minutos. */
  const cron = leer('lib/recordatorios.js');
  assert.match(cron, /await correrCicloCitas\(\);/);
  assert.match(cron, /push \+ email \+ lista de espera \+ citas/);
});

test('la plantilla del recordatorio existe y lleva el sitio en el asunto', () => {
  /* Mucha gente lo lee de refilón en la notificación del móvil, de pie y con
     prisa, sin llegar a abrirlo. */
  const plantillas = leer('lib/emailPlantillas.js');
  assert.match(plantillas, /id: 'cita_recordatorio'/);
  assert.match(plantillas, /asunto:\s+'Tu cita de \{\{hora\}\} en \{\{lugar\}\}'/);
  /* Y dice cómo cancelar: quien no va a ir y lo sabe con una hora de margen
     puede liberar la casilla, que es la otra mitad de que la mesa no se quede
     sola. */
  assert.match(plantillas, /cancélala desde tus citas/);
});

test('la migración es aditiva', () => {
  const sql = leer('db/migrations/0112_recordatorio_de_la_cita.sql');
  assert.match(sql, /add column if not exists recordatorio_at timestamptz/);
  const soloSql = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(soloSql, /drop column/i);
  assert.match(sql, /-- Vuelta atrás/);
});
