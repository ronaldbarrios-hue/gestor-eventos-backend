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

test('cada rol semilla puede lo suyo, y no lo de otro', () => {
  /* Antes esto fijaba las listas EXACTAS de tres roles. Se quedó vieja el día
     que la base repartió más permisos que esta lista —la 0124— y falló por que
     el código mejoró, no por que se rompiera. La igualdad exacta contra su
     fuente la comprueba `lasDosSemillasRepartenIgual`, que la lee de la
     migración en vez de copiarla.
     
     Aquí se fija lo que NO se puede perder al reorganizar los roles: que cada
     uno pueda su trabajo, y que no se le cuele el de otro. Eso sobrevive a que
     se añada un permiso, que es lo que tiene que pasar. */
  const de = (n) => ROLES.find(r => r.nombre === n).permissions;
  const puede   = (n, p) => assert.ok(de(n).includes(p),  `«${n}» perdió «${p}»`);
  const noPuede = (n, p) => assert.ok(!de(n).includes(p), `«${n}» se quedó con «${p}», que no es suyo`);

  /* «Puerta» desde la 0090: se llamaba «Staff · Acceso». El nombre dice ahora
     quién es la persona, no en qué cajón del organigrama está. */
  puede('Puerta', 'checkin');
  puede('Puerta', 'ver_clientes');     // sin la lista no se puede buscar a nadie
  noPuede('Puerta', 'ver_pagos');      // la puerta no mira el dinero
  noPuede('Puerta', 'editar_evento');

  puede('Finanzas', 'ver_pagos');
  puede('Finanzas', 'reembolsar');
  noPuede('Finanzas', 'checkin');      // quien lleva las cuentas no está en la puerta
  noPuede('Finanzas', 'editar_evento');

  puede('Editor', 'editar_pagina_publica');
  puede('Editor', 'gestionar_imagenes');
  noPuede('Editor', 'ver_pagos');
  noPuede('Editor', 'checkin');

  /* El de la capacitación: quien lleva la logística escanea y abre puertas.
     Programar la agenda es de «Programación». */
  puede('Staff · Logística', 'checkin');
  puede('Staff · Logística', 'gestionar_accesos');
  noPuede('Staff · Logística', 'gestionar_agenda');
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
