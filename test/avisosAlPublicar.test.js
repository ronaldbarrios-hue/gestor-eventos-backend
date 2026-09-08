/* Lo que se avisa al publicar, y por qué no se bloquea.
 *
 * ── Lo que ya había ──────────────────────────────────────────────────────
 *
 * Publicar sólo comprobaba el PERMISO. Se podía publicar un evento sin una
 * sola forma de inscribirse —pasó con un evento real— y quien llegaba a la
 * página la leía entera sin encontrar qué pulsar.
 *
 * ── Lo que faltaba ───────────────────────────────────────────────────────
 *
 * Esos avisos miraban sólo el evento. Un SUB-EVENTO se puede publicar igual de
 * roto, y con la misma forma de fallar: no hay error, hay una actividad a la
 * que nadie se puede apuntar. Los dos casos de abajo salen de la base de hoy,
 * no están inventados.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const RUTA = leer('routes/eventos.js');
/* El cálculo vive en su propio módulo. Estaba dentro de la ruta, y por eso la
   herramienta del agente —que publica por su cuenta— no avisaba de nada. */
const BLOQUE = leer('lib/avisosDePublicacion.js');
const AGENTE = leer('lib/agente.js');

test('avisa, no bloquea', () => {
  /* Hay motivos legítimos para publicar antes de abrir inscripciones: una
     página de aviso, un evento con registro por fuera. Decidirlo por el
     organizador sería pasarse. */
  const sin = sinComentarios(BLOQUE);
  assert.doesNotMatch(sin, /return res\.status\(400\)/);
  assert.match(sin, /avisos\.push\(/);
});

test('un sub-evento con «preguntas propias» y ninguna escrita se avisa', () => {
  /* Se comporta igual que «no preguntar nada», y quien lo eligió cree que sí
     pregunta. Hoy hay uno así en la base. */
  const sin = sinComentarios(BLOQUE);
  assert.match(sin, /formulario_modo === 'propio'/);
  assert.match(sin, /pide preguntas propias y no tiene ninguna/);
});

test('y uno atado a una boleta pausada también', () => {
  /* La actividad se ve y no se puede entrar, y el motivo está en otra
     pantalla. */
  assert.match(sinComentarios(BLOQUE), /t\.activo === false/);
  assert.match(BLOQUE, /está pausada: nadie podrá apuntarse/);
});

test('avisa si hay boletas de pago y ninguna cuenta de cobro', () => {
  /* Las dos pasarelas lo rechazan antes de emitir, así que no se pierde ninguna
     venta a medias — pero quien compra se lleva «el organizador aún no conectó
     Mercado Pago» después de llenar el formulario entero, y el organizador no
     se entera hasta que alguien se queja.
     Salió montando un concierto de prueba: 124 sitios de pago y cero
     pasarelas, y nada lo decía. */
  const sin = sinComentarios(BLOQUE);
  assert.match(sin, /\.gt\('precio', 0\)/);
  assert.match(sin, /mp_access_token, wompi_public_key/);
  assert.match(BLOQUE, /nadie podrá pagar/);
});

test('y si el plano tiene sitios sin precio', () => {
  /* Una unidad vendible sin localidad no la puede comprar nadie: el servidor
     no sabe qué cobrar. El plano se ve lleno y la venta simplemente no ocurre
     — sin ningún error. */
  const sin = sinComentarios(BLOQUE);
  assert.match(sin, /\.eq\('modo', 'vendible'\)/);
  assert.match(sin, /ticket_type_espacios/);
  assert.match(BLOQUE, /no se pueden comprar/);
});

test('el aviso dice de qué sub-evento habla', () => {
  /* «Un sub-evento tiene un problema» en un evento con quince obliga a
     abrirlos uno a uno. */
  assert.match(BLOQUE, /\$\{s\.titulo\}/);
});

test('sólo mira los que piden inscripción', () => {
  /* Un sub-evento sin inscripción no tiene nada roto por no tener preguntas:
     avisar de eso sería ruido en cada publicación. */
  assert.match(sinComentarios(BLOQUE), /filter\(s => s\.requiere_inscripcion\)/);
});

test('contar lo que falta no puede tumbar una publicación autorizada', () => {
  /* Va todo dentro del try, y después de escribir el estado. Un fallo contando
     avisos dejaría el evento sin publicar por un mensaje de cortesía. */
  const i = RUTA.indexOf('let avisos = []');
  const antes = RUTA.slice(0, i);
  assert.ok(antes.includes(".from('eventos').update(updates)"),
    'los avisos se calculan ANTES de escribir el estado');
  assert.match(BLOQUE, /catch \(e\)/);
  assert.doesNotMatch(BLOQUE, /throw/);
});

test('los DOS caminos de publicar avisan lo mismo', () => {
  /* El panel y la herramienta del agente. La segunda hace su propio `update`
     contra la base, así que no pasaba por los avisos: comprobado publicando un
     concierto de prueba desde el agente —124 boletas de pago y cero cuentas de
     cobro— y no dijo nada. El camino más rápido para publicar era el único que
     no avisaba. */
  assert.match(RUTA, /avisosDePublicacion\(req\.params\.id, data\)/);
  assert.match(AGENTE, /avisosDePublicacion\(data\.id, data\)/);
  /* Y la herramienta los devuelve, no sólo los calcula. */
  const fn = AGENTE.slice(AGENTE.indexOf('async publicar_evento'), AGENTE.indexOf('async publicar_evento') + 2200);
  assert.match(fn, /avisos,/);
  /* Con los campos que los avisos necesitan: sin `owner_id` no se puede mirar
     si hay cuenta de cobro. */
  assert.match(fn, /owner_id, fecha_inicio, location_nombre, modalidad, url_virtual/);
});
