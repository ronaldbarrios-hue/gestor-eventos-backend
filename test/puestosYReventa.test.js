/* Una boleta, varios puestos — y la reventa que se apoya en ellos.
 *
 * ── Por qué las dos cosas son la misma ───────────────────────────────────
 *
 * Soportar los tres modelos de entrada del sector y controlar la reventa
 * resultaron necesitar la misma pieza: una unidad más pequeña que la boleta.
 *
 * Una mesa de ringside se vende como UNA boleta y entran cuatro personas. Y
 * «le paso mi silla a mi hermano» es transferir uno de esos cuatro puestos.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/^\s*--.*$/gm, '');
const SQL = leer('db/migrations/0118_una_boleta_varios_puestos.sql');
/* Sin alineación: las columnas del SQL van alineadas a mano y contar espacios
   hace que una prueba falle por cómo mide y no por lo que mide. Van tres veces
   esta sesión. */
const APRETADO = SQL.replace(/[ 	]+/g, ' ');

test('el puesto puede existir sin dueño', () => {
  /* Vacío es un estado legítimo y frecuente: una mesa comprada en septiembre
     para diciembre no sabe todavía quién va. Si `nombre` fuera obligatorio,
     el modo anfitrión no podría existir. */
  const bloque = SQL.slice(SQL.indexOf('create table if not exists public.ticket_puestos'),
                           SQL.indexOf('create index if not exists ticket_puestos_ticket_idx'));
  assert.match(bloque.replace(/[ 	]+/g, ' '), /nombre text,/);
  assert.doesNotMatch(bloque, /nombre\s+text not null/);
  assert.match(bloque, /'libre', 'asignado', 'usado', 'transferido'/);
});

test('dos puestos no pueden tener el mismo número', () => {
  /* «Puesto 2 de 4» dejaría de identificar a nadie. */
  assert.match(SQL, /create unique index if not exists ticket_puestos_orden_unico[\s\S]{0,120}\(ticket_id, orden\)/);
});

test('el escáner encuentra un puesto por su código sin recorrer la tabla', () => {
  assert.match(SQL, /create unique index if not exists ticket_puestos_token_idx[\s\S]{0,140}where qr_token is not null/);
});

test('la transferencia deja histórico, no un campo', () => {
  /* Sin las filas anteriores no hay control, sólo una función de traspaso.
     «¿Cuántas veces circuló?» y «¿a quién se la compró?» son las dos preguntas
     que se hacen cuando algo sale mal en la puerta. */
  assert.match(SQL, /create table if not exists public\.puesto_transferencias/);
  assert.match(SQL, /de_nombre[\s\S]{0,200}a_nombre/);
  const bloqueP = SQL.slice(SQL.indexOf('create table if not exists public.ticket_puestos'),
                            SQL.indexOf('create index if not exists ticket_puestos_ticket_idx'));
  assert.doesNotMatch(bloqueP, /transferido_a|veces_transferido/);
});

test('quien recibe no necesita cuenta', () => {
  /* Es alguien a quien le pasaron un enlace por WhatsApp. Guardar una
     referencia a `profiles` haría obligatorio registrarse para recibir una
     silla, que es justo la fricción que mata la transferencia. */
  const bloque = SQL.slice(SQL.indexOf('create table if not exists public.puesto_transferencias'));
  assert.match(bloque.replace(/[ 	]+/g, ' '), /a_email text,/);
  assert.doesNotMatch(bloque, /a_user_id[^\n]*references/);
});

test('se distingue quién hizo la transferencia', () => {
  /* Una hecha por el organizador desde el panel es legítima y tiene que
     distinguirse de una hecha por el titular. */
  assert.match(APRETADO, /via text not null default 'titular' check \(via in \('titular', 'panel', 'agente'\)\)/);
});

test('el modo de entrada vive en el tipo de boleta', () => {
  /* El ringside de un concierto puede ser «contador» y el palco corporativo del
     mismo concierto, «anfitrión». En el evento sería una sola opción para
     todos. */
  assert.match(SQL, /alter table public\.ticket_types[\s\S]{0,120}modo_entrada/);
  assert.match(SQL, /check \(modo_entrada in \('individual', 'contador', 'anfitrion'\)\)/);
});

test('nada de lo que ya existe cambia de comportamiento', () => {
  /* `individual` es lo que hace hoy la plataforma con una boleta de una
     persona. Sin valor por defecto, aplicar la migración dejaría todas las
     boletas del sistema en un modo sin definir. */
  assert.match(SQL, /modo_entrada text not null default 'individual'/);
  const soloSql = sinComentarios(SQL);
  assert.doesNotMatch(soloSql, /drop (table|column)/i);
  assert.doesNotMatch(soloSql, /alter table public\.tickets/);
});

test('la migración no enciende nada por sí sola', () => {
  /* Sin código que cree puestos la tabla se queda vacía y la plataforma sigue
     igual. Se aplica ahora para que las decisiones de política —tope de precio,
     cuántas veces, si hay dinero— no obliguen a volver a tocar el esquema. */
  assert.match(SQL, /Esta migración no enciende nada por sí sola/);
});

test('la política de reventa NO está en el esquema', () => {
  /* Está sin decidir a propósito (nota 24) y va en `ticket_types` cuando se
     decida. Meterla aquí obligaría a elegir ahora entre tope porcentual y tope
     fijo, que son dos productos distintos. */
  assert.doesNotMatch(SQL, /tope_reventa|reventa_permitida|max_transferencias/);
});

test('el documento existe pero no se exige', () => {
  /* En eventos DEPORTIVOS el Decreto 1622 de 2022 obliga a atar la boleta al
     documento. En los demás, pedirlo de más ahuyenta ventas. La columna tiene
     que existir para que la regla se pueda encender por evento. */
  assert.match(APRETADO, /documento text,/);
  assert.match(SQL, /Decreto 1622/);
});

test('la migración es reversible y lo dice', () => {
  assert.match(SQL, /-- ── Vuelta atrás/);
  assert.match(SQL, /drop column if exists modo_entrada/);
});
