const test = require('node:test');
const assert = require('node:assert');
const { generarICS, googleCalendarUrl, paraCorreo } = require('../lib/calendario.js');

/* El .ics es el que traslada el recordatorio al teléfono de la persona, y es
   justo el tipo de archivo que falla en silencio: Outlook lo rechaza entero si
   una línea pasa de 75 octetos o si los saltos no son CRLF, y no avisa de por
   qué. Estas pruebas cubren lo que rompe de verdad. */

const EVENTO = {
  id: 'abc-123',
  slug: 'feria-2026',
  titulo: 'Feria de Innovación 2026, con acentos; y símbolos',
  fecha_inicio: '2026-09-15T14:00:00.000Z',
  fecha_fin: '2026-09-15T23:00:00.000Z',
  location_nombre: 'Centro de Convenciones, Calle 5 #10-20',
  descripcion: 'Primera línea.\nSegunda con , coma y ; punto y coma.',
};

const ics = () => generarICS({ evento: EVENTO, url: 'https://gestek.co/explorar/feria-2026' });

test('el .ics usa CRLF y no deja ningún salto suelto', () => {
  const t = ics();
  assert.ok(t.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(t), 'un \\n suelto hace que Outlook no lo abra');
});

test('ninguna línea pasa de 75 octetos, y las continuaciones llevan espacio', () => {
  const lineas = ics().split('\r\n');
  const largas = lineas.filter(l => Buffer.from(l, 'utf8').length > 75);
  assert.equal(largas.length, 0, `hay ${largas.length} líneas demasiado largas`);
  assert.ok(lineas.some(l => l.startsWith(' ')), 'el texto largo tiene que plegarse');
});

test('se miden BYTES y no caracteres al plegar', () => {
  /* Con acentos, contar caracteres se pasa del límite sin que se note. */
  const largo = generarICS({
    evento: { ...EVENTO, titulo: 'á'.repeat(120) },
    url: 'https://gestek.co/x',
  });
  for (const l of largo.split('\r\n')) {
    assert.ok(Buffer.from(l, 'utf8').length <= 75);
  }
});

test('las comas, los puntos y coma y los saltos van escapados', () => {
  const t = ics();
  assert.ok(t.includes('\\,'), 'una coma sin escapar parte el campo');
  assert.ok(t.includes('\\;'), 'un punto y coma sin escapar parte el campo');
  assert.ok(t.includes('\\n'), 'el salto de línea va como \\n literal');
});

test('las fechas van en UTC y con el formato del RFC', () => {
  const t = ics();
  assert.ok(t.includes('DTSTART:20260915T140000Z'));
  assert.ok(t.includes('DTEND:20260915T230000Z'));
});

test('sin fecha de fin se le dan dos horas, no se deja abierto', () => {
  const t = generarICS({ evento: { ...EVENTO, fecha_fin: null }, url: 'https://x.co' });
  assert.ok(t.includes('DTSTART:20260915T140000Z'));
  assert.ok(t.includes('DTEND:20260915T160000Z'));
});

test('lleva las dos alarmas: es lo que sustituye al recordatorio por correo', () => {
  const t = ics();
  assert.equal((t.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.ok(t.includes('TRIGGER:-P1D'), 'aviso el día antes');
  assert.ok(t.includes('TRIGGER:-PT1H'), 'aviso una hora antes');
});

test('un evento sin fecha no genera calendario en vez de generar uno roto', () => {
  assert.equal(generarICS({ evento: { id: 'x', titulo: 'Sin fecha' }, url: 'https://x.co' }), null);
  const c = paraCorreo({ evento: { id: 'x', titulo: 'Sin fecha' }, url: 'https://x.co' });
  assert.equal(c.adjuntos.length, 0);
  assert.equal(c.google, '');
});

test('el adjunto sale con method=PUBLISH, no como convocatoria', () => {
  const c = paraCorreo({ evento: EVENTO, url: 'https://gestek.co/x' });
  assert.equal(c.adjuntos.length, 1);
  assert.equal(c.adjuntos[0].filename, 'feria-2026.ics');
  assert.match(c.adjuntos[0].contentType, /method=PUBLISH/);
});

test('el enlace de Google lleva el rango de fechas', () => {
  const g = googleCalendarUrl({ evento: EVENTO, url: 'https://gestek.co/x' });
  assert.ok(g.startsWith('https://calendar.google.com/'));
  assert.ok(g.includes('dates=20260915T140000Z%2F20260915T230000Z'));
});

test('una fecha inválida no rompe el envío: no hay calendario y ya', () => {
  const c = paraCorreo({ evento: { ...EVENTO, fecha_inicio: 'no-es-fecha' }, url: 'https://x.co' });
  assert.equal(c.adjuntos.length, 0);
});
