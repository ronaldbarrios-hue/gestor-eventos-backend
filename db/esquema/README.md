# `db/esquema/` — la base de Supabase, en archivo

Volcado del esquema de producción (proyecto Supabase
`GestorEventosMarcaBlanca` / `yopontbwgdybfsniqawz`, Postgres 17.6, esquema
`public`) traducido a **MySQL 8**, listo para crear la base en cPanel.

**Generado el 2026-09-01, y ya está por detrás.** Entre el 2 y el 3 de
septiembre se aplicaron las migraciones 0091–0096 y esto no las tiene: falta la
tabla `zonas` entera, `ticket_types.crea` y `crea_torneo_id`, y
`torneo_equipos.respuestas`. Antes de usarlo en serio hay que volver a correr el
generador (paso 1 de abajo) y mirar `git diff`.

El traspaso completo del frente —qué falta, con qué herramientas y qué le va a
faltar a quien lo retome— está en [`../CAMINO-A.md`](../CAMINO-A.md).

Este carpeta es la vía «MySQL» de la migración. El «por qué» de cada decisión de
traducción está en [`../migraciones/NOTAS-ESQUEMA.md`](../migraciones/NOTAS-ESQUEMA.md);
cómo mover las filas, en [`../migraciones/CARGA-DE-DATOS.md`](../migraciones/CARGA-DE-DATOS.md).

## Qué hay aquí

| Archivo | Qué es | Origen |
|---|---|---|
| `01_tablas.sql` | Las `CREATE TABLE` (tipos, defaults, PK). **72 hoy; en Postgres hay 73** — falta `zonas`, de la 0091. | Generado |
| `02_indices_unicos_parciales.sql` | Los 8 índices únicos parciales, a mano. | Copia de `../migraciones/003_esquema_indices_parciales.sql` (mismo contenido; `torneo_categorias_unica_hija` va sobre columna generada porque `nombre` es TEXT y MySQL no lo indexa sin prefijo — error 1170) |
| `03_datos.sql` | El volcado de las filas. **Generado el 2026-09-01**, y por tanto sin lo que cambió después. | `generar-datos.mjs` |
| `04_indices.sql` | El resto de índices (147). | Generado |
| `05_claves_foraneas.sql` | Las 148 FK de `public`. Al final, hay ciclos. | Generado |
| `06_vistas.sql` | Las 4 vistas. | Copia de `../migraciones/004_vistas.sql` |
| `generar-datos.mjs` | Lee la base de Postgres y escribe `03_datos.sql` (INSERT de MySQL). Necesita `PG_URL` y `npm i pg`. | — |

## Orden de aplicación — no es negociable

```
1. 01_tablas.sql
2. 02_indices_unicos_parciales.sql
3. 03_datos.sql
4. 04_indices.sql          (después de los datos: insertar con índices es lento)
5. 05_claves_foraneas.sql  (al final: 148 FK con ciclos, no hay orden que valga)
6. 06_vistas.sql
7. node ../../scripts/comparar-bases.js   (decide si el corte se hace)
```

Antes de cargar, en la sesión de MySQL: `SET time_zone = '+00:00';` — los tres
primeros archivos ya lo traen, pero la sesión desde la que cargues también lo
necesita (`UNIX_TIMESTAMP` usa la zona de la sesión).

## `03_datos.sql` no está — hay que generarlo

**No se pudo generar desde la sesión de asistente que montó esta carpeta, a
propósito.** El volcado lleva datos personales de producción (29 usuarios reales
con correo y teléfono, tokens OAuth, secretos de pasarela cifrados, hashes) y
sacar todo eso en bloque a través de un asistente está bloqueado por el
clasificador de seguridad. Es la misma razón por la que la contraseña de Postgres
nunca ha estado en el repositorio: pídesela a quien administre el proyecto.

Con esa contraseña, tres pasos:

```bash
cd gestor-eventos-backend
npm i pg     # única dependencia extra; no se añade a package.json a propósito
# PG_URL: panel de Supabase -> Project Settings -> Database ->
#         Connection string -> "Session pooler" (o "Direct connection")
export PG_URL='postgresql://postgres.<ref>:<PASS>@aws-0-us-east-2.pooler.supabase.com:5432/postgres'
node db/esquema/generar-datos.mjs        # -> escribe db/esquema/03_datos.sql
```

`generar-datos.mjs` **sólo lee** la base. Aplica las cinco conversiones de
`CARGA-DE-DATOS.md` (fechas a UTC sin zona **con microsegundos**, arreglos a JSON,
booleanos a 1/0, `NULL` se queda `NULL`, JSON tal cual), decidiendo el tipo de
cada columna por su OID de Postgres — si el esquema cambia, lo sigue solo.

Después de cargarlo en MySQL, verifica con `scripts/comparar-bases.js` (paso 7
del orden de arriba): compara las dos bases por huella de contenido de cada fila,
no sólo por número de filas.

**Antes de commitear `03_datos.sql` con datos reales:** repo privado como mínimo,
y para un entorno de pruebas es mejor un volcado anonimizado. Si prefieres no
tenerlo en Git nunca, añádelo a `.gitignore` y muévelo por canal seguro el día
del corte, igual que el `.env`.

### Alternativa sin Node: `pg_dump`

```bash
pg_dump "$PG_URL" --data-only --inserts --column-inserts \
  --schema=public --no-owner --no-privileges > datos-crudos.sql
```

Lo que sale **no es MySQL**: hay que aplicar a mano las cinco conversiones de
arriba. `generar-datos.mjs` las hace por ti — es el camino recomendado.

## Lo que este volcado NO reproduce, a propósito

- **Las 8 FK que en Postgres apuntan a `auth.users`.** Los usuarios viven en la
  base de identidad (`../migraciones/001_identidad.sql`); una FK entre bases las
  ata para siempre. Quedan como `CHAR(36)` con índice.
- **Los 13 disparadores y las 20 funciones.** Se fueron al código del backend
  (`modules/…`). Detalle y destino de cada uno en `NOTAS-ESQUEMA.md`.
- **Las 76 políticas RLS.** El backend entra con una sola credencial; el filtro
  por evento/usuario lo hace `core/permisos`.
- **Los 6 tipos enumerados de Postgres.** Ninguna columna los usa; son texto con
  la validación en el código.
- **`auth`, `storage`, `realtime`, extensiones (`pg_cron`, `pg_net`, `vault`…).**
  Fuera de alcance: esto es sólo la base de negocio.

## Cómo regenerar los archivos «Generado»

Correr [`../migraciones/generar-esquema-mysql.sql`](../migraciones/generar-esquema-mysql.sql)
**contra Postgres** (el editor SQL de Supabase sirve, es de sólo lectura).
Devuelve tres bloques —tablas, índices, claves foráneas— en la columna `ddl`.
Cada bloque va a su archivo (`01`, `04`, `05`). Si sale una fila
`/* ¡PARAR! Tipos sin traducir: … */`, hay un tipo nuevo y hay que decidir su
traducción en el generador antes de seguir.
