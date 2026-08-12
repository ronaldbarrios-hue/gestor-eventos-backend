# GESTEK · Credenciales y estado del despliegue

Lo que hay que rellenar en el servidor para que las cosas funcionen, y en qué
estado está cada pieza. Se escribe aquí porque el `.env.example` dice **qué**
variables existen, y esto dice **cuáles faltan de verdad ahora mismo y qué se
rompe sin ellas**.

Última revisión: 12 de agosto de 2026. Comprobado contra el código y contra la
base de datos, no de memoria.

---

## 1 · Lo que está bloqueando ahora

### Correo — no sale nada, y no avisa

**Es el bloqueo más grande.** Comprobado ejecutando el diagnóstico:

```
configurado: false
candidatos: { cpanel: false, gmail: false, resend: false }
FRONTEND_URL: null
```

Sin proveedor, `sendMail` devuelve `{ ok: false, skipped: 'no_provider' }` y el
correo **se descarta en silencio**: la boleta se emite, el miembro se crea, la
inscripción queda — y nadie se entera de que el correo no salió. Eso afecta a
boletas con QR, recordatorios, invitaciones al equipo, tareas y campañas.

Hay que rellenar **una** de las tres opciones. El código las prueba en este
orden y se queda con la primera completa:

| Opción | Variables | Notas |
|---|---|---|
| **A · cPanel SMTP** (la de producción) | `CPANEL_SMTP_USER`, `CPANEL_SMTP_PASS`, `CPANEL_SMTP_HOST`, `CPANEL_SMTP_PORT` | 465 = SSL directo, 587 = STARTTLS |
| B · Gmail OAuth2 | `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Las cuatro juntas. **No** es contraseña de aplicación |
| C · Resend | `RESEND_API_KEY` | Solo la llave |

Además, **siempre**:

- `EMAIL_FROM` — el remitente que se ve. Si se deja vacío se arma con el usuario.
- `FRONTEND_URL` — **hoy está sin poner.** Sin ella, todos los enlaces de los
  correos (ver mi entrada, aceptar invitación, tomar mi cupo) apuntan al dominio
  por defecto de Vercel, no al tuyo. Nadie se da cuenta hasta que un asistente
  hace clic. También la usa CORS.

> Ojo con una trampa que ya estaba: el `.env.example` viejo pedía
> `GMAIL_APP_PASSWORD`, que **el código no lee en ningún sitio**. Quien seguía
> ese archivo se quedaba sin correo y sin saber por qué. Ya está corregido.

**Cómo comprobar que quedó bien**, sin adivinar:

1. `GET /eventos/:id/emails/diagnostico` → debe decir `configurado: true`.
2. En el panel: Event Experience → **Emails** → botón «Probar conexión».
3. Mismo sitio → «Enviarme una prueba». Llega al correo de la cuenta.
4. «Ver últimos envíos» muestra qué salió y qué falló, con el motivo.

---

## 2 · Migraciones

Todas las de esta ronda están **aplicadas y verificadas** sobre
`GestorEventosMarcaBlanca` (`yopontbwgdybfsniqawz`).

| # | Qué hace | Verificado con |
|---|---|---|
| 0052 | Plantillas de correo y registro de envíos | Tablas creadas. Backfill copió **0 filas**: nadie había logrado guardar una plantilla con el editor viejo |
| 0053 | RLS del chat: entra el staff, se aíslan los DM | Ver abajo |
| 0054 | Cuatro roles nuevos (Expositor, Speaker, Finanzas, Moderación) | Roles **187 → 251** = 16 eventos × 4 |
| 0055 | Grupos en el formulario + inscripción por sub-evento | Columnas, tabla, vista y trigger creados |
| 0056 | Endurecer lo que el linter marcó de 0053–0055 | Linter limpio de todo lo nuestro |
| 0057 | Bolsa de puntos y cuota por stand | Tope probado: 8 pasa, +5 frena, +2 llega justo a 10 |

**La RLS del chat, probada con rol `authenticated` y JWT simulado:**

- dueño del evento → ve sus 5 canales y sus mensajes
- miembro del equipo **sin boleta** → ve 4 canales. **Antes veía 0**, y eso era
  exactamente el «los mensajes no llegan sin recargar»
- tercero con acceso al chat del evento (ve sus 4 canales) → **0 canales y 0
  mensajes** del DM ajeno. El agujero está cerrado
- desconocido sin nada → 0

### Aviso para quien reconstruya la base desde cero

`db/migrations/0007_event_roles.sql` **miente**: siembra los roles con ids de
permiso en inglés (`edit_event`, `invite_staff`, `view`…) que el verificador no
reconoce. Si esa versión fuera la que corre, cada rol semilla concedería cero
permisos. En la base **no** es la que corre — alguien la corrigió directamente
sobre Supabase sin dejar migración. La 0054 deja la versión correcta escrita en
el repo, pero **el 0007 sigue con el fallo**: quien reconstruya desde las
migraciones tiene que aplicar la 0054 detrás, sin excepción.

---

## 3 · Variables que el código lee y el `.env.example` no documentaba

Auditado comparando `process.env.*` en todo el proyecto contra el
`.env.example`. Diecisiete sin documentar. No todas hacen falta —muchas tienen
valor por defecto— pero conviene saber que existen:

**Hacen falta si se usa la función:**

| Variable | Para qué | Sin ella |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google Calendar: crear el evento de una entrevista | La integración queda inerte |
| `GOOGLE_STATE_SECRET` | Firma el `state` del OAuth de Google | El flujo no se puede validar |
| `TRUORA_API_KEY` / `TRUORA_API_BASE` | Verificación facial (KYC) del perfil de talento | Queda inerte |
| `JWT_SECRET` | Firma de tokens propios | Revisar dónde se usa antes de tocarlo |
| `BACKEND_URL` | URL pública del backend, para los `back_urls` de las pasarelas | Cae a `http://localhost:3000`, y un pago en producción volvería a localhost |

**Tienen valor por defecto y solo se tocan para ajustar:**

`ANTHROPIC_MODEL`, `GEMINI_MODEL`, `GROQ_MODEL` (qué modelo usa Gestbot),
`PLAN_PRO_TRIAL_DAYS`, `ENABLE_SOCKETS`, `RATE_LIMIT_API_MAX`,
`RATE_LIMIT_API_WINDOW`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW`.

---

## 4 · Lo demás que hay que rellenar

| Variable | Para qué | Qué pasa sin ella |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Todo | El servidor no arranca |
| `QR_JWT_SECRET` | Firma los QR de las boletas | Mínimo 32 caracteres. Si cambia, **los QR ya emitidos dejan de validar** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` | Notificaciones push | El push queda deshabilitado; los recordatorios por correo siguen |
| `TURNSTILE_SECRET_KEY` | Captcha anti-bot en la compra pública | No se exige captcha: la reserva pública queda abierta a bots |
| `SENTRY_DSN` | Monitoreo de errores | Sentry deshabilitado. Un error en producción no deja rastro |
| `MP_WEBHOOK_SECRET` | Verifica la firma de los webhooks de Mercado Pago | **Sin ella los webhooks se aceptan sin verificar firma**: cualquiera podría marcar una boleta como pagada |
| `MAIL_SERVICE_URL`, `MAIL_SERVICE_KEY` | Delegar el correo a un microservicio | Sin ellas el backend envía él mismo, que es lo correcto por ahora |

---

## 5 · Lo que queda sin verificar contra un servidor de verdad

No es lista de tareas, es lista de incógnitas. Nada de esto se ha visto
funcionar de punta a punta:

- **Correos automáticos con SMTP real.** El motor está reescrito y el HTML sale
  con la marca del evento, pero solo se ha comprobado renderizando, no enviando.
  Falta ver cómo se ve en Gmail y en Outlook.
- **Invitaciones al equipo.** El camino está probado —se renderiza, lleva el rol
  y el enlace— pero no ha salido ninguna por falta de proveedor.
- **Inscripción a un sub-evento** con su correo de confirmación.
- **Comprar o reservar boleta → correo → QR → check-in → métricas.**
- **Vacante pública → candidato aplica.** El backend nunca se desplegó en Render.
- **iFrame incrustado en una web externa** (#32, sin construir).

### El recorrido para probarlo, en orden

Cada paso depende del anterior. Conviene hacerlo de una sentada con un evento de
prueba y apuntar dónde se rompe.

1. Rellenar el correo (sección 1) y comprobar el diagnóstico.
2. Cuenta nueva → confirmar correo → entrar.
3. Crear evento con el asistente, con portada y dirección.
4. Marca: colores y logo. Guardar, salir, volver a entrar.
5. Editar la landing, guardar, abrir la página pública en otra pestaña.
6. Formulario: agregar la ficha de caracterización y guardar. Comprobar que
   deja pasar 22 preguntas — el tope viejo era 20 y no habría cabido.
7. Crear tipos de boleta. Reservar una desde la página pública, sin sesión.
8. Comprobar que llega el correo y que trae QR.
9. Escanear ese QR en Check-in. Escanearlo otra vez para el check-out.
10. Marcar un sub-evento como «pide inscripción» con cupo. Inscribirse.
11. Crear un stand, ponerle cuota, entrar a su portal con el código de su
    boleta y dar puntos hasta pasarse: debe frenar.
12. Invitar a un colaborador. Aceptar desde su cuenta. Ver si tiene tareas y si
    le llegan los mensajes del chat sin recargar.

---

## 6 · Deuda anotada, sin tocar

- **Catorce tablas con RLS activada y ninguna política**: `catalogo_roles`,
  `cobros_vacantes`, `event_form_fields`, `event_requests`, `event_waitlist`,
  `evento_alertas`, `evento_motivos`, `perfil_talento`, `postulaciones`,
  `recordatorio_inapp_log`, `talento_resenas`, `ticket_interacciones`,
  `ticket_movimientos`, `vacantes`.
  No hay fuga —RLS sin políticas deniega todo, y el backend entra con la service
  key— pero ninguna se puede leer desde el navegador, y el día que alguna haga
  falta ahí va a fallar sin explicación aparente.
- **`pg_net` instalado en el esquema `public`.** Aviso del linter, preexistente.
- **Protección de contraseñas filtradas desactivada** en Supabase Auth. Se
  activa desde el panel, no desde el código.
- **Ocho copias de `generarCodigo()`** a mano: `routes/clientes.js`,
  `eventos.publicos.js`, `pagos.js`, `wompi.js`, `me.js`, `interacciones.js`,
  `lib/agente.js`, `lib/ticketLookup.js`. Lo nuevo usa `lib/codigoTicket.js`.
  Unificar las ocho toca los caminos de pago y merece su propio cambio.
- **`page_json` es un campo compartido por demasiadas cosas.** Marca, páginas y
  navbar escriben todos sobre el mismo JSON desde copias distintas del evento en
  memoria. Así fue como la marca se borraba sola. Las plantillas de correo
  salieron de ahí en la 0052; el resto sigue dentro y sigue siendo frágil.
