# GESTEK · Por hacer

Todo lo que queda, en un solo sitio. Dos mitades muy distintas:

- **Lo externo** (secciones 1 y 2): cosas que no se pueden programar. Hay que
  conseguir una credencial, pagar una cuenta, aprobar un permiso o esperar a que
  alguien de fuera responda. Si esto no avanza, hay funciones que se quedan
  quietas por muchas horas de código que se les echen.
- **Lo de desarrollo** (secciones 3 y siguientes): se puede hacer sin depender de
  nadie.

Última revisión: 12 de agosto de 2026.

> Para el estado de las migraciones y cómo comprobar cada cosa, ver
> `DESPLIEGUE.md`. Para el detalle de lo pedido por el equipo, `PENDIENTE.md` en
> el frontend.

---

## 1 · Credenciales que hay que conseguir

Ordenadas por lo que desbloquean. La primera bloquea media plataforma.

### 1.1 · Correo — BLOQUEA TODO LO DEMÁS

Nada de correo sale hoy. `sendMail` devuelve `no_provider` y el envío **se
descarta en silencio**: la boleta se emite, el miembro se crea, la inscripción
queda, y nadie se entera de que el correo no salió.

Hay que conseguir **una** de las tres. La primera es la que usa producción:

- [ ] **cPanel SMTP del dominio propio** — pedir al proveedor de hosting: usuario,
      contraseña, host y puerto (465 SSL o 587 STARTTLS).
      Variables: `CPANEL_SMTP_USER`, `CPANEL_SMTP_PASS`, `CPANEL_SMTP_HOST`,
      `CPANEL_SMTP_PORT`.
- [ ] *Alternativa:* Gmail con OAuth2 — hay que crear el proyecto en Google
      Cloud y sacar el refresh token en el OAuth Playground con el scope
      `https://mail.google.com/`. **No es una contraseña de aplicación.**
      Variables: `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
      `GMAIL_REFRESH_TOKEN`.
- [ ] *Alternativa:* Resend — crear cuenta en resend.com y verificar el dominio.
      Variable: `RESEND_API_KEY`.

Y en los tres casos:

- [ ] `EMAIL_FROM` — el remitente que se ve.
- [ ] `FRONTEND_URL` — **hoy está sin poner.** Sin ella, todos los enlaces de los
      correos apuntan al dominio por defecto de Vercel en vez del propio. No se
      nota hasta que un asistente hace clic. También la usa CORS.

**Qué se queda quieto sin esto:** boletas con QR, recordatorios de 7 días / 1 día
/ 1 hora, invitaciones al equipo, avisos de tarea, confirmación de cita de la
rueda de negocios, inscripción a sub-eventos, campañas del panel, y el aviso de
cupo liberado de la lista de espera cuando se construya.

### 1.2 · Seguridad — dos huecos abiertos

- [ ] `MP_WEBHOOK_SECRET` — se saca del panel de Mercado Pago.
      **Sin ella los webhooks se aceptan sin verificar firma:** cualquiera que
      conozca la URL podría marcar una boleta como pagada. Es lo más urgente
      después del correo.
- [ ] `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile, gratis.
      Sin ella no se exige captcha y la reserva pública queda abierta a bots.

### 1.3 · Para poder ver qué se rompe

- [ ] `SENTRY_DSN` — capa gratis suficiente. Sin ella, un error en producción no
      deja rastro y hay que reproducirlo a ciegas.

### 1.4 · Notificaciones push

- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`.
      Se generan solas, no hay que pedirlas a nadie:
      `node -e "console.log(require('web-push').generateVAPIDKeys())"`.
      Sin ellas el push queda deshabilitado (los recordatorios por correo siguen).

### 1.5 · Integraciones opcionales

Cada una queda inerte sin su llave: no falla, simplemente no aparece.

- [ ] **Google Calendar** (crear el evento de una entrevista e invitar al
      candidato) — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
      `GOOGLE_REDIRECT_URI`, `GOOGLE_STATE_SECRET`. Hay que crear el proyecto en
      Google Cloud y configurar la pantalla de consentimiento.
- [ ] **Truora** (verificación facial del perfil de talento) — `TRUORA_API_KEY`.
      Es un servicio de pago: hay que abrir cuenta.
- [ ] **Gestbot** — una de `GROQ_API_KEY` (capa gratis), `GEMINI_API_KEY` (capa
      gratis) o `ANTHROPIC_API_KEY` (de pago). Sin ninguna, el asistente no
      aparece.
- [ ] `BACKEND_URL` — la URL pública de este backend. **Si falta cae a
      `http://localhost:3000`**, y las pasarelas de pago devolverían al usuario a
      localhost después de pagar.
- [ ] `JWT_SECRET` — revisar dónde se usa antes de tocarlo.

---

## 2 · Lo externo que no es una credencial

- [ ] **Desplegar el backend en Render.** Nunca se ha desplegado. Por eso el
      flujo de "vacante pública → candidato aplica" no se ha podido probar. Hasta
      que exista una URL pública del backend, todo lo que dependa de webhooks
      (pagos, Mercado Pago, Wompi) tampoco se puede verificar de verdad.
- [ ] **Activar la protección de contraseñas filtradas** en Supabase Auth. Se
      hace desde el panel, no desde el código: Authentication → Policies.
- [ ] **Probar el correo en Gmail y en Outlook.** El HTML sale con la marca del
      evento y se ha comprobado renderizando, pero nunca se ha visto en un cliente
      de correo real. Outlook rompe cosas que ningún navegador rompe.
- [ ] **Decidir si el plan Pro sigue existiendo.** Se quitaron las cuatro puertas
      y la pasarela del plan sigue construida pero sin conectar. Si la respuesta
      es que no existe, hay código de plan que sobra; si es que sí, hay que
      decidir qué queda detrás.
- [ ] **Comprobar `QR_JWT_SECRET` antes de cualquier despliegue nuevo.** Si cambia,
      **todos los QR ya emitidos dejan de validar.** Tiene que ser el mismo
      secreto en todos los entornos que compartan base de datos.

---

## 3 · Desarrollo · lo que ya está decidido y falta hacer

### 3.1 · Sub-eventos, la parte visible

El backend, las rutas y la migración 0055 están. Falta la pantalla.

- [ ] Interruptor de **«este sub-evento pide inscripción»** con su cupo, en
      `AgendaTab`. Hoy solo se puede activar escribiendo en la base.
- [ ] **Pantalla de participación**: cuánta gente fue al evento y cuánta a cada
      actividad. Los datos salen de `v_participacion_sesiones`; el endpoint es
      `GET /eventos/:id/sesiones/participacion`.
- [ ] **Marcar asistencia escaneando el QR** que la persona ya tiene, reusando el
      escáner de Check-in. El endpoint acepta el código de la boleta.
- [ ] Formulario de inscripción en la **agenda pública**, para que alguien se
      apunte desde fuera del panel.
- [ ] Exportar los inscritos a CSV con sus respuestas de la ficha. Es lo que se
      va a pedir para reportar, y ahora mismo hay que sacarlo de la base a mano.

### 3.2 · `AuthPage` en dos caminos

- [ ] Partir el registro en **«solo quiero asistir»** y **«voy a organizar
      eventos»**, con formularios distintos y no el mismo con campos ocultos.
- [ ] **Ascenso de cuenta**: quien entró como invitado puede pasar a organizador
      sin volver a registrarse. `modoActivo` ya existe en el perfil
      (`organizador` / `asistente`), así que la mitad del camino está.
- [ ] Roza el **#36** del documento de equipo: "cambiar propósito" se pierde en el
      registro y la casilla del teléfono va apretada.

### 3.3 · Lista de espera de verdad

- [ ] Hoy `routes/waitlist.js` guarda gente y estados pero **no dispara nada**
      cuando se libera un cupo. Falta el disparador.
- [ ] Avisar por correo al primero de la fila con un **enlace de compra que
      caduca**, y pasar al siguiente si no lo usa. Necesita migración: token y
      caducidad en `event_waitlist`.
- [ ] La plantilla de correo `cupo_liberado` **ya existe** desde que se unificó el
      motor. Solo falta llamarla.

### 3.4 · Bloque del documento de equipo (#32–#49)

- [ ] **#32 · iFrame con tres modos de publicación**: enlazar la web propia del
      organizador, incrustar, o llevar a la landing de GESTEK. Necesita migración
      (`eventos.modo_publico`, `eventos.url_externa`) y ampliar el catálogo de
      secciones incrustables con mapa, torneos, ranking y expositores.
- [ ] **#33–#36 · Landing**: producto por secciones, legales dentro del botón de
      configuración, y la vuelta atrás desde términos en el login.
- [ ] **#37–#41 · Gestbot y la lámpara**: agrandar el widget de Inicio, quitar la
      caja de "¿Necesitas ayuda?", avisos según el estado real del evento.
- [ ] **#42–#47 · Panel interno**: navbar que se pierde en oscuro, sidebar
      demasiado negro en claro, menú de tres puntos recortado en los widgets
      bajos, Ajustes vacío para el administrador, vista Colaborador sin contenido
      (#45) y Vacantes desaprovechando el ancho.
- [ ] **#48 · Torneos por categorías anidadas**, con tantos niveles como haga falta.
- [ ] **#49 · Buzón de sugerencias** para tipos de evento y de vacante.

### 3.5 · Fusión de Dinámicas en Espacio del evento

- [ ] Que un torneo sea **un tipo de sub-evento más**. Es el refactor más grande
      de la lista: `TorneoTab` son 56 KB y `AgendaTab` 49 KB, y hay que decidir
      qué pasa con la navegación **antes** de mover código.

---

## 4 · Deuda técnica anotada

Nada de esto está roto ahora mismo, pero cada uno es una trampa esperando.

- [ ] **Catorce tablas con RLS activada y ninguna política**: `catalogo_roles`,
      `cobros_vacantes`, `event_form_fields`, `event_requests`, `event_waitlist`,
      `evento_alertas`, `evento_motivos`, `perfil_talento`, `postulaciones`,
      `recordatorio_inapp_log`, `talento_resenas`, `ticket_interacciones`,
      `ticket_movimientos`, `vacantes`.
      No hay fuga —RLS sin políticas deniega todo, y el backend entra con la
      service key— pero ninguna se puede leer desde el navegador, y el día que
      alguna haga falta ahí va a fallar sin explicación aparente.
- [ ] **`0007_event_roles.sql` miente.** Siembra los roles con ids de permiso en
      inglés que el verificador no reconoce. En la base corre la versión
      corregida (alguien la arregló sin dejar migración), pero quien reconstruya
      desde las migraciones se lleva el fallo entero si no aplica la 0054 detrás.
      Lo limpio sería arreglar el 0007.
- [ ] **Ocho copias de `generarCodigo()`** a mano: `routes/clientes.js`,
      `eventos.publicos.js`, `pagos.js`, `wompi.js`, `me.js`, `interacciones.js`,
      `lib/agente.js`, `lib/ticketLookup.js`. Lo nuevo usa `lib/codigoTicket.js`.
      Unificar las ocho toca los caminos de pago y merece su propio cambio.
- [ ] **`page_json` es un campo compartido por demasiadas cosas.** Marca, páginas
      y navbar escriben todos sobre el mismo JSON desde copias distintas del
      evento en memoria. Así fue como la marca se borraba sola. Las plantillas de
      correo salieron de ahí en la 0052; el resto sigue dentro y sigue frágil.
- [ ] **`pg_net` instalado en el esquema `public`.** Aviso del linter de Supabase.
- [ ] **Seis permisos del catálogo que no verifica nadie**: `gestionar_descuentos`,
      `vip_zone`, `ver_pagos`, `reembolsar` y dos más. Están marcados con
      `aplicado: false` en `src/lib/permisos.js` para que se sepa, pero
      concederlos no cambia nada todavía.
- [ ] **80 avisos de ESLint** (variables sin usar, dependencias de hooks). Cero
      errores. Son para ir mirando sin bloquear a nadie.

---

## 5 · Flujos que nadie ha visto funcionar enteros

No es lista de tareas, es lista de incógnitas. «Sin probar» significa
exactamente eso: puede funcionar, pero nadie lo ha ejecutado de principio a fin.

| Flujo | Estado |
|---|---|
| Registro → confirmación por correo → panel | sin probar |
| Editar landing → guardar → se ve en público | sin probar |
| Marca → guardar → se ve en público | arreglado, sin comprobar |
| Comprar o reservar boleta → correo → QR | sin probar |
| Escanear QR → check-in → métricas | sin probar |
| Correos automáticos | reescritos, sin SMTP real |
| Ficha de caracterización → 22 preguntas → exportar | sin probar |
| Inscripción a sub-evento → correo → asistencia | backend listo, sin pantalla |
| Stand → cuota → dar puntos hasta el tope | el tope sí, probado en base |
| Chat con dos cuentas, una de ellas staff | RLS verificada, sin probar en vivo |
| Vacante pública → candidato aplica | el backend nunca se desplegó |
| iFrame incrustado en web externa | sin construir (#32) |
| Colaborador invitado → acepta → ve tareas | la vista está vacía (#45) |

### El recorrido, en orden

Cada paso depende del anterior. Conviene hacerlo de una sentada con un evento de
prueba real y apuntar dónde se rompe. Está en `DESPLIEGUE.md`, sección 5.
