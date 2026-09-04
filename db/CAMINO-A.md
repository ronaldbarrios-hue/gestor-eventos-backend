# Camino A · salir de Supabase a servidor propio — traspaso

Comprobado contra la base de producción y contra este repo el **2026-09-03**.

Esto es para quien vaya a continuarlo. Dice **qué está hecho de verdad**, qué
falta, con qué herramientas se hace y **qué le va a faltar** cuando llegue.

> **La regla que manda sobre todo lo demás:** Supabase **no se apaga** hasta que
> lo nuevo esté conectado y probado. Hay un evento con gente comprando. Las
> banderas `AUTH_PROPIA` y `ARCHIVOS_PROPIOS` se quedan **apagadas**; ya lo
> están por defecto.

---

## Estado al 4 de septiembre de 2026 — el otro desarrollador ya empezó

Hecho por él, y comprobado:

- `gestek_auth` y `gestek_datos` creadas en cPanel, con `gestek_app` y permisos
  en las dos.
- Cotejos correctos: `utf8mb4_unicode_ci` en auth, `utf8mb4_0900_as_ci` en datos.
- `001_identidad.sql` cargado en auth, `002_archivos.sql` en datos.
- Variables puestas en la app (`MYSQL_*`, `JWT_SECRET`, `AUTH_PROPIA=false`) y
  la app reiniciada. `/health` responde.

`AUTH_PROPIA=false` es lo correcto ahora mismo: las tablas de identidad existen
pero **nadie entra todavía por ellas**. Se pone en `true` el día del corte, no
antes, y ese día hay que haber pasado los usuarios — que es el paso que no
tiene archivo todavía.

**Lo siguiente que le toca**, en este orden:

1. `003_esquema.sql` (las tablas del volcado) + sus índices y claves foráneas
2. **`005_al_dia.sql`** ← el archivo nuevo, ver más abajo
3. los datos
4. **`generar-usuarios-mysql.sql`** ← las cuentas, para que `gestek_auth` no
   esté vacía el día del corte

El paso 4 es un **generador**: se corre en el editor SQL de Supabase y su
salida se pega en `gestek_auth`. Es un generador y no un archivo con los datos
dentro porque ahí van hashes de contraseña, y un archivo con hashes se queda en
el repositorio, en el historial de git y en el portapapeles de quien lo abra.

Medido el 4 de septiembre: **29 cuentas, 10 con contraseña, 22 con Google, y
cero sin ninguna forma de entrar**. Ese cero es el que decide si se puede
encender `AUTH_PROPIA` — hay que volver a mirarlo el día del corte, porque la
gente se sigue registrando.

## ⚠ El volcado está desfasado — hay un archivo que lo pone al día

`db/esquema/` se generó el **30 de agosto**. Después entraron diez migraciones
(0092–0101). Medido contra producción el 4 de septiembre:

| | |
|---|---|
| Tablas en Postgres hoy | **69** |
| Tablas en el volcado | 72 |
| Tablas del volcado que ya no existen | 4 (`missions`, `referral_codes`, `waitlist`, `recordatorio_inapp_log`) |
| Tablas que al volcado le **faltan** | **1 — `zonas`, entera** |
| Tablas con columnas distintas | 9 |

`zonas` es la grave. De ella comen el plano del evento, el selector de zona de
un sub-evento, el escáner de ingreso y el bloque de mapa de la página pública.
Cargar el volcado tal cual y arrancar contra él repite el apagón de la 0092:
cuatro pantallas en blanco, sin un solo error.

Todo eso está en **`db/migraciones/005_al_dia.sql`**, con las 12 filas de zonas
dentro. Se corre entre el esquema y los datos.

## Lo primero, porque invalida parte de lo hecho

**El volcado del esquema es de antes de las últimas cinco migraciones.**

`db/esquema/*.sql` se generó el **1 de septiembre**. Entre el 2 y el 3 se
aplicaron en producción las migraciones **0091 a 0096**. Comprobado tabla por
tabla contra `information_schema`:

| Falta en el volcado MySQL | Lo trajo |
|---|---|
| La tabla **`zonas`** entera (y su columna `tipo`) | 0091 · 0094 |
| `ticket_types.crea` y `ticket_types.crea_torneo_id` | 0093 |
| `torneo_equipos.respuestas` | 0095 |

Las otras **72 tablas sí están**, y ninguna sobra: Postgres tiene 73 y el
volcado 72, y la que falta es exactamente `zonas`.

**Qué significa:** quien monte MySQL hoy con estos archivos tendrá una base
donde el código actual **no arranca del todo** — las zonas del evento no
existirían—. No hay que rehacer nada a mano: hay un generador (abajo). Pero
**hay que volver a correrlo antes de nada**, y volver a correrlo cada vez que se
aplique una migración nueva mientras dure la mudanza.

Y lo mismo vale para `03_datos.sql`: son los datos del 1 de septiembre. Sirve
para probar; **no sirve para el corte**.

---

## Lo que SÍ está hecho, y es la mayor parte

| Paso | Estado | Dónde |
|---|---|---|
| 1 · Esquema MySQL | ✅ generado (falta regenerar, ver arriba) | `db/esquema/01…06`, generador en `db/migraciones/generar-esquema-mysql.sql` |
| 2 · Las 4 vistas | ✅ traducidas, `perfiles_publicos` incluida | `db/esquema/06_vistas.sql` |
| 3 · Carga de datos | ✅ script escrito y probado | `db/esquema/generar-datos.mjs` |
| 4 · 9 disparadores + 7 RPC | ✅ reescritos en código | `modules/` — el reparto exacto está en `db/migraciones/NOTAS-ESQUEMA.md` |
| 5 · Comparar las dos bases | ✅ cubre las ~70 tablas y avisa si el esquema gana una que no conoce | `scripts/comparar-bases.js` |
| 6 · Importar al servidor nuevo | ⬜ **pendiente** | — |
| 7 · Crear la base en cPanel y desplegar | ⬜ **pendiente** | `CONFIGURAR.md` |

Los dos contadores que de verdad cuentan —cupo del stand e inscritos por
sesión— ya van con transacción y `SELECT … FOR UPDATE` en
`modules/contadores/index.js`. **Eso no es un detalle:** en Postgres lo
garantizaba un disparador, y sin bloqueo el aforo de un stand se pasa de largo
el día del evento, cuando ya no hay forma de arreglarlo.

---

## Lo que queda, en el orden en que hay que hacerlo

### 1. Regenerar el esquema y los datos

> **Los datos están MUY viejos.** Medido el 4 de septiembre: el volcado tiene
> 2.139 filas y producción 7.148. `tickets` va de 45 a **119** — son 74 boletas
> vendidas que no están en el archivo. Y hay filas borradas desde entonces, así
> que cargarlo tal cual además resucita lo que ya no está.
>
> El esquema, en cambio, ya tiene la diferencia escrita en `005_al_dia.sql`.
> Los datos no se pueden arreglar con un delta: hay que volver a generarlos, y
> **el día del corte**, porque cada día que Supabase siga vivo el volcado se
> queda corto otra vez.

```bash
npm i pg                      # dependencia sólo de estos scripts, a propósito fuera de package.json
export PG_URL='postgresql://postgres:<PASS>@<HOST>:5432/postgres?sslmode=require'
node db/esquema/generar-datos.mjs
```

La cadena está en Supabase → *Project Settings → Database → Connection string →
Session pooler*. **La contraseña no está en el repo**: hay que pedirla.

Para el esquema, correr `db/migraciones/generar-esquema-mysql.sql` contra
Postgres y guardar la salida. Los detalles de las conversiones —fechas a UTC,
arreglos a JSON, la colación— están en `db/migraciones/CARGA-DE-DATOS.md`.

**La colación es `utf8mb4_0900_as_ci`, no `ai_ci`.** Con `ai_ci`, «José» y
«Jose» chocan donde hoy conviven, y el choque aparece al insertar, a mitad de
carga.

### 2. Crear la base en cPanel y cargar

`CONFIGURAR.md` tiene las variables. Se puede empezar con **una sola base**: si
`MYSQL_DATOS_DATABASE` no se pone, todo va a la de identidad.

### 3. Comparar fila a fila, ANTES del corte

```bash
node scripts/comparar-bases.js            # todas
node scripts/comparar-bases.js --detalle  # además, qué fila difiere
```

Este es el paso que decide si se corta o no. Antes decía «Todo cuadra»
comparando 24 de 72 tablas; ahora cubre todas y avisa si el esquema real gana
una que la lista no conoce.

### 4. Sólo entonces, encender las banderas

Y de una en una, con Supabase todavía en pie.

---

## La API: lo que cambia al mover el servidor, y no es sólo la base

Esto no estaba escrito y muerde en el momento del corte, cuando ya no hay tiempo
de investigar.

**Al cambiar de servidor cambia el origen, y con él dos cosas:**

1. **`CORS_ORIGINS`** — la lista de orígenes que pueden llamar a la API desde un
   navegador. Si el frontend se queda donde está y el backend se muda, esa lista
   sigue valiendo; si también se mueve el frontend, hay que añadir el nuevo
   **antes** de cortar, o la página se queda en blanco sin decir por qué: un
   rechazo de CORS le llega al navegador como «Failed to fetch» y nada más.
   Desde el 2026-09-03 el servidor lo deja dicho en el log (`[cors] origen no
   autorizado: …`), que es dónde hay que mirar.

2. **`FRONTEND_URL`** — la dirección **canónica**, la que va dentro de los
   correos. Es UNA. Hasta hoy esa misma variable hacía los dos trabajos, y por
   eso añadir un segundo origen habría mandado enlaces con dos dominios pegados.
   Ya están separadas (`lib/frontend.js`), pero al mudarse hay que poner las dos.

**Y una que se olvida siempre:** el frontend apunta al backend con
`VITE_API_URL`, que se compila **dentro** del paquete. Cambiar el backend de
sitio obliga a **volver a construir y desplegar el frontend**, no sólo a cambiar
una variable en el servidor. Si el corte se planea como «muevo la base y la API
un domingo», ese despliegue va en el mismo domingo.

### El orden que evita la ventana en blanco

1. Levantar la API nueva **en paralelo**, con la base ya cargada y comparada.
2. Añadir el origen del frontend a `CORS_ORIGINS` de la API nueva.
3. Comprobar contra la API **nueva** con una petición pública, sin sesión:

   ```bash
   curl -s https://<api-nueva>/eventos/publicos/slug/<un-slug> | head -c 200
   ```

4. Reconstruir el frontend con `VITE_API_URL` apuntando a la nueva y desplegarlo.
5. La vieja se apaga **después**, no antes. Igual que Supabase.

---

## Lo que le va a faltar a quien lo retome

Esto no se resuelve con código:

1. **La contraseña de Postgres de Supabase.** Sin ella no hay volcado.
2. **La base MySQL en cPanel** creada, con su usuario y su contraseña — y el
   usuario **lleva prefijo de cuenta**, que es el error clásico de cPanel.
3. **Decidir qué pasa con `auth.users`.** Los usuarios viven en Supabase Auth y
   `001_identidad.sql` es sólo la tabla; migrar las contraseñas es otro asunto,
   y `AUTH_PROPIA` sigue apagada. **Mientras siga apagada, el login sigue
   dependiendo de Supabase aunque los datos ya estén en MySQL.** Esa es la
   dependencia que más gente da por resuelta sin estarlo.
4. **Decidir qué pasa con Storage.** `ARCHIVOS_PROPIOS` está apagada y
   `scripts/copiar-storage.js` existe pero no se ha corrido contra nada real.

---

## Fusionar no es desplegar, y en este frente muerde el doble

Esto ya nos costó horas una vez —la 0092— y va a volver a pasar mientras la
base y la API se desplieguen por separado.

**El patrón, siempre el mismo:** una migración cambia el dato de sitio. El
código que lo lee del sitio nuevo está fusionado en `main`. Pero la API
desplegada todavía sirve el código viejo, que mira el sitio de antes. Y
entonces **no falla nada**: no hay error, no hay log, no hay pantalla roja.
Simplemente no hay datos. Cuatro pantallas en blanco a la vez y nadie sabe por
qué, porque no hay nada que buscar.

Casos medidos en este repo:

| Migración | Lo que pasó mientras la API iba por detrás |
|---|---|
| 0092 (zonas salen de `page_json`) | Zonas, selector de zona, escáner y mapa de la landing: **en blanco durante horas, sin un solo error** |
| 0099 (promociones al cobro) | El código de descuento se acepta, se dice que vale… y **se cobra el precio de lista**. Sin error, sin aviso, y con el dinero ya cobrado |

La 0099 es peor que la 0092 en un punto concreto: la 0092 dejaba una pantalla
vacía, que se ve. Ésta deja un **cobro correcto por el importe equivocado**, que
no se ve hasta que alguien reclama.

**La comprobación, y son dos minutos.** Contra la API DESPLEGADA, nunca contra
la rama:

```bash
curl -s https://api.gestekeventost.dpdns.org/eventos/publicos/slug/technova-summit-2026 | grep -o '"zonas"'
```

Si no imprime nada, la API no tiene el código nuevo por más que `main` sí.

**Por qué esto es del Camino A y no una anécdota de despliegue.** Hoy son dos
despliegues —Supabase por su lado, Render por el suyo— y por eso hay una ventana
en la que no coinciden. Al mover la base al servidor propio la ventana no
desaparece: cambia de sitio. En cPanel el `git pull` y el `mysql <` los va a
correr una persona, seguidos, a mano — y el orden entre los dos va a ser el que
decida si esa ventana dura diez segundos o toda la tarde.

**La regla que hay que escribir en el procedimiento de despliegue:**

- Migración que **añade** (expand): primero la base, después el código. El
  código viejo ignora una columna nueva.
- Migración que **quita o mueve** (contract): primero el código, después la
  base. Y sólo cuando lleve días sirviéndose el código que ya no la necesita.
- **Nunca** las dos a la vez confiando en que van rápido.

---

## Dos cosas que hay que saber antes de tocar

**`modules/aforo/consultas.js` está muerto a propósito.** Es la traducción a
MySQL de las cuatro funciones de aforo, y no lo llama nadie todavía. No es
código olvidado: es de este frente. Su propio comentario lo dice.

**`generar_recordatorios_inapp` nunca ha funcionado.** Inserta en
`notificaciones` una columna `link` que esa tabla no tiene, así que revienta en
la primera fila. Al reimplementarla en código, la tentación es copiarla tal
cual — copiaría el fallo.

Corrección del 2026-09-03: aquí ponía «**0 filas** en `notificaciones` en toda
su historia», y eso ya no es verdad — la tabla tiene 62. Lo que sigue siendo
verdad es más preciso y más útil: **ninguna es de tipo `recordatorio`**. Las 62
son `reserva` (61) y `alerta` (2), escritas por otro camino que sí funciona. La
consulta que no miente:

```sql
select tipo, count(*) from public.notificaciones group by tipo;
```

Si algún día sale un `recordatorio`, es que alguien lo arregló y esta nota
sobra.

---

## Cómo saber si esto sigue al día

Si se aplicó una migración después del **2026-09-03**, este documento y
`db/esquema/` están otra vez por detrás. La comprobación son dos consultas:

```sql
-- en Postgres
select table_name from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE' order by table_name;
```

y contarlas contra las `CREATE TABLE` de `db/esquema/01_tablas.sql`:

```bash
grep -oE 'CREATE TABLE `[a-z_]+`' db/esquema/01_tablas.sql | sort -u | wc -l
```

Hoy: **73 en Postgres, 72 en el volcado**. Cuando coincidan, el esquema está al
día; mientras no, hay que regenerar antes de seguir.

Y `grep -c` a secas no vale: cuenta líneas, no tablas, y una línea de comentario
que diga «CREATE TABLE» la cuenta igual.
