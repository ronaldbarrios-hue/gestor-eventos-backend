/* Los archivos SQL que otra persona va a pegar en phpMyAdmin.
 *
 * ── Qué se protege aquí ──────────────────────────────────────────────────
 *
 * Nadie de este lado los ejecuta: los corre quien monta la base en cPanel, a
 * mano, y si uno falla a la mitad deja el esquema medio aplicado — que es peor
 * que no haber empezado. No hay CI que los pruebe, así que lo poco que se
 * puede comprobar sin una base delante, se comprueba.
 *
 * El error que provocó esta prueba fue mío: escribí `ADD COLUMN IF NOT EXISTS`,
 * que es de **MariaDB**. MySQL 8 no lo tiene y revienta en la primera línea.
 * Se lee bien, es lo que uno recuerda, y sólo se descubre con la base delante.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'db', 'migraciones');
const sqls = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && /^\d/.test(f));

/* Sin comentarios: estos archivos EXPLICAN la sintaxis que no se puede usar, y
   ese texto contiene justo lo que la prueba prohíbe. */
const sinComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('hay archivos que revisar', () => {
  assert.ok(sqls.length >= 4, `sólo encontré ${sqls.length} archivos SQL numerados`);
});

test('nada de sintaxis que MySQL 8 no entiende', () => {
  /* Cada una es de MariaDB o de Postgres y se cuela con facilidad porque suena
     bien. La lista crece cuando alguien tropiece con la siguiente. */
  const prohibido = [
    [/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i, 'ADD COLUMN IF NOT EXISTS es de MariaDB; en MySQL 8 hay que mirar information_schema'],
    [/DROP\s+COLUMN\s+IF\s+EXISTS/i,      'DROP COLUMN IF EXISTS es de MariaDB'],
    [/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i, 'CREATE INDEX IF NOT EXISTS no existe en MySQL 8'],
    [/\bSERIAL\b/i,                        'SERIAL es de Postgres; en MySQL es AUTO_INCREMENT'],
    [/\bJSONB\b/i,                         'JSONB es de Postgres; en MySQL es JSON'],
    [/\bTIMESTAMPTZ\b/i,                   'TIMESTAMPTZ es de Postgres; en MySQL es DATETIME(6)'],
    [/::\s*(text|uuid|jsonb|int)/i,        'el casteo con :: es de Postgres'],
    [/\bgen_random_uuid\b/i,               'gen_random_uuid() es de Postgres'],
    [/\bON\s+CONFLICT\b/i,                 'ON CONFLICT es de Postgres; en MySQL es ON DUPLICATE KEY / INSERT IGNORE'],
  ];
  for (const f of sqls) {
    const src = sinComentarios(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const [re, porque] of prohibido) {
      assert.doesNotMatch(src, re, `${f}: ${porque}`);
    }
  }
});

test('una columna AÑADIDA de tipo TEXT o JSON obligatoria lleva su default', () => {
  /* Dos cosas a la vez:
     · MySQL no admite un default literal en TEXT ni en JSON, solo una
       expresion entre parentesis (8.0.13+).
     · Y sin default, la carga de datos falla fila por fila — el volcado de
       datos es ANTERIOR a estas columnas, asi que no las nombra.

     Solo aplica a las columnas que se AÑADEN a una tabla que ya va a recibir
     datos. Dentro de un CREATE TABLE no aplica: ahi el INSERT de al lado trae
     el valor, y `zonas.nombre` es justo ese caso. La primera version de esta
     prueba no distinguia las dos y señalaba una linea que estaba bien. */
  for (const f of sqls) {
    const src = sinComentarios(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const malas = src.split('\n').filter((l) =>
      /gestek_add_col|ADD\s+COLUMN/i.test(l)
      && /\b(TEXT|JSON)\b/i.test(l)
      && /NOT\s+NULL/i.test(l)
      && !/DEFAULT\s*\(/i.test(l));
    assert.deepEqual(malas.map((l) => l.trim()), [],
      `${f}: se añade una columna TEXT/JSON NOT NULL sin DEFAULT (…) — la carga de datos fallara en esas filas`);
  }
});

test('el delta trae la tabla que el volcado no tiene', () => {
  const src = fs.readFileSync(path.join(DIR, '005_al_dia.sql'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS `zonas`/,
    'sin `zonas` se repite el apagón de la 0092: mapa, escáner, sub-eventos y bloque de plano en blanco');
  assert.match(src, /INSERT IGNORE INTO `zonas`/, 'la tabla sin sus filas es una tabla vacía');

  /* `zonas.id` NO es un uuid — son `acc_…` y `zona_…`, heredados de page_json.
     Declararlo CHAR(36) truncaría los ids y rompería las cuatro columnas que
     apuntan a ellos. */
  assert.match(src, /`id` VARCHAR\(255\) NOT NULL/,
    '`zonas.id` no es un uuid: CHAR(36) rompe los ids heredados de page_json');
});

test('el delta se lleva las cuatro tablas que el volcado crea de más', () => {
  const src = fs.readFileSync(path.join(DIR, '005_al_dia.sql'), 'utf8');
  for (const t of ['missions', 'referral_codes', 'waitlist', 'recordatorio_inapp_log']) {
    assert.match(src, new RegExp(`DROP TABLE IF EXISTS \`${t}\``), `no se tira \`${t}\``);
  }
  /* Y NO puede tirar `event_waitlist`, que se parece y es la que funciona. */
  assert.doesNotMatch(src, /DROP TABLE IF EXISTS `event_waitlist`/,
    '`event_waitlist` es la lista de espera de verdad: tirarla borra el cupo guardado de la gente');
});

test('los procedimientos de usar y tirar se tiran', () => {
  const src = fs.readFileSync(path.join(DIR, '005_al_dia.sql'), 'utf8');
  for (const p of ['gestek_add_col', 'gestek_drop_col', 'gestek_add_idx']) {
    const creados = (src.match(new RegExp(`CREATE PROCEDURE ${p}`, 'g')) || []).length;
    const borrados = (src.match(new RegExp(`DROP PROCEDURE IF EXISTS ${p}`, 'g')) || []).length;
    assert.equal(creados, 1, `${p} se crea ${creados} veces`);
    assert.ok(borrados >= 2, `${p} se queda en la base del cliente después de correr el archivo`);
  }
});

/* ── El generador de cuentas ──────────────────────────────────────────────
 *
 * No es un archivo de datos: es una consulta que se corre en Supabase y cuya
 * salida se pega en `gestek_auth`. Va aparte porque ahí dentro van hashes de
 * contraseña, y un archivo con hashes se queda en el repositorio, en el
 * historial de git y en el portapapeles de quien lo abra. */
const GEN = path.join(DIR, 'generar-usuarios-mysql.sql');

test('el generador de cuentas no lleva ni un dato dentro', () => {
  const src = fs.readFileSync(GEN, 'utf8');
  assert.doesNotMatch(src, /\$2[aby]\$\d\d\$/,
    'hay un hash bcrypt escrito en el archivo: eso no puede vivir en el repositorio');
  assert.doesNotMatch(sinComentarios(src), /^\s*INSERT\s+IGNORE\s+INTO\s+usuarios\s+\(id[^']*\)\s*VALUES\s*\('/im,
    'hay filas de datos escritas a mano: esto tiene que generarlas, no traerlas');
});

test('el generador escapa las barras invertidas, que MySQL sí interpreta', () => {
  /* Postgres lee `\` dentro de una cadena como una barra y ya; MySQL la lee
     como un escape y se la come. Sin duplicarlas, un nombre o un JSON con una
     barra dentro llegan distintos a los dos lados — y el fallo sale en una
     fila de mil, que es la peor forma de descubrirlo. */
  const src = sinComentarios(fs.readFileSync(GEN, 'utf8'));
  const valores = src.match(/quote_literal\([^)]*\)/g) || [];
  assert.ok(valores.length >= 5, `sólo ${valores.length} valores citados: la consulta cambió de forma`);

  /* Los que vienen de texto libre son los que pueden traer una barra. Las
     fechas y los uuid no. */
  for (const campo of ['u.email', 'u.encrypted_password', 'raw_user_meta_data', 'i.provider_id', 'i.email']) {
    const linea = src.split('\n').find((l) => l.includes(campo));
    assert.ok(linea && /replace\(/.test(linea),
      `\`${campo}\` viaja sin escapar las barras invertidas`);
  }
});

test('el generador es de sólo lectura', () => {
  const src = sinComentarios(fs.readFileSync(GEN, 'utf8'));
  for (const peligro of [/\bdelete\s+from\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdrop\s+/i, /\btruncate\b/i]) {
    assert.doesNotMatch(src, peligro,
      'el generador escribe en la base de origen: tiene que poder correrse sin miedo tantas veces como haga falta');
  }
});
