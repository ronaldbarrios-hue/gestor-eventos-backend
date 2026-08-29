# Encender la identidad propia

Lo que falta de la fase 4 no es código: es configuración. Este documento son
los pasos, en orden, y lo que hay que mirar después de cada uno.

El código está escrito y probado (`modules/auth/`, 58 pruebas). Lo que hace este
documento es ponerlo a funcionar sin cortarle la sesión a nadie.

> **La regla que gobierna todo lo de abajo:** hasta el último paso, Supabase
> sigue siendo quien manda. Cada paso se puede deshacer apagando una variable.
> Si algo va mal, se apaga y se vuelve al estado de antes en un reinicio.

---

## 0 · Antes de tocar nada, dos comprobaciones que ahorran la tarde

**La consola de Google.** Hace falta acceso a la cuenta que registró el
`client_id` que usa Supabase hoy. No es difícil —es una pantalla— pero si se
descubre en el paso 5 que nadie tiene esa cuenta, afecta a **22 de los 29
usuarios**, que son los que entran con Google. Comprobarlo ahora.

**El dominio definitivo.** Hoy la API responde en `api.gestekeventost.dpdns.org`,
que parece de pruebas. La `redirect_uri` de Google conviene registrarla **una
sola vez, con el dominio bueno**: cambiarla después obliga a volver a la consola
y, entre medias, nadie entra con Google.

---

## 1 · Las bases de datos

En cPanel → **MySQL® Databases**. La cuenta admite dos bases y no hay ninguna
creada. **Se crean las dos**, y no es un capricho:

| Base | Qué guarda |
|---|---|
| `cuenta_gestek_auth` | Quién es cada persona: cuentas, identidades de Google, sesiones, tokens |
| `cuenta_gestek` | Todo lo demás: eventos, boletas, asistentes, archivos |

Separadas, un volcado de los datos del evento —una copia que se comparte, una
depuración— no lleva dentro ni un hash de contraseña ni una sesión viva. Y las
71 tablas se van a migrar módulo a módulo durante meses, mientras la identidad
ya está hecha: compartiendo base, cada paso de aquélla tendría que esquivar a
ésta.

> **Se puede empezar con una sola.** Si `MYSQL_DATOS_DATABASE` no se pone, todo
> usa la de identidad y funciona igual. `comprobar-base.js` lo dice en voz alta
> cuando eso pasa, para que no se quede así por olvido.

1. Crear las bases. cPanel les pone delante el prefijo de la cuenta: si se
   escribe `gestek`, la base se llama `cuenta_gestek`. **El nombre completo, con
   prefijo, es el que va en las variables.** Poner `gestek` a secas es el error
   de configuración número uno y da «Access denied», que suena a contraseña mala
   y no lo es.
2. Crear el usuario, y darle **todos los permisos** sobre las dos bases. Puede
   ser el mismo usuario para ambas: lo que se separa son los datos, no los
   permisos.
3. Arreglar el juego de caracteres. cPanel no lo pregunta y el servidor está en
   `utf8mb3`, así que la base nace mal. En phpMyAdmin → SQL:

   ```sql
   ALTER DATABASE `cuenta_gestek_auth` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ALTER DATABASE `cuenta_gestek`      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

   Esto hay que hacerlo **antes** de crear las tablas. Después, con datos
   dentro, es un `ALTER` por tabla y por columna con la aplicación parada.

4. Crear las tablas, **cada una en su base**:

   ```bash
   mysql -u cuenta_usuario -p cuenta_gestek_auth < db/migraciones/001_identidad.sql
   mysql -u cuenta_usuario -p cuenta_gestek      < db/migraciones/002_archivos.sql
   ```

   O pegando cada archivo en phpMyAdmin con la base correspondiente
   seleccionada — que es donde se cuela el error: la 002 en la base de
   identidad no da ningún aviso y deja el almacén sin sitio donde registrar.

**Comprobar:**

```bash
node scripts/comprobar-base.js
```

Tiene que decir `conexión en utf8mb4` y las cuatro tablas. Si dice utf8mb3, el
paso 3 no se hizo o se hizo después de crear las tablas.

---

## 2 · Las variables

En cPanel → **Setup Node.js App** → la aplicación → *Environment variables*.
Passenger las lee al reiniciar la aplicación, no al guardarlas.

| Variable | Valor | De dónde sale |
|---|---|---|
| `MYSQL_HOST` | `localhost` | En cPanel la base es local |
| `MYSQL_SOCKET` | `/var/lib/mysql/mysql.sock` | Opcional. Si está, se usa el socket en vez de TCP: más rápido y no gasta puertos |
| `MYSQL_USER` | `cuenta_usuario` | **Con prefijo** |
| `MYSQL_PASSWORD` | — | La del paso 1.2 |
| `MYSQL_DATABASE` | `cuenta_gestek_auth` | **Con prefijo.** La de identidad |
| `MYSQL_DATOS_DATABASE` | `cuenta_gestek` | **Con prefijo.** La del evento. Si se deja vacía, todo va a la de identidad |
| `JWT_SECRET` | 64 caracteres al azar | Se genera, no se reutiliza ninguno |
| `AUTH_PROPIA` | `false` **por ahora** | Se enciende en el paso 6 |
| `GOOGLE_CLIENT_ID` | el de Supabase, **idéntico** | Consola de Google |
| `GOOGLE_CLIENT_SECRET` | el de Supabase | Consola de Google |
| `GOOGLE_AUTH_REDIRECT` | `https://<api>/auth/google/callback` | Paso 5 |
| `FRONTEND_URL` | `https://<app>` | Ya debería estar |

El secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**No se reutiliza ningún secreto de Supabase.** Si el suyo se filtrara algún
día, los nuestros seguirían valiendo, y al revés. El único que sí viaja idéntico
es `QR_JWT_SECRET`, y por una razón concreta: los QR ya emitidos se firmaron con
él y tienen que seguir validando.

En producción, si `AUTH_PROPIA` está encendido y falta `JWT_SECRET`, **el
proceso no arranca**. Es a propósito: un secreto de desarrollo en producción es
lo mismo que no tener firma.

---

## 3 · Traer las 29 cuentas

Los hashes de contraseña viven en `auth.users`, que la API de Supabase no
expone. Sólo se llega por SQL. La consulta exacta está en la cabecera de
`scripts/migrar-usuarios-a-mysql.js`; se corre en el editor SQL de Supabase y se
guarda el resultado en un archivo.

> Ese archivo son las llaves de las 29 cuentas. Ni al repositorio, ni a un
> correo, ni a un chat. Se borra en cuanto termina la migración.

```bash
node scripts/migrar-usuarios-a-mysql.js --archivo volcado.json            # sólo mira
node scripts/migrar-usuarios-a-mysql.js --archivo volcado.json --aplicar  # escribe
node scripts/comprobar-base.js
```

La primera pasada no escribe nada: valida los UUID, comprueba que los hashes
son bcrypt, busca correos repetidos y avisa de las cuentas que se quedarían sin
forma de entrar. **Hay que leer lo que dice antes de aplicar.**

Lo que tiene que salir: 29 usuarios, 10 con contraseña, 22 con Google. Y el
descuadre conocido —10 con contraseña frente a 9 identidades de tipo `email`—
señala a una cuenta descolocada: el script la nombra.

Se puede repetir sin miedo: lo que ya existe se salta.

---

## 4 · Probar sin encender nada

Con `AUTH_PROPIA=false`, el módulo ni se monta. Para probarlo, se enciende **en
local**, no en el servidor:

```bash
AUTH_PROPIA=true MYSQL_HOST=... npm run dev
curl -s localhost:3000/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"tu@correo","password":"la tuya"}'
```

Tiene que devolver `access_token`, `refresh_token` y `usuario`. Si devuelve
`credenciales` con una contraseña que sabés que es buena, el hash no se migró
bien: mirar `comprobar-base.js`.

---

## 5 · Google

En la consola de Google → *Credenciales* → el cliente OAuth **que ya usa
Supabase** → *URI de redirección autorizados* → **añadir** (no sustituir):

```
https://api.gestekeventost.dpdns.org/auth/google/callback
```

Se añade, no se cambia: mientras Supabase siga encendido, su URI tiene que
seguir ahí o los usuarios que entren por el camino viejo se quedan fuera.

**El `client_id` tiene que ser el mismo.** Google identifica a cada persona con
un `sub` que es distinto para cada cliente. Con un cliente nuevo, los 22 `sub`
que se migraron no coinciden con nada, y esas 22 personas entrarían a cuentas
nuevas y vacías con sus eventos dentro de las viejas.

---

## 6 · Encender

Dos interruptores, y el orden importa:

1. **Backend** (`AUTH_PROPIA=true`) y reiniciar la aplicación. Ahora `/auth`
   responde, pero nadie lo llama todavía: el frontend sigue hablando con
   Supabase. Aquí ya se gana algo — el middleware verifica los tokens en local
   y deja de preguntarle a Supabase en cada petición.
2. **Frontend** (`VITE_AUTH_PROPIA=true` en Vercel) y volver a desplegar. A
   partir de aquí las sesiones nuevas son nuestras.

Las 21 sesiones que estén abiertas **no se cortan**: sus tokens son de Supabase
y el middleware los sigue aceptando por el camino de siempre hasta que caduquen.

**Para volver atrás:** apagar el del frontend. Las sesiones nuestras se pierden
—la gente vuelve a entrar— pero todo lo demás sigue igual, porque las cuentas
nunca se borraron de Supabase.

---

## 7 · Qué mirar los primeros días

- **Que nadie se queda fuera.** Los 22 de Google son el grupo grande; basta con
  que uno de ellos entre para saber que el `client_id` y los `sub` cuadran.
- **`comprobar-base.js`** cada mañana la primera semana: dice cuántas sesiones
  vivas hay, y si ese número no crece, algo no está entrando.
- **La tabla `sesiones` crece.** Es normal: una fila por dispositivo y por
  refresco. `repositorio.limpiarCaducados()` está escrita para el cron; conviene
  engancharla cuando haya tráfico de verdad.

---

# Encender el almacén propio

Va aparte de la identidad y con su propio interruptor (`ARCHIVOS_PROPIOS`): se
encienden en días distintos y se vuelve atrás por separado. Necesita la
identidad encendida, porque quien sube tiene que poder ser reconocido.

## A · El disco

```
ARCHIVOS_RAIZ=/home/cuenta/gestek-archivos
ARCHIVOS_URL_BASE=https://api.gestekeventost.dpdns.org/archivos
ARCHIVOS_CUOTA_BYTES=52428800
ARCHIVOS_X_ACCEL=            # sólo si hay Nginx delante; en cPanel, vacío
```

**`ARCHIVOS_RAIZ` fuera de la carpeta del código.** Si estuviera dentro, un
despliegue que reemplace el directorio se lleva por delante las fotos de todos
los eventos, y no hay copia. Y las tablas:

```bash
mysql -u cuenta_usuario -p cuenta_gestek < db/migraciones/002_archivos.sql
```

`ARCHIVOS_URL_BASE` es el prefijo que va a sustituir al de Supabase dentro de
las filas. Elegirlo bien **ahora**: cambiarlo después obliga a repetir la
reescritura de las 13 columnas. Sin comillas, sin barras invertidas y sin
espacios — cinco de esas columnas son JSON.

## B · Traer los archivos

```bash
node scripts/copiar-storage.js              # lista y cuenta, no baja nada
node scripts/copiar-storage.js --aplicar    # baja los referenciados
```

La primera pasada no baja nada: enseña cuántos objetos hay, cuántos referencia
alguna fila y cuántos no. De los 107, **40 son huérfanos y suman 28 MB** —más
de un tercio— y por defecto se quedan fuera: copiarlos es pagar dos veces un
trabajo que sólo mueve basura.

La ruta de destino es idéntica a la de origen (`bucket/carpeta/archivo`). Eso
es lo que convierte el paso siguiente en un cambio de prefijo.

## C · Servir las dos copias a la vez

Antes de reescribir nada, comprobar que una URL nueva responde:

```bash
curl -I https://api.gestekeventost.dpdns.org/archivos/avatars/<uid>/<archivo>
```

Y que las viejas **siguen respondiendo**. Las dos copias en paralelo durante
toda la ventana: si se apaga el origen antes de tiempo, cada portada sin migrar
es un hueco en una página pública de un evento publicado.

## D · Reescribir las URL

`db/migraciones/postgres/001_reescribir_urls.sql`, en el editor SQL de Supabase,
**entero y de una vez**. Termina en `ROLLBACK`: la primera pasada enseña los
conteos sin cambiar nada. Tienen que dar exactamente 16, 13, 5, 5, 4, 4, 3, 2,
1, 1, 1, 1, 1 — 57 filas, vueltas a medir el 29 de agosto. Si no cuadran,
parar: o alguien subió cosas desde entonces, o hay filas que la reescritura no
está alcanzando.

Cuando cuadren, cambiar `ROLLBACK` por `COMMIT` y repetir.

## E · Lo que cambia para quien usa la aplicación

Nada, si todo va bien. Por dentro sí cambian cuatro cosas, y las cuatro son
arreglos de problemas medidos:

- **La foto anterior se borra.** Hoy no la borra nadie, y por eso el
  almacenamiento pasó de 24 a 80 MB sin que se subiera más.
- **`form-uploads` deja de aceptar escritura de cualquiera.** La política de
  Supabase permitía escribir con la llave anónima, que va en el bundle del
  navegador. Ahora hace falta sesión o el código del expositor.
- **Las hojas de vida salen del bucket público** a una carpeta privada, servida
  con enlace firmado que caduca en quince minutos.
- **La subida de CV empieza a funcionar.** Nunca funcionó: el código mandaba
  PDF de 8 MB a un bucket que sólo admitía imágenes de 4 MB.

Lo último obliga a tocar los cinco uploaders del frontend, que hoy suben
directos a Supabase con `getPublicUrl()`. Ese cambio va con el interruptor del
frontend, no con éste.

---

## 8 · Lo que este documento NO cubre

- **Apagar Supabase Auth.** No se toca hasta que pasen unos días con todo el
  mundo entrando por lo nuestro. Mientras tanto, las cuentas están en los dos
  sitios a propósito.
- **La cookie `httpOnly`.** Hoy el token vive en `localStorage`, igual que lo
  dejaba Supabase. La cookie es mejor —un XSS no la lee— pero necesita que el
  frontend y la API estén bajo el mismo dominio, y hoy están en Vercel y en
  cPanel. Cuando los dos vivan bajo `gestekeventost.dpdns.org`, se cambia
  `src/lib/authPropia.js` y nada más.
- **Las otras 71 tablas.** Esto migra la identidad. Todo lo demás sigue en
  Supabase.
