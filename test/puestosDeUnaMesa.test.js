/* Los puestos de una mesa: crearlos, contarlos en la puerta, transferirlos.
 *
 * La 0118 dejó la tabla. Esto es la lógica que la usa, y la prueba que más
 * importa está al final: que los DOS caminos por los que nace una boleta creen
 * puestos. Si uno se olvidara, la mesa vendida por ese camino llegaría a la
 * puerta sin sitios que marcar y las otras tres personas se quedarían fuera —
 * sin que nada avisara hasta esa noche.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const p = require('../lib/puestos.js');
const { signPuestoQR, verifyTicketQR, signTicketQR } = require('../lib/qr.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const BASE = { ticketId: 't1', eventoId: 'e1', titular: { nombre: 'Juan Medina', email: 'j@x.co' } };

/* ── Cuántos puestos, y con qué datos ─────────────────────────────────── */

test('una entrada normal es un puesto y una mesa de cuatro son cuatro', () => {
  assert.equal(p.cuantosPuestos(1), 1);
  assert.equal(p.cuantosPuestos(4), 4);
  /* Nunca cero ni negativo: una boleta sin puestos no deja entrar a nadie. */
  assert.equal(p.cuantosPuestos(0), 1);
  assert.equal(p.cuantosPuestos(null), 1);
  assert.equal(p.cuantosPuestos('cuatro'), 1);
  assert.equal(p.cuantosPuestos(2.5), 1);
});

test('el puesto 1 lleva al comprador en los tres modos', () => {
  /* Quien pagó va a ir. Dejarlo vacío obligaría al anfitrión a apuntarse a sí
     mismo en su propia mesa. */
  for (const modo of p.MODOS) {
    const filas = p.filasDePuestos({ ...BASE, personas: 4, modo });
    assert.equal(filas[0].nombre, 'Juan Medina', modo);
    assert.equal(filas[0].estado, 'asignado', modo);
  }
});

test('individual llena los cuatro; contador y anfitrión dejan tres libres', () => {
  const llenos = (modo) => p.filasDePuestos({ ...BASE, personas: 4, modo })
    .filter(f => f.estado === 'asignado').length;
  assert.equal(llenos('individual'), 4);
  assert.equal(llenos('contador'), 1);
  assert.equal(llenos('anfitrion'), 1);
});

test('los puestos van numerados 1..N sin repetir', () => {
  const ordenes = p.filasDePuestos({ ...BASE, personas: 4, modo: 'anfitrion' }).map(f => f.orden);
  assert.deepEqual(ordenes, [1, 2, 3, 4]);
});

test('un modo desconocido no rompe la compra: cae en individual', () => {
  const filas = p.filasDePuestos({ ...BASE, personas: 2, modo: 'inventado' });
  assert.equal(filas[1].nombre, 'Juan Medina');
});

test('sin boleta o sin evento no se crean puestos huérfanos', () => {
  assert.throws(() => p.filasDePuestos({ eventoId: 'e1', personas: 2 }));
  assert.throws(() => p.filasDePuestos({ ticketId: 't1', personas: 2 }));
});

/* ── La puerta ────────────────────────────────────────────────────────── */

test('una mesa con dos dentro todavía deja entrar a los otros dos', () => {
  /* Es el fallo que había: el escáner marcaba la boleta `usado` de una vez y
     las otras tres personas se quedaban fuera. */
  const mesa = [{ estado: 'usado' }, { estado: 'usado' }, { estado: 'asignado' }, { estado: 'libre' }];
  const e = p.estadoEnLaPuerta(mesa);
  assert.equal(e.puede_entrar, true);
  assert.equal(e.dentro, 2);
  assert.equal(e.quedan, 2);
  assert.match(e.resumen, /4 puestos · entraron 2/);
});

test('la mesa llena sí se rechaza', () => {
  const e = p.estadoEnLaPuerta([{ estado: 'usado' }, { estado: 'usado' }]);
  assert.equal(e.puede_entrar, false);
  assert.equal(e.quedan, 0);
});

test('una boleta de una persona no enseña contador en la puerta', () => {
  /* Con cien personas esperando, la pantalla tiene que seguir siendo sí/no. */
  assert.equal(p.estadoEnLaPuerta([{ estado: 'asignado' }]).resumen, null);
});

/* ── La transferencia ─────────────────────────────────────────────────── */

const PUESTO = { id: 'p1', evento_id: 'e1', nombre: 'Juan Medina', email: 'j@x.co', estado: 'asignado' };
const SI = { permitir_transferencia: true };
const A = { nombre: 'Ana López' };

test('apagado por defecto: un congreso no quiere sus boletas circulando', () => {
  const r = p.puedeTransferir({ puesto: PUESTO, reglas: {}, destino: A });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'apagado');
});

test('un puesto que ya entró no se transfiere', () => {
  const r = p.puedeTransferir({ puesto: { ...PUESTO, estado: 'usado' }, reglas: SI, destino: A });
  assert.equal(r.motivo, 'usado');
});

test('el tope de veces se cuenta por puesto, no por boleta', () => {
  const reglas = { ...SI, max_transferencias: 1 };
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: A, hechas: 0 }).ok, true);
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: A, hechas: 1 }).motivo, 'gastadas');
});

test('sin tope configurado no hay tope', () => {
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas: SI, destino: A, hechas: 9 }).ok, true);
});

test('la hora de corte cierra las transferencias', () => {
  /* Una transferencia a las 20:55 para un show a las 21:00 es un problema en la
     puerta, no una venta. */
  const reglas = { ...SI, transferencias_hasta: '2026-11-20T18:00:00Z' };
  const antes = new Date('2026-11-20T17:00:00Z');
  const despues = new Date('2026-11-20T20:55:00Z');
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: A, ahora: antes }).ok, true);
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: A, ahora: despues }).motivo, 'cerrado');
});

test('sin nombre de quien recibe no hay transferencia', () => {
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas: SI, destino: { nombre: '   ' } }).motivo, 'sin_destino');
});

test('un evento deportivo exige el documento — Decreto 1622 de 2022', () => {
  const reglas = { ...SI, exigir_documento: true };
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: A }).motivo, 'sin_documento');
  assert.equal(p.puedeTransferir({ puesto: PUESTO, reglas, destino: { ...A, documento: '1000123' } }).ok, true);
});

test('todo motivo de rechazo tiene una frase que se le puede enseñar a alguien', () => {
  for (const [k, v] of Object.entries(p.NO_SE_PUEDE)) assert.ok(v && v.length > 15, k);
});

test('transferir cambia el titular y deja el puesto SIN credencial', () => {
  /* A propósito: un fallo a mitad de camino deja una boleta que no abre —el
     lado seguro— en vez de dos personas con la misma entrada. */
  const { puesto, rastro } = p.aplicarTransferencia({
    puesto: PUESTO, destino: { nombre: ' Ana López ', email: 'ANA@X.CO', documento: '1000123' },
  });
  assert.equal(puesto.nombre, 'Ana López');
  assert.equal(puesto.email, 'ana@x.co');
  assert.equal(puesto.qr_token, null);
  assert.equal(puesto.estado, 'asignado');
  assert.equal(rastro.de_nombre, 'Juan Medina');
  assert.equal(rastro.a_nombre, 'Ana López');
  assert.equal(rastro.via, 'titular');
});

test('el dinero se anota si alguien lo declara, y null es lo esperado', () => {
  /* El pago de una reventa es ajeno a la plataforma: queda para que el
     organizador mire el histórico, no para cobrar sobre él. */
  assert.equal(p.aplicarTransferencia({ puesto: PUESTO, destino: A }).rastro.monto, null);
  assert.equal(p.aplicarTransferencia({ puesto: PUESTO, destino: A, monto: '' }).rastro.monto, null);
  assert.equal(p.aplicarTransferencia({ puesto: PUESTO, destino: A, monto: '80000' }).rastro.monto, 80000);
});

test('un `via` inventado no entra: la base sólo acepta tres', () => {
  assert.equal(p.aplicarTransferencia({ puesto: PUESTO, destino: A, via: 'pirata' }).rastro.via, 'titular');
  assert.equal(p.aplicarTransferencia({ puesto: PUESTO, destino: A, via: 'panel' }).rastro.via, 'panel');
});

/* ── La credencial del puesto ─────────────────────────────────────────── */

test('el QR de un puesto lo entiende todo lo que ya leía QRs de boleta', () => {
  const t = signPuestoQR({ ticket_id: 't1', evento_id: 'e1', codigo: 'ABC12345', puesto_id: 'p1', orden: 2 });
  const r = verifyTicketQR(t);
  assert.equal(r.ok, true);
  assert.equal(r.ticket_id, 't1');
  assert.equal(r.evento_id, 'e1');
  assert.equal(r.puesto_id, 'p1');
  assert.equal(r.orden, 2);
});

test('un QR de boleta normal no trae puesto: nada cambia para lo que ya existe', () => {
  const r = verifyTicketQR(signTicketQR({ ticket_id: 't1', evento_id: 'e1', codigo: 'ABC12345' }));
  assert.equal(r.puesto_id, null);
});

test('volver a firmar el mismo puesto da otro token: eso es lo que invalida el viejo', () => {
  /* Sin esto, «transferir» sería un cambio de nombre y el anterior seguiría
     abriendo la puerta. */
  const args = { ticket_id: 't1', evento_id: 'e1', codigo: 'ABC12345', puesto_id: 'p1', orden: 1 };
  assert.notEqual(signPuestoQR(args), signPuestoQR(args));
});

/* ── Que ningún camino se olvide de crear puestos ─────────────────────── */

test('los dos caminos por los que nace una boleta crean sus puestos', () => {
  /* El modo de fallo de este proyecto: una lista escrita a mano en varios
     sitios que se separa, falta algo y NO salta ningún error. Aquí eso serían
     mesas que llegan a la puerta sin sitios que marcar.
     Van seis veces esta sesión. */
  const CAMINOS = {
    /* Todas las boletas de pago pasan por aquí —Wompi, MercadoPago y la
       cortesía del agente—, y está cerrado contra webhooks repetidos. */
    'lib/confirmarTicket.js': 'las boletas de pago',
    /* La gratuita no pasa por el anterior: se emite ya pagada. */
    'routes/eventos.publicos.js': 'la reserva gratuita',
  };
  for (const [archivo, que] of Object.entries(CAMINOS)) {
    assert.match(leer(archivo), /emitirPuestos\(/, `${archivo} (${que}) no crea puestos`);
  }
});

test('`modo_entrada` nunca viaja en el select del tipo de boleta', () => {
  /* Es de la 0118. Pedirla junto a las demás columnas haría que, en un
     despliegue sin la migración, el select fallara ENTERO en mitad de una
     compra: la boleta se quedaría sin contar y sin nombre de tipo en el correo.
     Va sola, en `modoDelTipo`, donde fallar sólo cuesta el modo. */
  for (const f of ['lib/confirmarTicket.js', 'routes/eventos.publicos.js']) {
    const texto = leer(f);
    for (const m of texto.matchAll(/\.select\((['"`])([^'"`]*)\1\)/g)) {
      if (!m[2].includes('modo_entrada')) continue;
      assert.equal(m[2].trim(), 'modo_entrada', `${f}: modo_entrada viaja acompañada en un select`);
    }
  }
});

test('emitirPuestos nunca hace fracasar una venta ya cobrada', () => {
  const texto = leer('lib/emitirPuestos.js');
  assert.match(texto, /catch/);
  assert.equal(/throw /.test(texto.slice(texto.indexOf('async function emitirPuestos'))), false);
});
