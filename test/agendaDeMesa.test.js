/* La agenda de UNA mesa de la rueda.
 *
 * ── Qué se cuida ─────────────────────────────────────────────────────────
 *
 * La misma agenda se pide desde dos sitios con dos permisos distintos: el
 * panel (quien gestiona la rueda) y el enlace público de la empresa, con el
 * código de su boleta-stand y sin cuenta. Escrita dos veces, una de las dos
 * acabaría enseñando las canceladas o escondiendo los huecos — y nadie lo
 * notaría hasta el día del evento.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { armarAgenda, resumenDeAgenda, ESTADOS_EN_AGENDA } = require('../lib/agendaDeMesa.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const H = (id, h, extra = {}) => ({ id, inicio: `2026-09-17T${h}:00Z`, fin: `2026-09-17T${h}:15Z`, ...extra });

test('los huecos son la mitad de la información', () => {
  /* Una agenda que sólo trae las citas no dice cuándo esa mesa está libre — y
     eso es justo lo que hace falta para meter ahí a alguien que se quedó sin
     reuniones. */
  const agenda = armarAgenda({
    horarios: [H('h1', '09'), H('h2', '10'), H('h3', '11')],
    citas: [{ id: 'c1', horario_id: 'h2', estado: 'confirmada', user_id: 'u1' }],
  });
  assert.equal(agenda.length, 3);
  assert.equal(agenda[0].cita, null);
  assert.equal(agenda[1].cita.id, 'c1');
});

test('sale en orden de reloj, no en el que venga la base', () => {
  /* Sin `order by` explícito Postgres devuelve lo que le conviene, y una
     agenda desordenada es peor que ninguna: se lee de arriba abajo. */
  const agenda = armarAgenda({ horarios: [H('c', '14'), H('a', '09'), H('b', '11')] });
  assert.deepEqual(agenda.map(f => f.horario_id), ['a', 'b', 'c']);
});

test('las canceladas no salen; las pedidas sí, con su estado', () => {
  /* Una agenda es lo que hay que hacer, no lo que se deshizo. Pero quien la
     recibe tiene que saber que una hora pedida todavía puede caerse. */
  assert.deepEqual(ESTADOS_EN_AGENDA, ['confirmada', 'solicitada']);
  const agenda = armarAgenda({
    horarios: [H('h1', '09'), H('h2', '10')],
    citas: [
      { id: 'c1', horario_id: 'h1', estado: 'cancelada', user_id: 'u1' },
      { id: 'c2', horario_id: 'h2', estado: 'solicitada', user_id: 'u2' },
    ],
  });
  assert.equal(agenda[0].cita, null, 'una cancelada ocupó la franja');
  assert.equal(agenda[1].cita.estado, 'solicitada');
});

test('quien no tiene cuenta también aparece, con su correo', () => {
  /* Desde la 0108 se puede sentar a alguien con sólo su correo, y son la
     mayoría: comprar una boleta es anónimo a propósito. Una agenda que los
     deja en blanco manda a la mesa a esperar a «alguien». */
  const agenda = armarAgenda({
    horarios: [H('h1', '09')],
    citas: [{ id: 'c1', horario_id: 'h1', estado: 'confirmada', user_id: null, guest_email: 'ana@x.co', guest_nombre: 'Ana' }],
  });
  assert.deepEqual(agenda[0].cita.persona, { nombre: 'Ana', email: 'ana@x.co' });
});

test('el perfil manda sobre el nombre de invitado', () => {
  const personas = new Map([['u1', { id: 'u1', nombre: 'Ana Ruiz', email: 'ana@x.co' }]]);
  const agenda = armarAgenda({
    horarios: [H('h1', '09')],
    citas: [{ id: 'c1', horario_id: 'h1', estado: 'confirmada', user_id: 'u1' }],
    personas,
  });
  assert.equal(agenda[0].cita.persona.nombre, 'Ana Ruiz');
});

test('sin la 0113 ninguna franja parece bloqueada', () => {
  /* Una fila leída sin esas columnas trae `bloqueado` indefinido. Si eso se
     leyera como bloqueada, una rueda entera se quedaría sin poder reservar. */
  const agenda = armarAgenda({ horarios: [H('h1', '09')] });
  assert.equal(agenda[0].bloqueado, false);
  assert.equal(agenda[0].bloqueo_motivo, null);

  const conBloqueo = armarAgenda({ horarios: [H('h1', '09', { bloqueado: true, bloqueo_motivo: 'almuerzo' })] });
  assert.equal(conBloqueo[0].bloqueado, true);
  assert.equal(conBloqueo[0].bloqueo_motivo, 'almuerzo');
});

test('se puede enseñar una agenda sin decir quién es quién', () => {
  const agenda = armarAgenda({
    horarios: [H('h1', '09')],
    citas: [{ id: 'c1', horario_id: 'h1', estado: 'confirmada', guest_email: 'ana@x.co' }],
    verPersonas: false,
  });
  assert.equal(agenda[0].cita.persona, null);
  assert.equal(agenda[0].cita.estado, 'confirmada', 'la franja sigue diciéndose ocupada');
});

test('el resumen cuenta cada franja una sola vez', () => {
  const agenda = armarAgenda({
    horarios: [H('h1', '09'), H('h2', '10'), H('h3', '11', { bloqueado: true }), H('h4', '12')],
    citas: [
      { id: 'c1', horario_id: 'h1', estado: 'confirmada' },
      { id: 'c2', horario_id: 'h2', estado: 'solicitada' },
    ],
  });
  const r = resumenDeAgenda(agenda);
  assert.deepEqual(r, { franjas: 4, ocupadas: 2, pedidas: 1, libres: 1, bloqueadas: 1 });
  /* Ocupadas + libres + bloqueadas = franjas. Las pedidas van DENTRO de las
     ocupadas: sumarlas aparte daría más citas que horas del día. */
  assert.equal(r.ocupadas + r.libres + r.bloqueadas, r.franjas);
});

/* ── Las dos rutas ───────────────────────────────────────────────────── */

test('la del panel la ve el equipo y el contacto de esa misma empresa', () => {
  /* Lo segundo es lo que la convierte en algo que se le puede dar al
     participante, y no hace falta inventar un vínculo entre cuentas y
     expositores: ese correo ya está en la ficha. */
  const r = sinComentarios(leer('routes/networking.js'));
  assert.match(r, /networking\/expositores\/:id\/citas/);
  assert.match(r, /\(exp\.contacto_email \|\| ''\)\.toLowerCase\(\) === miCorreo/);
  assert.match(r, /if \(!suyo\) \{[\s\S]{0,300}assertOwner/);
});

test('la pública va por el código, no por el id que venga en la URL', () => {
  /* Atarla a un id de expositor dejaría leer la agenda de CUALQUIER mesa con
     el código de una sola. La ficha la resuelve el código. */
  const r = sinComentarios(leer('routes/eventos.publicos.js'));
  assert.match(r, /expositor\/:codigo\/citas/);
  assert.match(r, /resolverFichaExpositor\(req\.params\.codigo\)/);
  assert.match(r, /\.eq\('expositor_id', ficha\.id\)/);
  assert.doesNotMatch(r, /expositor\/:codigo\/citas[\s\S]{0,900}req\.query\.expositor/);
});

test('las dos arman la agenda con el mismo módulo', () => {
  /* Escrita dos veces, una acabaría enseñando las canceladas o escondiendo los
     huecos, y nadie lo notaría hasta el día del evento. */
  for (const f of ['routes/networking.js', 'routes/eventos.publicos.js']) {
    assert.match(leer(f), /require\('\.\.\/lib\/agendaDeMesa\.js'\)/, `${f} no usa el módulo`);
    assert.match(sinComentarios(leer(f)), /armarAgenda\(\{/, `${f} no llama a armarAgenda`);
  }
});

test('la pública aguanta sin la 0113', () => {
  /* Pedir las columnas de bloqueo antes de aplicarla contesta error, y la
     agenda entera se caería — cuando lo correcto es que sin la migración no
     haya bloqueos, no que no haya agenda. */
  const r = sinComentarios(leer('routes/eventos.publicos.js'));
  assert.match(r, /if \(eH\) \(\{ data: horarios, error: eH \} = await pedir\('id, inicio, fin'\)\);/);
});

test('los nombres no se piden con un embed que no existe', () => {
  /* `networking_citas.user_id` apunta a `auth.users` y no a `public.profiles`:
     PostgREST contesta PGRST200 y la agenda saldría sin un solo nombre. Ya
     costó una pantalla entera. */
  const r = sinComentarios(leer('routes/eventos.publicos.js'));
  const trozo = r.slice(r.indexOf("expositor/:codigo/citas"), r.indexOf("expositor/:codigo/citas") + 2500);
  assert.doesNotMatch(trozo, /profiles!user_id/);
});
