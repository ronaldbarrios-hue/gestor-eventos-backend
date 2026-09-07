/* Heredar lo ya contestado, para no preguntarlo dos veces.
 *
 * ── El mapa, medido antes de escribir esto ───────────────────────────────
 *
 *   Boleta → inscripción a un sub-evento   identidad SÍ · respuestas NO
 *   Boleta → ficha de expositor (trigger)  nombre y correo SÍ · respuestas NO
 *   Boleta → equipo del torneo (trigger)   nombre y correo SÍ · respuestas NO
 *
 * La identidad viajaba a todas partes y las respuestas a ninguna.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  claveDeEtiqueta, tieneValor, porEtiqueta, prellenar,
  cabeEnElCampo, prellenarValidando, TIPOS_QUE_NO_SE_HEREDAN,
} = require('../lib/heredarRespuestas.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('la misma pregunta escrita de dos maneras es la misma pregunta', () => {
  /* Quien escribió los dos formularios es la misma persona en dos momentos
     distintos: «Empresa:» y «empresa» son el mismo campo para todo el mundo
     menos para un `===`. */
  const igual = (a, b) => assert.equal(claveDeEtiqueta(a), claveDeEtiqueta(b), `${a} ≠ ${b}`);
  igual('Empresa', 'empresa');
  igual('Empresa:', '  Empresa  ');
  igual('¿Ocupación?', 'Ocupacion');
  igual('Ciudad *', 'ciudad');
});

test('dos preguntas distintas siguen siendo distintas', () => {
  /* La normalización tiene un límite: si limara de más, el «Nombre de la
     empresa» del taller se rellenaría con el «Nombre» del evento. */
  assert.notEqual(claveDeEtiqueta('Empresa'), claveDeEtiqueta('Nombre de la empresa'));
  assert.notEqual(claveDeEtiqueta('Ciudad'), claveDeEtiqueta('Ciudad de nacimiento'));
});

test('se cruza por etiqueta porque los ids no se pueden compartir', () => {
  /* El «Empresa» del evento y el «Empresa» del taller son filas distintas de
     `event_form_fields`: no comparten id ni lo pueden compartir. */
  const origen = [{ id: 'e1', tipo: 'texto', etiqueta: 'Empresa' }];
  const destino = [{ id: 't9', tipo: 'texto', etiqueta: 'empresa' }];
  const sabido = porEtiqueta(origen, { e1: 'Café del Tolima' });
  assert.deepEqual(prellenar({ camposDestino: destino, sabido }), { t9: 'Café del Tolima' });
});

test('sólo sale lo que ESTE formulario pregunta', () => {
  /* Mismo criterio que el prellenado por documento: lo que se sepa de más no
     sale nunca. Aquí es más delicado todavía, porque el origen es el formulario
     completo del evento —con su ficha de caracterización si la tiene—. */
  const origen = [
    { id: 'e1', tipo: 'texto', etiqueta: 'Empresa' },
    { id: 'e2', tipo: 'texto', etiqueta: 'Discapacidad' },
  ];
  const destino = [{ id: 't9', tipo: 'texto', etiqueta: 'Empresa' }];
  const sabido = porEtiqueta(origen, { e1: 'Acme', e2: 'Ninguna' });
  const out = prellenar({ camposDestino: destino, sabido });
  assert.deepEqual(Object.keys(out), ['t9']);
});

test('un consentimiento no se arrastra a otra inscripción', () => {
  /* Se da para algo concreto. Heredarlo es firmar por alguien. */
  assert.ok(TIPOS_QUE_NO_SE_HEREDAN.has('checkbox'));
  const origen = [{ id: 'e1', tipo: 'checkbox', etiqueta: 'Acepto los términos' }];
  const destino = [{ id: 't1', tipo: 'checkbox', etiqueta: 'Acepto los términos' }];
  const sabido = porEtiqueta(origen, { e1: true });
  assert.deepEqual(prellenar({ camposDestino: destino, sabido }), {});
});

test('lo que ya está escrito manda', () => {
  /* Esto rellena huecos, no corrige a nadie: pisar lo que alguien acaba de
     teclear es peor que no prellenar nada. */
  const sabido = new Map([['empresa', 'Acme']]);
  const destino = [{ id: 't1', tipo: 'texto', etiqueta: 'Empresa' }];
  assert.deepEqual(prellenar({ camposDestino: destino, sabido, yaEscrito: { t1: 'Otra S.A.' } }), {});
  assert.deepEqual(prellenar({ camposDestino: destino, sabido, yaEscrito: { t1: '' } }), { t1: 'Acme' });
});

test('«no» y «cero» son respuestas, no huecos', () => {
  /* Tratarlos como vacío borraría una respuesta dada — y en un formulario de
     caracterización, «0» y «no» son la mayoría. */
  assert.equal(tieneValor(false), true);
  assert.equal(tieneValor(0), true);
  assert.equal(tieneValor(''), false);
  assert.equal(tieneValor('   '), false);
  assert.equal(tieneValor([]), false);
  assert.equal(tieneValor(null), false);
});

test('un valor que ya no está entre las opciones no se hereda', () => {
  /* La lista pudo cambiar entre un formulario y otro. Meterlo dejaría un campo
     que PARECE contestado y que el servidor rechaza al enviar — el peor de los
     dos mundos: trabajo hecho que hay que deshacer. */
  const campo = { id: 't1', tipo: 'select', etiqueta: 'Ciudad', opciones: ['Ibagué', 'Bogotá'] };
  assert.equal(cabeEnElCampo(campo, 'Ibagué'), true);
  assert.equal(cabeEnElCampo(campo, 'Medellín'), false);
  /* Sin opciones —un texto libre— cabe cualquier cosa. */
  assert.equal(cabeEnElCampo({ tipo: 'texto' }, 'lo que sea'), true);

  const sabido = new Map([['ciudad', 'Medellín']]);
  assert.deepEqual(prellenarValidando({ camposDestino: [campo], sabido }), {});
});

test('una multiselección se hereda entera o no se hereda', () => {
  const campo = { id: 't1', tipo: 'multi', etiqueta: 'Intereses', opciones: ['A', 'B'] };
  assert.equal(cabeEnElCampo(campo, ['A', 'B']), true);
  assert.equal(cabeEnElCampo(campo, ['A', 'Z']), false);
});

test('si un formulario repite una etiqueta, gana la primera', () => {
  /* Es la que la persona leyó primero al rellenarlo. */
  const origen = [
    { id: 'e1', tipo: 'texto', etiqueta: 'Empresa' },
    { id: 'e2', tipo: 'texto', etiqueta: 'Empresa' },
  ];
  const sabido = porEtiqueta(origen, { e1: 'Primera', e2: 'Segunda' });
  assert.equal(sabido.get('empresa'), 'Primera');
});

/* ── La ruta ─────────────────────────────────────────────────────────── */

const R = sinComentarios(leer('routes/sesiones.js'));

test('la ruta existe y es pública, como el resto del canal de la boleta', () => {
  assert.match(R, /publico\.get\('\/slug\/:slug\/sesiones\/:sesionId\/prellenar'/);
});

test('un código que no existe se contesta igual que uno sin respuestas', () => {
  /* Distinguir «no está» de «no contestó nada» es lo que haría útil probar
     códigos en serie. */
  assert.match(R, /if \(!ticket \|\| !\['pagado', 'usado', 'emitido'\]\.includes\(ticket\.estado\)\) \{[\s\S]{0,120}respuestas: \{\} \}\);/);
});

test('sin preguntas propias no se pide nada al servidor', () => {
  assert.match(R, /if \(!camposDestino\.length\) return res\.json\(\{ respuestas: \{\} \}\);/);
});

test('el destino se valida: no se manda lo que no cabe', () => {
  assert.match(R, /prellenarValidando\(\{ camposDestino, sabido \}\)/);
});
