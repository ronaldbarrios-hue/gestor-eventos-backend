# Fase 6 — lo que Postgres tiene y MySQL no

Lo medido sobre producción el 29 de agosto de 2026, y la decisión tomada para
cada cosa que no se traduce sola. Está escrito para que la decisión no haya que
volver a tomarla, y sobre todo para que se pueda **discutir**: si alguna está
mal, se ve aquí antes de tener los datos migrados encima.

## El tamaño del problema

| | |
|---|---|
| Tablas | 71 |
| Columnas | 829 |
| Claves foráneas | 156 (148 entre tablas de `public`, 8 hacia `auth.users`) |
| Índices | 225, de los cuales **32 parciales** |
| Disparadores | 13 |
| Funciones | 20 |
| Vistas | 4 |
| Tipos enumerados | 6 |

## Los tipos: no hay sorpresas

Las 829 columnas usan **diez** tipos y los diez se traducen:

| Postgres | n | MySQL | Por qué |
|---|---|---|---|
| `text` | 301 | `TEXT` / `VARCHAR(255)` | MySQL no indexa un TEXT sin prefijo. Ver abajo |
| `uuid` | 221 | `CHAR(36)` | No `BINARY(16)`: los UUID se leen en logs, URL y panel |
| `timestamptz` | 132 | `DATETIME(6)` | MySQL no guarda zona. Todo en UTC, como ya lo escribe el backend |
| `integer` | 65 | `INT` | |
| `jsonb` | 30 | `JSON` | |
| `boolean` | 28 | `TINYINT(1)` | |
| `numeric` | 10 | `DECIMAL(12,2)` / `DOUBLE` | Sin precisión declarada es plata → `DECIMAL(12,2)`. `numeric(53)` es `lat`/`lng` → `DOUBLE` |
| `ARRAY` | 8 | `JSON` | **Obliga a tocar código.** Ver abajo |
| `smallint` | 2 | `SMALLINT` | |
| `double precision` | 2 | `DOUBLE` | |

El generador **falla** si aparece un tipo fuera de esta lista, en vez de
inventarse una traducción. Una columna mal traducida en silencio se descubre
con los datos ya movidos.

### El tamaño de los VARCHAR no está inventado

55 columnas de texto participan en algún índice y por tanto no pueden quedarse
en `TEXT`. Se midió el largo real de todas:

- `push_subscriptions.endpoint` → 420
- `tickets.qr_token` → 253
- las otras 53 → **73 o menos**

De ahí `VARCHAR(255)` como norma y `VARCHAR(512)` para esas dos.

## Los seis tipos enumerados: no se usan

`estado_evento`, `estado_registro_tipo`, `modalidad_evento`, `rol_usuario`,
`tipo_notificacion`, `visibilidad_evento`.

**Ninguna columna los usa.** Cero. Son restos de un diseño anterior; los
estados de hoy son `text` con la validación en el código. No hay nada que
migrar y no hay que crear `ENUM` en MySQL.

Es la única parte de la fase 6 que resultó ser menos trabajo del previsto, y
conviene decirlo: el resto salió igual o peor.

## Los ocho arreglos: esto sí toca código

| Tabla | Columna | Tipo |
|---|---|---|
| `api_tokens` | `scopes` | `text[]` |
| `chat_channels` | `dm_users` | `uuid[]` |
| `chat_channels` | `rol_ids` | `uuid[]` |
| `event_members` | `custom_permissions` | `text[]` |
| `oauth_clients` | `redirect_uris` | `text[]` |
| `perfil_talento` | `habilidades` | `text[]` |
| `ticket_types` | `zonas_acceso` | `text[]` |
| `webhooks` | `eventos` | `text[]` |

Pasan a `JSON`. La columna guarda lo mismo, pero **lo que hoy se consulta con
`@>` o `= ANY(...)` deja de funcionar** y hay que reescribirlo con
`JSON_CONTAINS` / `MEMBER OF`.

`event_members.custom_permissions` es la que más importa: la lee
`core/permisos/cargarEvento()`, o sea el guardia de todas las rutas de evento.
Cuando se toque, la prueba de permisos tiene que seguir en verde.

Y un caso aparte: **`chat_channels.rol_ids` está indexada** con un índice GIN.
MySQL no indexa una columna JSON entera; hay que decirle qué se busca dentro,
con un índice multivalor (`CAST(rol_ids AS CHAR(36) ARRAY)`, MySQL 8.0.17 en
adelante). Es el único índice así, y el generador ya lo emite traducido.

## Los 32 índices parciales

MySQL no los tiene. Se parten en dos grupos que no se parecen en nada:

- **24 no son únicos.** La condición se tira y ya: el índice resultante cubre
  lo mismo y algo más. Sólo cuesta espacio. El generador los emite.
- **8 son únicos.** Éstos son el riesgo real de la fase 6, porque tirarles la
  condición convierte un índice que *permitía* repetidos en uno que los
  *prohíbe*. Van a mano en `003_esquema_indices_parciales.sql`, con el
  razonamiento de cada uno. De los ocho, cuatro se reproducen exactos con un
  `UNIQUE` normal (su condición es «esta columna no es nula» y esa columna está
  en la clave: MySQL, igual que Postgres, deja repetir los NULL) y cuatro
  necesitan una columna generada que valga NULL cuando la condición no se
  cumple.

## La colación: `as_ci`, no `ai_ci`

Cinco de los índices únicos comparan con `lower()`. La colación que todo el
mundo pone por costumbre, `utf8mb4_0900_ai_ci`, ignora mayúsculas **y
acentos**; `lower()` sólo ignora mayúsculas.

Con `ai_ci`, «José» y «Jose» chocarían donde hoy conviven, y una categoría de
torneo o una inscripción legítima empezaría a ser rechazada sin motivo visible.
`utf8mb4_0900_as_ci` es exactamente `lower()`. Es la que emite el generador.

## Las 8 claves hacia `auth.users`

Desde `agenda_favoritos`, `networking_citas`, `oauth_codes`, `oauth_tokens`,
`organizador_conexiones`, `profiles`, `sugerencias_dinamica` y `torneo_equipos`.

**Dejan de ser claves foráneas.** Los usuarios pasan a `usuarios`, en la base de
identidad, que puede ser una base distinta —es justo lo que permite
`core/db/mysql.js`—, y una clave foránea entre bases ata las dos para siempre.
Quedan como `CHAR(36)` con índice; la integridad la sostiene el código.

Es una pérdida real y hay que decirlo: hoy la base impide dejar una fila
huérfana y mañana no. Lo que lo compensa es que el borrado de una cuenta pasa
por un solo sitio (`modules/auth`), no por 8 tablas.

## Los 13 disparadores

| Tabla | Disparador | Función |
|---|---|---|
| `evento_email_plantillas` | `trg_touch_email_plantilla` | `fn_touch_email_plantilla` |
| `evento_legal` | `trg_evento_legal_version` | `evento_legal_version` |
| `eventos` | `trg_eventos_updated` | `set_updated_at` |
| `eventos` | `trg_puente_page_json` | `fn_puente_page_json` |
| `eventos` | `trg_seed_chat_channels` | `seed_chat_channels` |
| `eventos` | `trg_seed_event_roles` | `seed_event_roles` |
| `eventos` | `trg_seed_page_json` | `seed_page_json_v2` |
| `payment_transactions` | `trg_payment_tx_updated` | `set_updated_at` |
| `profiles` | `trg_profiles_updated` | `set_updated_at` |
| `sesion_inscripciones` | `trg_sync_inscritos_sesion` | `fn_sync_inscritos_sesion` |
| `tareas` | `trg_tareas_updated` | `set_updated_at` |
| `ticket_interacciones` | `trg_verificar_cuota_stand` | `fn_verificar_cuota_stand` |
| `tickets` | `trg_expositor_desde_boleta` | `fn_expositor_desde_boleta` |

Los cuatro `set_updated_at` se resuelven en el propio DDL, sin disparador:
`DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`.

Los otros nueve **se van al código**, no se reescriben en MySQL. Los tres
`seed_*` de `eventos` son los más claros: crear los canales de chat y los roles
al crear un evento es una decisión de producto, y hoy está escondida en un
disparador donde nadie la encuentra. En `modules/eventos` se ve, se prueba sin
base y se cambia sin migración.

Los dos que hay que mirar con cuidado son `trg_verificar_cuota_stand` y
`trg_sync_inscritos_sesion`, porque **cuentan**: un contador que se mantiene en
un disparador es atómico, y el mismo contador mantenido desde el código no lo
es si dos peticiones llegan a la vez. Van dentro de la misma transacción y con
`SELECT ... FOR UPDATE`, o el aforo de un stand se pasa de largo el día del
evento.

## Las 20 funciones

Siete las llama el backend por RPC y hay que reimplementarlas en el código:
`aforo_zonas`, `aforo_zonas_estancia`, `aforo_zonas_resumen`,
`aforo_zonas_serie`, `canjear_recompensa`, `find_pending_reminders`,
`generar_recordatorios_inapp`.

`canjear_recompensa` es la delicada: descuenta puntos y crea el canje, hoy en
una sola transacción de base. Si eso se parte en dos consultas sin transacción,
se puede canjear dos veces la misma recompensa.

Tres **desaparecen solas** al encender `AUTH_PROPIA`, porque son disparadores
sobre `auth.users` y esa tabla deja de existir: `handle_new_user`,
`sync_profile_from_auth_update`, `link_event_invitations`. Lo que hacían ya lo
hace `modules/auth/servicio.js`.

Las otras diez son auxiliares de los disparadores de arriba y se van con ellos.

## Las 4 vistas

`perfiles_publicos`, `v_bolsa_evento`, `v_consumo_puntos_stand`,
`v_participacion_sesiones`. MySQL tiene vistas, así que se rehacen a mano
traduciendo el SQL. `perfiles_publicos` es la que cerró la lectura anónima de
datos personales y **no puede quedarse fuera**.

## Lo que falta para que esto sea aplicable

1. ⏸ Correr el generador y guardar la salida como `003_esquema.sql`. Se corre
   contra Postgres y su salida cambia con el esquema, así que se hace lo más
   tarde posible, no ahora.
2. ✅ **Traducir las 4 vistas** → `004_vistas.sql`. Lo que no era mecánico:
   `FILTER (WHERE …)` no existe en MySQL y se hace con `CASE WHEN`, con
   `ELSE 0` en las sumas para que un grupo vacío dé 0 y no NULL. Comprobado
   contra Postgres con datos que ejercitan los tres casos —positivos y
   negativos mezclados, sólo negativos, y grupo sin filas—: los mismos números.
   Y `v_bolsa_evento` va DESPUÉS de `v_consumo_puntos_stand`, porque la lee.
3. ⏸ El script de carga de datos.
4. ✅ **Los contadores** → `modules/contadores/`. Los tres sitios donde la base
   cuenta por nosotros (cuota del stand, inscritos de un sub-evento, canje),
   con transacción y `SELECT … FOR UPDATE`. Sin el bloqueo la transacción sola
   no basta: MySQL en REPEATABLE READ deja que dos escaneos lean lo mismo, y el
   stand reparte 520 de una cuota de 500.

   Dos cosas que **mejoran** sobre el original y conviene no deshacer:
   · `canjear_recompensa` sólo bloqueaba la recompensa, así que dos canjes de
     recompensas DISTINTAS por la misma persona podían descontar los dos del
     mismo saldo. Ahora el saldo también va bloqueado.
   · El cupo del sub-evento se comprobaba en el código y fuera de transacción:
     dos personas veían el mismo «queda 1» y las dos entraban.

   Doce pruebas, que se corren **sin base**: comprueban qué SQL se emite y en
   qué orden. Una prueba que necesitara MySQL no se correría nunca y esto se
   quedaría sin red justo donde más falta hace.

   ⚠️ No se llama desde ninguna ruta todavía, a propósito: los datos siguen en
   Supabase y allí los disparadores hacen su trabajo.

   ✅ **Los seed_\*** → `modules/eventos/semillas.js`. Los cuatro canales, los
   diez roles con sus permisos exactos y los siete bloques de la página. Aquí
   no había trampa de concurrencia —crear canales no compite con nadie—; lo que
   se gana es que la decisión de producto se pueda leer, cambiar sin migración
   y probar sin base. Los ids de los bloques son fijos (`sys_*`) y no
   aleatorios: un embed exportado «de esta sección exacta» apunta a uno.

   ✅ **Las cuatro de aforo** → `modules/aforo/consultas.js`. Siguen siendo SQL
   y no JavaScript a propósito: sólo leen, y la razón por la que se hicieron en
   la base sigue en pie —traerse las filas y sumarlas en el backend es lo que
   hacía que a partir del movimiento 1.001 el aforo mintiera por lo bajo—. Lo
   único que cambia es que el SQL vive donde se lee y se prueba.

   Tres traducciones que no eran mecánicas, y las tres comprobadas contra
   Postgres antes de darlas por buenas:
   · `FILTER (WHERE …)` → `CASE WHEN`, igual que en las vistas.
   · `array_agg(x ORDER BY y DESC)[1]` → `ROW_NUMBER()`. Es «el nombre más
     reciente de la zona», y se probó con una zona renombrada, que es el caso
     por el que existe.
   · `to_timestamp(floor(epoch/n)*n)` → `FROM_UNIXTIME`. Comprobados los cuatro
     bordes de la franja: caen al mismo lado.

   ⚠️ **Y una trampa que apareció al traducir la última**: `UNIX_TIMESTAMP` usa
   la zona de la SESIÓN de MySQL, no la del driver. `core/db/mysql.js` ponía
   `timezone: 'Z'`, que es una opción de mysql2 y no toca la sesión. Como el
   esquema guarda todo en UTC, una sesión con la zona del servidor —en cPanel
   suele ser la del país— habría leído esas fechas como locales: el pico de
   aforo de las 8 de la noche saldría a las 3 de la tarde y **nada fallaría de
   forma visible**. Ahora cada conexión del pool hace `SET time_zone = '+00:00'`
   y la zona sale en la comprobación de vida, junto al juego de caracteres, por
   la misma razón: los dos fallan en silencio y con datos ya escritos.
5. ⏸ Una prueba que compare fila a fila las dos bases antes del corte.
