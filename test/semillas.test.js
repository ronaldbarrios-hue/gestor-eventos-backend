/* Tests de lo que se crea junto con un evento nuevo.

   Estas semillas son una COPIA de lo que hoy hacen tres disparadores en
   Postgres. Copiar es exactamente donde se separan las cosas, así que lo que
   se protege aquí son los valores concretos: si alguien cambia un permiso o
   quita un rol, la prueba lo dice.

   Los valores están tomados de producción el 29 de agosto de 2026
   (`private.fn_roles_semilla()` y `public.default_page_blocks()`).

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CANALES, ROLES, BLOQUES_INICIALES, paginaPorDefecto, sembrarEvento,
} = require('../modules/eventos/semillas.js');

test('los cuatro canales, con su tipo', () => {
  /* El tipo es lo que separa lo que ve todo el mundo de lo que ve el equipo, y
     no se puede deducir del nombre. */
  assert.deepEqual(CANALES, [
    { nombre: 'General',   tipo: 'general' },
    { nombre: 'Acceso',    tipo: 'staff'   },
    { nombre: 'Logística', tipo: 'staff'   },
    { nombre: 'Atención',  tipo: 'staff'   },
  ]);
});

test('los once roles, en su orden', () => {
  /* Once desde la 0089: «Administrador» entra el primero (orden 0) porque es el
     más fuerte y es el que se busca al delegar. Era el que faltaba: el dueño no
     es un rol sino una columna, así que dar «todo» a alguien obligaba a
     traspasarle el evento. */
  assert.equal(ROLES.length, 11);
  assert.deepEqual(ROLES.map(r => r.orden), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(
    ROLES.map(r => r.nombre),
    /* Renombrados en la 0090 por lo que hacen: «Speaker» concedía editar la
       agenda entera y «Expositor» administrar a todos los expositores — y
       ninguno de los dos es un puesto de trabajo del evento. */
    ['Administrador',
     'Editor', 'Coordinador', 'Puerta', 'Staff · Logística', 'Atención',
     'VIP host', 'Coordinación de expositores', 'Programación', 'Finanzas', 'Moderación'],
  );
});

test('los permisos de los roles que más cuestan de reconstruir', () => {
  const de = (n) => ROLES.find(r => r.nombre === n).permissions;
  /* «Puerta» desde la 0090: se llamaba «Staff · Acceso». El nombre dice
     ahora quién es la persona, no en qué cajonón del organigrama está. */
  assert.deepEqual(de('Puerta'), ['checkin', 'ver_clientes']);
  assert.deepEqual(de('Finanzas'), ['ver_pagos', 'reembolsar', 'ver_clientes', 'ver_analytics']);
  assert.deepEqual(de('Editor'),
    ['editar_evento', 'editar_pagina_publica', 'gestionar_imagenes', 'gestionar_agenda']);
});

test('ningún rol se queda sin permisos', () => {
  /* Un rol vacío se puede conceder y no hace nada: se ve como si funcionara. */
  for (const r of ROLES) {
    assert.ok(Array.isArray(r.permissions) && r.permissions.length > 0, `«${r.nombre}» sin permisos`);
    assert.ok(r.descripcion?.trim(), `«${r.nombre}» sin descripción`);
  }
});

test('la página por defecto INCLUYE las boletas', () => {
  /* Un evento que nace sin este bloque enseña una landing donde las boletas no
     aparecen aunque estén creadas, y desde fuera se lee como «no las
     configuró». Pasó con un evento real. */
  assert.ok(BLOQUES_INICIALES.includes('tickets'));
  const p = paginaPorDefecto();
  assert.ok(p.pages[0].blocks.some(b => b.type === 'tickets'));
});

test('los ids de los bloques iniciales son FIJOS, no aleatorios', () => {
  /* Un embed exportado «de esta sección exacta» apunta a uno de estos ids. Si
     cambiaran por evento, no habría forma de referirse a «la de boletas». */
  const a = paginaPorDefecto().pages[0].blocks.map(b => b.id);
  const b = paginaPorDefecto().pages[0].blocks.map(x => x.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['sys_portada', 'sys_titulo', 'sys_descripcion', 'sys_info',
                       'sys_direccion', 'sys_links', 'sys_tickets']);
});

test('sembrar escribe los canales y los roles, y los roles con INSERT IGNORE', async () => {
  /* IGNORE porque reintentar la creación de un evento es algo que pasa, y la
     segunda vez no puede reventar. Es el `on conflict do nothing` del original. */
  const sql = [];
  const cx = { consultar: async (q, p) => { sql.push({ q: q.replace(/\s+/g, ' ').trim(), p }); } };
  const r = await sembrarEvento(cx, { id: 'e1', owner_id: 'u1' });

  /* 11 desde la 0089: entró «Administrador», el rol que faltaba para poder
     delegar todo sin traspasar el evento. */
  assert.deepEqual(r, { canales: 4, roles: 11 });
  assert.equal(sql.filter(s => s.q.includes('chat_channels')).length, 4);
  assert.equal(sql.filter(s => s.q.includes('event_roles')).length, 11);
  assert.ok(sql.find(s => s.q.includes('event_roles')).q.startsWith('INSERT IGNORE'));
});

test('sembrar sin evento falla en vez de escribir a medias', async () => {
  const cx = { consultar: async () => { throw new Error('no debería llegar aquí'); } };
  await assert.rejects(() => sembrarEvento(cx, {}), /Falta el evento/);
  await assert.rejects(() => sembrarEvento(cx, null), /Falta el evento/);
});

test('los permisos viajan como JSON, que es como los guarda MySQL', async () => {
  /* En Postgres es un array nativo; en MySQL es una columna JSON. Mandar el
     array de JavaScript tal cual lo guardaría como "[object Object]". */
  const sql = [];
  const cx = { consultar: async (q, p) => { sql.push({ q, p }); } };
  await sembrarEvento(cx, { id: 'e1', owner_id: 'u1' });
  const rol = sql.find(s => s.q.includes('event_roles'));
  const permisos = rol.p[3];
  assert.equal(typeof permisos, 'string');
  assert.doesNotThrow(() => JSON.parse(permisos));
});
