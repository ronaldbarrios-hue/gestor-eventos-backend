# Pasar los datos a MySQL

Instrucciones para quien cree la base en cPanel. Está escrito para poder
seguirse sin haber estado en las conversaciones anteriores.

> ## 🚨 `03_datos.sql` NO se puede cargar tal cual: le faltan 74 boletas
>
> Medido el **4 de septiembre de 2026** contra producción:
>
> | | volcado (30 ago) | hoy | |
> |---|---|---|---|
> | **`tickets`** | **45** | **119** | **+74 boletas vendidas** |
> | `padron_previo` | 0 | 4.124 | +4.124 |
> | `event_views` | 947 | 1.409 | +462 |
> | `notificaciones` | 2 | 78 | +76 |
> | `zonas` | 0 | 12 | la tabla ni existía |
> | **total** | **2.139** | **7.148** | **+5.009** |
>
> Y hay filas que se **borraron** desde entonces (`categorias` 9→0,
> `recompensas` 5→0, `user_badges` 10→4): cargar el volcado viejo no sólo
> pierde lo nuevo, también resucita lo borrado.
>
> **Hay que regenerarlo antes de cargarlo.** El script está y funciona:
>
> ```bash
> npm i pg
> export PG_URL='postgresql://postgres:<PASS>@<HOST>:5432/postgres?sslmode=require'
> node db/esquema/generar-datos.mjs
> ```
>
> La contraseña se pide — no está en el repositorio y no debe estarlo. Y se
> regenera **el día del corte**, no antes: mientras Supabase siga vivo, cada
> día que pasa el volcado vuelve a quedarse corto.
>
> El esquema es otra cosa y sí tiene arreglo escrito: sigue leyendo.

> ## ⚠ El volcado de ESQUEMA está desfasado, y hay un archivo que lo pone al día
>
> `db/esquema/` se generó el **30 de agosto de 2026**. Después se aplicaron diez
> migraciones en Supabase (0092–0101). La diferencia está medida y escrita en
> **`005_al_dia.sql`**, y el orden es:
>
> 1. `003_esquema.sql` — las tablas
> 2. sus índices y sus claves foráneas
> 3. **`005_al_dia.sql`** ← esto
> 4. los datos
>
> El paso 3 va **antes** del 4: añade columnas obligatorias, y si los datos
> entraran primero la carga fallaría fila por fila.
>
> Lo más importante que trae: **la tabla `zonas`, que el volcado no tiene**. De
> ella comen el plano del evento, el selector de zona de un sub-evento, el
> escáner de ingreso y el bloque de mapa de la página pública. Ya hubo un
> apagón por esto —cuatro pantallas en blanco durante horas, sin un solo error—
> y saltárselo lo repite.

Lo medido aquí es del **30 de agosto de 2026** sobre producción. Antes de
empezar, vuelve a medirlo: los números de abajo son para decidir el método, y
si han cambiado mucho, la decisión cambia.

---

## Lo primero, porque cambia el plan entero

La base **son unas 2.000 filas**.

| Tabla | Filas |
|---|---|
| `event_views` | 917 |
| `audit_log` | 283 |
| `event_roles` | 273 |
| `chat_channels` | 133 |
| `event_form_fields` | 44 |
| `tickets` | 43 |
| `oauth_tokens` | 34 |
| `eventos` | 33 |
| las otras 33 con datos | menos de 30 cada una |
| **30 tablas** | **vacías** |

De 71 tablas, **30 no tienen ni una fila**. Y las tres más grandes son
registros de auditoría y de visitas, no datos de negocio.

Esto importa porque descarta el enfoque caro. No hace falta un proceso por
lotes, ni paginación, ni cargar de noche: cabe en un archivo que se importa por
phpMyAdmin de una vez. Si alguien propone montar una tubería de migración para
esto, está resolviendo un problema que no existe.

**Comprueba tú mismo que sigue siendo así** antes de nada:

```sql
select relname, n_live_tup from pg_stat_user_tables
where schemaname='public' and n_live_tup > 0 order by 2 desc;
```

Si `event_views` o `audit_log` han crecido a cientos de miles, esas dos se
cargan aparte —o directamente no se cargan, ver más abajo— y el resto sigue
igual de pequeño.

---

## Lo que ya está escrito y no hay que rehacer

| Archivo | Qué es |
|---|---|
| `001_identidad.sql` | Las tablas de usuarios y sesiones de la base de identidad |
| `002_archivos.sql` | El registro del almacén propio de archivos |
| `generar-esquema-mysql.sql` | **Genera** las 71 `CREATE TABLE`, los índices y las claves foráneas |
| `003_esquema_indices_parciales.sql` | Los 8 índices únicos parciales, escritos a mano uno por uno |
| `004_vistas.sql` | Las 4 vistas |
| `NOTAS-ESQUEMA.md` | Por qué cada tipo se traduce como se traduce |

Lo único que **no** existe es el volcado de los datos. Es lo que describe este
documento.

---

## El orden. No es negociable

1. **Crear el esquema.** Corre `generar-esquema-mysql.sql` **contra Postgres**
   (el editor SQL de Supabase vale; es de sólo lectura, no toca nada). Devuelve
   una fila por sentencia. Pega la columna `ddl` en un archivo: eso es tu
   `003_esquema.sql`.

   Da tres bloques, en este orden: las tablas, los índices, y las claves
   foráneas. **Sepáralos**, porque no se aplican a la vez.

2. **Aplicar las tablas** en MySQL. Sólo las tablas.

3. **Aplicar `003_esquema_indices_parciales.sql`.**

4. **Cargar los datos** (la parte de abajo).

5. **Aplicar los índices** que dio el generador.

6. **Aplicar las claves foráneas** que dio el generador.

7. **Aplicar `004_vistas.sql`.**

8. **Verificar** con `node scripts/comparar-bases.js`.

Los índices van **después** de los datos porque insertar con los índices
puestos es varias veces más lento. Con 2.000 filas da lo mismo, pero el orden
está pensado para que siga valiendo cuando no sean 2.000.

Las claves foráneas van **al final** por una razón que sí importa siempre: hay
156 claves y ciclos entre tablas. No existe un orden de carga que las respete
todas. Si las pones antes, vas a acabar desactivándolas a mano, que es peor.

---

## Sacar los datos

Hay tres caminos. **El primero es el recomendado** para este tamaño.

### A · `pg_dump`, y luego arreglar lo que no es MySQL

Necesitas la cadena de conexión de Postgres, que está en el panel de Supabase
en *Project Settings → Database*. **Esa contraseña no está en el repositorio ni
en este documento**: pídesela a quien administre el proyecto.

```bash
pg_dump "$CADENA_POSTGRES" --data-only --inserts --column-inserts \
  --schema=public --no-owner --no-privileges > datos-crudos.sql
```

`--column-inserts` es lo que hace esto viable: escribe cada `INSERT` con los
nombres de las columnas, así que no depende del orden y se puede leer y
corregir a mano.

Lo que sale **no es MySQL todavía**. Hay que arreglar cinco cosas, y están
listadas en la sección siguiente.

### B · Exportar tabla por tabla desde el panel

El editor de tablas de Supabase exporta cada tabla a CSV. Son 41 clics y no
necesita contraseña de base de datos.

Sirve, pero el CSV **pierde la diferencia entre `NULL` y cadena vacía**, y esa
diferencia es justo la que hay que conservar: en las respuestas de un
formulario no es lo mismo «no contestó» que «contestó vacío». Si vas por aquí,
en la verificación del paso 8 esas columnas van a salir distintas y vas a tener
que decidir una por una. **Sólo si el camino A está bloqueado.**

### C · Escribir un script que lea y escriba

Es lo que se descartó. Para 2.000 filas, el script tarda más en escribirse y
en depurarse que la carga en hacerse a mano, y añade una pieza que hay que
mantener. Si las tablas grandes crecen mucho, se reconsidera — pero entonces la
decisión sería no migrar `event_views` ni `audit_log`, no automatizar su carga.

---

## Las cinco cosas que hay que convertir

Esto **no** es opcional, y es donde se pierde el tiempo si no se sabe de
antemano. Los números son de las 71 tablas.

### 1 · Las fechas: 132 columnas

Postgres escribe `2026-09-01 10:00:00+00`. MySQL no guarda zona horaria y no
entiende ese `+00`.

**Todo va en UTC**, que es como el backend ya lo escribe. Quita el sufijo de
zona y deja `2026-09-01 10:00:00.000000`.

Y antes de cargar nada, en la sesión de MySQL:

```sql
SET time_zone = '+00:00';
```

Esto es una trampa fácil de pisar. El conector de Node se configura con
`timezone: 'Z'`, pero **eso es una opción del conector y no cambia la zona de
la sesión del servidor**, que es la que usa `UNIX_TIMESTAMP`. Sin este `SET`,
los picos de aforo salen desplazados varias horas y todo lo demás parece
correcto. Ya está puesto en `core/db/mysql.js` para la aplicación; hace falta
también en la sesión desde la que cargues.

### 2 · Los arreglos: 8 columnas

Postgres tiene arreglos y MySQL no. Pasan a `JSON`, y hay que reescribir el
valor: `{read}` deja de valer, tiene que ser `["read"]`.

Son estas ocho, y no hay más:

```
api_tokens.scopes              chat_channels.dm_users
chat_channels.rol_ids          event_members.custom_permissions
oauth_clients.redirect_uris    perfil_talento.habilidades
ticket_types.zonas_acceso      webhooks.eventos
```

De ellas, sólo tres tienen datos hoy (`event_members.custom_permissions`,
`chat_channels.rol_ids` y `oauth_clients.redirect_uris`), así que es un rato de
buscar y reemplazar, no un problema.

**Ojo con `chat_channels.rol_ids`**: en Postgres tiene un índice GIN, y en
MySQL eso pasa a ser un índice multivalor. El generador lo emite ya traducido;
no lo escribas tú a mano.

### 3 · Los booleanos: 28 columnas

Postgres escribe `t` y `f`. MySQL los quiere `1` y `0`. `TRUE`/`FALSE` también
le valen, pero `t`/`f` no.

### 4 · El JSON: 30 columnas

Se traducen solas, con dos avisos:

- Postgres escapa a su manera (`E'...'`, comillas dobladas). Revisa que las
  comillas dentro del JSON sobrevivan.
- `page_json` es la columna grande y la que más duele si se rompe: lleva la
  landing entera de cada evento. Compruébala aparte al terminar, abriendo un
  evento en la aplicación.

### 5 · Los `NULL`

Se quedan `NULL`. **No los conviertas en cadena vacía.** Es la diferencia entre
«no contestó» y «contestó vacío», y es lo que la verificación del paso 8
vigila.

---

## Verificar. Este paso decide si el corte se hace

```bash
node scripts/comparar-bases.js            # todas las tablas
node scripts/comparar-bases.js eventos    # sólo algunas
node scripts/comparar-bases.js --detalle  # además, qué fila difiere
```

Lee de los dos lados y no escribe en ninguno.

**Contar filas no basta**, y es la comprobación que todo el mundo hace. Una
carga que trunca un texto a 255, que pierde los microsegundos de una fecha o
que convierte un `null` en cadena vacía deja exactamente el mismo número de
filas. Por eso el script compara además una huella del contenido entero de cada
tabla.

Si algo no cuadra: **vuelve a correr la carga entera**, no parchees filas a
mano. Una fila parcheada deja la duda de cuántas más habrá.

---

## Lo que este documento NO puede decirte todavía

Con la información que hay hoy, estas tres cosas no se pueden dejar cerradas.
No es que falten por escribir: es que dependen de algo que aún no existe.

1. **La contraseña de Postgres y las credenciales de la MySQL nueva.** Ninguna
   de las dos está —ni debe estar— en el repositorio. Sin la primera, el camino
   A no se puede intentar.

2. **Si `event_views` y `audit_log` se migran o se dejan atrás.** Son las dos
   más grandes (917 y 283 filas hoy) y las dos son registro histórico, no datos
   de negocio: la plataforma funciona igual sin ellas. Empezar de cero en la
   base nueva es una opción legítima y ahorra la mitad del volumen. **Es una
   decisión de producto, no técnica** — que la tome quien corresponda antes de
   cargar, no después.

3. **Qué falla de verdad en la primera pasada.** Se sabrá al hacerla, contra la
   base real. Por eso el paso 8 existe y por eso la instrucción cuando algo no
   cuadra es repetir la carga: la primera vez es la que enseña lo que no se
   había previsto.

Y un recordatorio que no es de este documento pero rompe todo si se olvida:
**hasta que la migración esté terminada y verificada, Supabase se queda
encendido**. `AUTH_PROPIA` y `ARCHIVOS_PROPIOS` siguen apagados. Crear la base
MySQL y cargarla no apaga nada; encender esos dos interruptores, sí.
