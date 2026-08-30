/* generar-esquema-mysql.sql — traduce el esquema de Postgres a MySQL 8.
 *
 * Se corre CONTRA POSTGRES (el editor SQL de Supabase sirve), no contra MySQL.
 * Devuelve una fila por sentencia; pegando la columna `ddl` en orden sale
 * `003_esquema.sql`.
 *
 *   Es de sólo lectura. No crea, no borra y no toca ninguna fila.
 *
 * ── Por qué un generador y no un archivo escrito a mano ──────────────────
 *
 * Son 71 tablas y 829 columnas, y el esquema se va a seguir moviendo hasta el
 * día del corte. Un archivo escrito a mano queda viejo en una semana y nadie
 * se entera hasta que falta una columna en producción. Esto se vuelve a correr
 * y se compara con `git diff`: lo que cambió en Postgres se ve en el acto.
 *
 * ── Lo que este archivo NO resuelve ──────────────────────────────────────
 *
 * Hay cosas que no tienen traducción mecánica y están en NOTAS-ESQUEMA.md, con
 * la decisión tomada para cada una:
 *
 *   · los 8 índices únicos parciales   → columnas generadas (ver §4)
 *   · los 13 disparadores               → se van al código
 *   · las 7 funciones que la app llama  → se van al código
 *   · las 8 claves hacia auth.users     → dejan de ser claves foráneas
 *   · las 4 vistas                      → se rehacen a mano
 *
 * Si aparece un tipo que no está en la tabla de abajo, el generador FALLA en
 * vez de inventarse una traducción. Es a propósito: una columna traducida mal
 * en silencio se descubre con los datos ya migrados.
 */

/* ── 1 · Tipos ─────────────────────────────────────────────────────────────
 *
 * `p_indexada` decide entre TEXT y VARCHAR: MySQL no indexa un TEXT sin
 * prefijo. El tamaño no está inventado — se midió el largo real de las 55
 * columnas de texto indexadas: el máximo es 420 (el endpoint de push) y el
 * siguiente 253 (el token del QR); el resto no pasa de 73. De ahí VARCHAR(255)
 * como norma y VARCHAR(512) para esas dos.
 */
create or replace function pg_temp.tipo_mysql(
  p_tabla text, p_col text, p_tipo text, p_udt text,
  p_prec int, p_escala int, p_indexada bool
) returns text language plpgsql as $$
begin
  /* Las dos que no caben en 255. Medido, no supuesto. */
  if (p_tabla, p_col) in (('push_subscriptions','endpoint'), ('tickets','qr_token')) then
    return 'VARCHAR(512)';
  end if;

  return case
    /* Postgres tiene arreglos y MySQL no. JSON es lo más parecido que se
       puede consultar; obliga a tocar el código que los lee (ver notas). */
    when p_tipo = 'ARRAY' then 'JSON'

    /* CHAR(36) y no BINARY(16): los 221 UUID de hoy se leen en los logs, en
       las URL y en el panel. Ganar 20 bytes por fila no paga volverlos
       ilegibles a mitad de una migración. */
    when p_udt = 'uuid' then 'CHAR(36)'

    when p_tipo in ('text', 'character varying')
      then case when p_indexada then 'VARCHAR(255)' else 'TEXT' end

    /* Sin zona horaria: MySQL no la guarda. Todo entra y sale en UTC, que es
       como ya lo escribe el backend. La precisión (6) evita perder los
       microsegundos que Postgres sí guarda. */
    when p_tipo in ('timestamp with time zone', 'timestamp without time zone')
      then 'DATETIME(6)'
    when p_tipo = 'date' then 'DATE'
    when p_tipo in ('time without time zone', 'time with time zone') then 'TIME'

    when p_tipo = 'boolean' then 'TINYINT(1)'
    when p_tipo = 'smallint' then 'SMALLINT'
    when p_tipo = 'integer' then 'INT'
    when p_tipo = 'bigint' then 'BIGINT'
    when p_tipo = 'double precision' then 'DOUBLE'

    /* Los `numeric` sin precisión declarada son plata. DECIMAL(12,2) es lo
       que ya usan los que sí la declaran. */
    when p_tipo = 'numeric' then
      case when p_prec is null then 'DECIMAL(12,2)'
           when p_prec = 53 then 'DOUBLE'
           else format('DECIMAL(%s,%s)', p_prec, coalesce(p_escala, 0)) end

    when p_tipo in ('jsonb', 'json') then 'JSON'
  end;
end $$;

/* ── 2 · Valores por omisión ───────────────────────────────────────────────
 *
 * MySQL 8.0.13 en adelante acepta expresiones como omisión si van entre
 * paréntesis, que es lo que permite darle un `DEFAULT` a un JSON o a un TEXT.
 */
create or replace function pg_temp.omision_mysql(p_def text, p_tipo text)
returns text language sql as $$
  select case
    when p_def is null then null

    /* Las secuencias se convierten en AUTO_INCREMENT más arriba. */
    when p_def like 'nextval(%' then null

    /* Postgres genera el UUID; MySQL también podría (`DEFAULT (UUID())`) pero
       devolvería un UUID v1, con otro formato y ordenado distinto. El backend
       ya genera los suyos: mejor una sola fuente que dos que no coinciden. */
    when p_def in ('gen_random_uuid()', 'uuid_generate_v4()') then null

    when p_def in ('now()', 'CURRENT_TIMESTAMP', 'timezone(''utc''::text, now())')
      then 'CURRENT_TIMESTAMP(6)'

    when p_def = 'true'  then '1'
    when p_def = 'false' then '0'

    /* Arreglos vacíos y arreglos con contenido: '{}'::text[] → [] y
       ARRAY['read'::text] → ["read"]. */
    when p_def ~ '^''\{\}''::(text|uuid)\[\]$' then '(CAST(''[]'' AS JSON))'
    when p_def ~ '^ARRAY\[' then
      '(CAST(' || quote_literal(
        '[' || (select string_agg('"' || m[1] || '"', ',')
                from regexp_matches(p_def, '''([^'']*)''::', 'g') m)
        || ']') || ' AS JSON))'

    when p_tipo in ('jsonb','json') then
      '(CAST(' || quote_literal(regexp_replace(p_def, '^''(.*)''::jsonb?$', '\1')) || ' AS JSON))'

    /* Un TEXT no acepta omisión literal: tiene que ir entre paréntesis. */
    when p_def ~ '^''.*''::(text|character varying)$' then
      case when p_tipo = 'text'
        then '(' || quote_literal(regexp_replace(p_def, '^''(.*)''::(text|character varying)$', '\1')) || ')'
        else quote_literal(regexp_replace(p_def, '^''(.*)''::(text|character varying)$', '\1')) end

    when p_def ~ '^-?[0-9]+(\.[0-9]+)?$' then p_def
    when p_def ~ '^-?[0-9]+(\.[0-9]+)?::(numeric|integer|double precision)$'
      then regexp_replace(p_def, '::.*$', '')

    else null   -- lo que no se sepa traducir se deja sin omisión, y se avisa
  end;
$$;

/* ── 3 · Las tablas ────────────────────────────────────────────────────────
 *
 * Las claves foráneas van aparte, al final, para no depender del orden de
 * creación: con 156 claves y ciclos entre ellas, ordenar las tablas es un
 * problema que no hace falta tener.
 */
with cols as (
  select c.table_name  as t,
         c.column_name as k,
         c.ordinal_position as pos,
         c.is_nullable = 'NO' as obligatoria,
         c.column_default as def,
         c.data_type as tipo,
         c.udt_name  as udt,
         c.numeric_precision as prec,
         c.numeric_scale as escala,
         c.column_default like 'nextval(%' as serie,
         exists (
           select 1 from pg_index i
           join pg_class cl on cl.oid = i.indrelid
           join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
           join pg_attribute a on a.attrelid = cl.oid and a.attnum = any(i.indkey)
           where cl.relname = c.table_name and a.attname = c.column_name
         ) as indexada
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name
   and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
),
sin_traduccion as (
  select string_agg(distinct t || '.' || k || ' (' || tipo || ')', ', ') as lista
  from cols
  where pg_temp.tipo_mysql(t, k, tipo, udt, prec, escala, indexada) is null
),
lineas as (
  select t,
         pos,
         /* Lo que no se supo traducir se deja escrito, pero DELANTE y en su
            propia linea. Iba detras, al final de la linea de la columna, y
            como `--` en MySQL llega hasta el fin de linea, se tragaba la coma
            que separa una columna de la siguiente: el CREATE TABLE no
            compilaba. Se vio al correrlo de verdad, no leyendo el SQL. */
         case when def is not null
               and pg_temp.omision_mysql(def, tipo) is null
               and not serie
               /* Estas dos NO son «no se supo»: se descartan a proposito
                  —el backend genera sus propios UUID y las secuencias pasan
                  a AUTO_INCREMENT—, asi que anotarlas era ruido en 60 tablas. */
               and def not in ('gen_random_uuid()', 'uuid_generate_v4()')
              then '  -- omision en Postgres: ' || replace(def, E'\n', ' ') || E'\n'
              else '' end
         || '  `' || k || '` '
         || pg_temp.tipo_mysql(t, k, tipo, udt, prec, escala, indexada)
         || case when obligatoria then ' NOT NULL' else ' NULL' end
         || coalesce(' DEFAULT ' || pg_temp.omision_mysql(def, tipo), '')
         || case when serie then ' AUTO_INCREMENT' else '' end
         as linea
  from cols
),
pks as (
  select cl.relname as t,
         '  PRIMARY KEY (' || string_agg('`' || a.attname || '`', ', ' order by k.ord) || ')' as linea
  from pg_index i
  join pg_class cl on cl.oid = i.indrelid
  join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
  cross join lateral unnest(i.indkey) with ordinality as k(att, ord)
  join pg_attribute a on a.attrelid = cl.oid and a.attnum = k.att
  where i.indisprimary
  group by cl.relname
)
select case when (select lista from sin_traduccion) is not null
       then '/* ¡PARAR! Tipos sin traducir: ' || (select lista from sin_traduccion) || ' */'
       else 'CREATE TABLE `' || t || '` (' || E'\n'
            || (select string_agg(linea, ',' || E'\n' order by pos) from lineas where lineas.t = x.t)
            || coalesce(',' || E'\n' || (select linea from pks where pks.t = x.t), '')
            /* `as_ci` y no el `ai_ci` de costumbre: los índices únicos de
               Postgres comparan con lower(), que ignora mayúsculas pero NO
               acentos. `ai_ci` ignora las dos cosas, y entonces «José» y
               «Jose» chocarían donde hoy conviven — una categoría de torneo
               legítima empezaría a ser rechazada. `as_ci` es exactamente
               lower(). */
            || E'\n' || ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;'
       end as ddl
from (select distinct t from cols) x
order by t;


/* ── 4 · Los índices ───────────────────────────────────────────────────────
 *
 * Van como CREATE INDEX aparte y no dentro del CREATE TABLE: así se pueden
 * aplicar después de cargar los datos, que en una tabla con filas es varias
 * veces más rápido que insertarlas con los índices puestos.
 *
 * Los parciales son el problema de esta migración: MySQL no los tiene. De los
 * 32, veinticuatro NO son únicos y ahí la condición se puede tirar sin más —
 * el índice resultante cubre lo mismo y algo más, y sólo cuesta espacio.
 *
 * Los ocho que SÍ son únicos no se pueden tocar así: perder la condición
 * convierte un índice que permitía repetidos en uno que los prohíbe, y eso se
 * descubre cuando una inscripción legítima empieza a fallar. De esos ocho,
 * cuatro se reproducen exactos con un UNIQUE normal —porque su condición es
 * «la columna no es nula» y esa columna está en la clave, y MySQL, igual que
 * Postgres, deja repetir los NULL— y los otros cuatro necesitan una columna
 * generada que valga NULL cuando la condición no se cumple. Están escritos a
 * mano en `003_esquema_indices_parciales.sql`, uno por uno, porque cada uno es
 * una decisión distinta.
 *
 * Esta consulta emite los que se traducen solos, y deja anotado el resto.
 */
select case
    when i.indisunique and pg_get_expr(i.indpred, i.indrelid) is not null
      then '-- A MANO (único parcial): ' || ci.relname || ' — ' || pg_get_indexdef(i.indexrelid)
    when i.indisprimary then null

    /* GIN sólo se usa aquí para indexar un arreglo, y un arreglo pasa a ser
       JSON. MySQL no indexa una columna JSON entera: hay que decirle qué se
       busca dentro, con un índice multivalor (8.0.17 en adelante). Hoy es uno
       solo — chat_channels.rol_ids — y así se traduce. */
    when am.amname = 'gin' then
      'CREATE INDEX `' || ci.relname || '` ON `' || ct.relname || '` ((CAST(`'
      || (select a.attname from pg_attribute a
          where a.attrelid = ct.oid and a.attnum = i.indkey[0])
      || '` AS CHAR(36) ARRAY)));  -- era GIN sobre un arreglo'

    else
      'CREATE ' || case when i.indisunique then 'UNIQUE ' else '' end
      || 'INDEX `' || ci.relname || '` ON `' || ct.relname || '` ('
      || (select string_agg(
            case when a.attname is not null then '`' || a.attname || '`'
                 /* Índice sobre una expresión: MySQL 8.0.13 en adelante los
                    admite entre paréntesis, así que lower(x) se traduce. */
                 else '(' || pg_get_indexdef(i.indexrelid, k.ord::int, true) || ')' end,
            ', ' order by k.ord)
          from unnest(i.indkey) with ordinality as k(att, ord)
          left join pg_attribute a on a.attrelid = ct.oid and a.attnum = k.att and k.att <> 0)
      || ');'
      || case when pg_get_expr(i.indpred, i.indrelid) is not null
              then '  -- era parcial: WHERE ' || pg_get_expr(i.indpred, i.indrelid)
                   || ' (no único: la condición se puede tirar)'
              else '' end
  end as ddl
from pg_index i
join pg_class ci on ci.oid = i.indexrelid
join pg_class ct on ct.oid = i.indrelid
join pg_am am on am.oid = ci.relam
join pg_namespace ns on ns.oid = ct.relnamespace and ns.nspname = 'public'
where not i.indisprimary
order by ct.relname, ci.relname;


/* ── 5 · Las claves foráneas ───────────────────────────────────────────────
 *
 * Al final del archivo, después de cargar los datos: con 156 claves y ciclos
 * entre tablas, no hay un orden de creación que funcione sin desactivarlas.
 *
 * Las ocho que hoy apuntan a `auth.users` NO se emiten. Los usuarios pasan a
 * `usuarios`, en la base de identidad, que puede ser otra base distinta —y una
 * clave foránea entre bases ata las dos para siempre, que es justo lo que la
 * separación de `core/db/mysql.js` intenta evitar. Quedan como CHAR(36) con
 * índice, y la integridad la sostiene el código. Están listadas en las notas
 * para que la decisión no se pierda.
 */
select 'ALTER TABLE `' || ct.relname || '` ADD CONSTRAINT `' || con.conname
       || '` FOREIGN KEY ('
       || (select string_agg('`' || a.attname || '`', ', ' order by k.ord)
           from unnest(con.conkey) with ordinality as k(att, ord)
           join pg_attribute a on a.attrelid = ct.oid and a.attnum = k.att)
       || ') REFERENCES `' || cf.relname || '` ('
       || (select string_agg('`' || a.attname || '`', ', ' order by k.ord)
           from unnest(con.confkey) with ordinality as k(att, ord)
           join pg_attribute a on a.attrelid = cf.oid and a.attnum = k.att)
       || ')'
       || case con.confdeltype when 'c' then ' ON DELETE CASCADE'
                               when 'n' then ' ON DELETE SET NULL'
                               when 'r' then ' ON DELETE RESTRICT'
                               else '' end
       || ';' as ddl
from pg_constraint con
join pg_class ct on ct.oid = con.conrelid
join pg_namespace ns on ns.oid = ct.relnamespace and ns.nspname = 'public'
join pg_class cf on cf.oid = con.confrelid
join pg_namespace nf on nf.oid = cf.relnamespace
where con.contype = 'f'
  and nf.nspname = 'public'   -- deja fuera las 8 que apuntan a auth.users
order by ct.relname, con.conname;
