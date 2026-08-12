# GESTEK · Por hacer

Todo lo que queda, en un solo sitio. Dos mitades muy distintas:

- **Lo externo** (secciones 1 y 2): cosas que no se pueden programar. Hay que
  conseguir una credencial, pagar una cuenta, aprobar un permiso o esperar a que
  alguien de fuera responda. Si esto no avanza, hay funciones que se quedan
  quietas por muchas horas de código que se les echen.
- **Lo de desarrollo** (secciones 3 y siguientes): se puede hacer sin depender de
  nadie.

Última revisión: 12 de agosto de 2026. Migraciones 0052 a 0059 aplicadas.

> **Migraciones 0060 a 0067 aplicadas y el backend desplegado.** Falta el
> frontend: Vercel no auto-despliega y hay que lanzarlo a mano. Las **0065–0067
> son un puente temporal** que hay que retirar después — ver la tabla al
> principio de `PENDIENTE.md`.

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

- [ ] **Desplegar el backend en Render.** ⚠️ **Esto decía "nunca se ha
      desplegado" y NO era cierto.** `https://gestor-eventos-backend-yx75.onrender.com`
      está vivo y responde 200: es el que sirve la aplicación hoy. Fiarse de
      esta línea en vez de comprobarlo costó dejar las páginas públicas de 31
      eventos vacías durante unos minutos al aplicar la 0064 (ver la 0065).
      Lo que sí sigue pendiente es **desplegar el código de esta ronda**, que
      está en la rama y no en lo que corre. Y lo de la vacante pública habrá
      que volver a diagnosticarlo: el 401 no se explica por un backend
      inexistente.
- [ ] **Activar la protección de contraseñas filtradas** en Supabase Auth. Se
      hace desde el panel, no desde el código: Authentication → Policies.
- [ ] **Probar el correo en Gmail y en Outlook.** El HTML sale con la marca del
      evento y se ha comprobado renderizando, pero nunca se ha visto en un cliente
      de correo real. Outlook rompe cosas que ningún navegador rompe.
- [x] ~~Decidir si el plan Pro sigue existiendo.~~ **Decidido: no existe.** Todo
      GESTEK es de uso gratuito. Se quitaron las cuatro puertas, las rutas de
      compra y trial, la rama del webhook que activaba Pro, y todo lo que lo
      anunciaba en la landing, la FAQ y Ajustes. Lo único con tope es el asistente
      de IA, por correr sobre capa gratuita, y lleva su aviso.
      Las columnas `plan` y `plan_expires_at` siguen en `profiles` sin que nadie
      las lea: quitarlas es una migración destructiva y no hacía falta.
- [ ] **Comprobar `QR_JWT_SECRET` antes de cualquier despliegue nuevo.** Si cambia,
      **todos los QR ya emitidos dejan de validar.** Tiene que ser el mismo
      secreto en todos los entornos que compartan base de datos.

---

## 3 · Desarrollo · lo que ya está decidido y falta hacer

### 3.1 · Sub-eventos — HECHO, salvo un trozo

Ya está: el interruptor de «pide inscripción» con su cupo en `AgendaTab`, la
pestaña **Participación** junto al control de ingreso, marcar asistencia con el
código de la boleta, y exportar los inscritos a CSV con las respuestas de la
ficha (las columnas se descubren de lo guardado).

- [x] ~~Falta el **formulario de inscripción en la agenda pública**.~~ **Hecho**
      (`InscripcionSesionModal.jsx`). Dos caminos y el orden importa: con el
      código de la boleta primero —la boleta ya dice quién eres, no se te
      piden los datos otra vez— y sin boleta después, porque en el taller
      siempre aparece alguien que no pasó por la entrada y si no se le puede
      registrar el conteo miente.
- [x] ~~Ver 3.6 para el editor de las preguntas propias de un sub-evento.~~ **Hecho.**

> **Aviso: este apartado decía "HECHO, salvo un trozo" y no era verdad.** El
> backend sí estaba; el PANEL no existía en el frontend. Ni el interruptor de
> «pide inscripción», ni el cupo, ni el selector de modo, ni la pestaña de
> Participación: `grep -r requiere_inscripcion src/` no daba una sola línea en
> `main`. Y `formulario_modo` ni siquiera estaba en la lista de campos
> editables del `PATCH /eventos/:id/sessions/:id`, así que el modo se podía
> leer y no escribir — un selector habría fallado en silencio.
>
> Ahora sí está: interruptor, cupo, los tres modos y el editor de preguntas,
> más el badge en la lista que dice cuáles piden inscripción y cuántos
> inscritos llevan.

### 3.2 · `AuthPage` — HECHO

El registro ya estaba partido en dos caminos desde antes: el paso 0 pregunta entre
«solo quiero asistir» y «voy a organizar», y `esFlujoLigero` adapta el resto.

El ascenso de cuenta ya está: tarjeta en Ajustes → Espacio de Trabajo, visible
solo a quien está en modo asistente, con la vuelta atrás aparte. `cambiarModo`
llevaba en el contexto de auth desde el principio sin que nadie la llamara.

- [ ] Queda el **#36** del documento de equipo: «cambiar propósito» se pierde en el
      registro y la casilla del teléfono va apretada.

### 3.3 · Lista de espera de verdad — HECHO

Migración 0061 (`oferta_token`, `oferta_expira`, `oferta_enviada_at`,
`ofertas_recibidas`, estado `expired`) y `lib/waitlistOferta.js`.

- [x] ~~El disparador.~~ Cuelga de los cuatro sitios donde se libera un cupo:
      reembolso por pasarela, **anular una boleta desde el panel**, subir el
      cupo de un tipo y subir el aforo del evento.
- [x] ~~Correo con enlace que caduca y pasar al siguiente.~~ 24 h por defecto
      (`WAITLIST_HORAS_OFERTA`). El barrido cuelga del cron de recordatorios,
      que ya corría cada quince minutos.
- [x] ~~Llamar a `cupo_liberado`.~~ Llamada.

**El cupo se GUARDA de verdad mientras la oferta vive.** Las ofertas vigentes
descuentan de la disponibilidad para todo el mundo menos para su dueño, en los
tres caminos de compra (reserva, Mercado Pago y Wompi). Sin eso el correo sería
una carrera y ser el primero de la fila no significaría nada.

> **Y de paso, un agujero que nadie había visto:** anular una boleta desde el
> panel (`PATCH /eventos/:id/clientes/:ticketId`) **no bajaba ningún
> contador**. `vendidos` y `aforo_vendido` se quedaban igual, así que el evento
> seguía "agotado" con sitios vacíos y la lista de espera no se enteraba nunca.
> El reembolso por pasarela sí lo hacía; este camino no. Ahora los dos hacen lo
> mismo, en los dos sentidos.

- [ ] **Sin probar de punta a punta, y no se puede:** todo el ciclo depende de
      que salga un correo, y hoy `sendMail` devuelve `no_provider`. Es lo
      primero que habría que mirar en cuanto haya SMTP.

### 3.4 · Bloque del documento de equipo (#32–#49) — HECHO

Todo cerrado salvo #50 (emails, bloqueado por SMTP) y #51 (probar los QR, que
es un recorrido y no código). El detalle de cada uno, con las causas
encontradas, está en `PENDIENTE.md`. Migraciones nuevas: 0060, 0062 y 0063.

### 3.5 · Fusión de Dinámicas en Espacio del evento — HECHO la decisión

El documento pedía **decidir la navegación antes de mover código**. Decidida y
aplicada; el código no se movió, y es a propósito.

**La decisión:** desaparece la sección "Dinámicas" y nace **"Espacio del
evento"** con cinco vistas de lo mismo — Calendario, Torneos, Rueda de
negocios, Mapa y Ranking. La agenda sale de "Organización", donde estaba junto
a Vacantes y Documentos, que son papeleo. El calendario es *cuándo*, las
llaves son *cómo va*, el mapa es *dónde*. Las direcciones viejas
(`dinamicas/torneo`, `organizacion/agenda`…) se redirigen, que si no un enlace
guardado cae en el Resumen sin explicación.

**Por qué un torneo YA era un sub-evento:** `agenda_sessions` tiene un `tipo`
competitivo y un `torneo_id` que apunta a las llaves. Lo que faltaba no era el
modelo sino **el camino de vuelta**: creabas el torneo, no aparecía en el
calendario, y para que el público lo viera había que acordarse de crear a mano
un sub-evento en otra pantalla. Quien no se acordaba tenía un torneo invisible.
Ahora el torneo dice si tiene hueco en el calendario y lo crea desde ahí.

- [ ] **Partir los dos archivos grandes sigue pendiente** (`TorneoTab` 56 KB,
      `AgendaTab` 49 KB) y se deja a conciencia: mover 105 KB de sitio no
      arregla nada que un usuario note, y hacerlo en la misma tanda que un
      cambio de navegación habría mezclado dos cosas que conviene poder
      revisar por separado. La decisión de navegación —que era el bloqueo— ya
      está tomada, así que el día que se parta, se parte contra algo firme.

---

## 3.6 · Editor de preguntas por sub-evento — HECHO

Un sub-evento puede pedir inscripción con tres modos: `ninguno` (el normal, un
botón y listo), `propio` (preguntas cortas de esa actividad) y `evento` (el
formulario completo). El backend soportaba los tres: `event_form_fields.session_id`
existe, la validación funciona y el render público también.

- [x] ~~Falta la pantalla para ESCRIBIR esas preguntas propias.~~ **Hecha**
      (`PreguntasSubEvento.jsx`), con `GET`/`PUT
      /eventos/:id/sesiones/:sesionId/formulario`. Deliberadamente corta: sin
      grupos, sin ayuda por campo, sin "sólo para el tipo VIP", y tope de doce.
      Todo eso es del formulario de compra, que ya tiene su editor grande;
      quien necesite treinta preguntas quiere el modo `evento`.
      Si el editor se queda sin ninguna, el sub-evento vuelve solo a `ninguno`:
      un formulario vacío en la agenda pública es peor que un botón.
- [x] ~~Ojo al implementarlo:~~ **atendido, y era el riesgo real.** El nuevo
      endpoint es el espejo del del evento **con el cuidado invertido**: aquel
      filtra por `session_id is null` para no llevarse las de los sub-eventos;
      éste filtra por `session_id = :id` para no llevarse ni el formulario del
      evento ni las de OTRO sub-evento. Los dos diffs borran lo que no viene en
      el payload, así que el filtro es lo único que separa "guardar lo mío" de
      "borrar lo de los demás". El armado de cada fila y las validaciones se
      unificaron en `lib/formularioCampos.js` para que no acaben siendo dos
      copias que se separan — la misma trampa de los catálogos de tipos.

      Contexto original: el `PUT /eventos/:id/formulario` hace un diff que
      BORRA lo que no venga en el payload. Ya está filtrado por
      `session_id is null` para que no se lleve las de sub-evento, pero el editor
      nuevo necesita su propio endpoint con el mismo cuidado en sentido inverso.

---

## 3.7 · Mi Espacio y Vacantes: el análisis que pediste

**La unificación de pantallas ya ocurrió, y no es ahí donde está la
duplicación.** Comprobado en las rutas:

- `/vacantes` → redirige a `/app/explorar?ver=vacantes`
- `/mis-postulaciones` → redirige a `/mi-espacio?tab=postulaciones`
- `/mi-trabajo` → redirige a `/mi-espacio`

Y `MiEspacioPage` ya absorbe las pantallas de vacantes como pestañas: Mi panel,
Colaborador, Perfil de talento, Mis postulaciones, Perfil de organizador y Mis
stands (esta última solo si tienes alguno). Los archivos siguen viviendo en
`pages/vacantes/` pero se renderizan desde Mi Espacio. Eso está bien resuelto.

### Dónde está la duplicación de verdad

**En los datos de la persona, no en las pantallas.** Los mismos campos se editan
en dos sitios que no se hablan:

| Dato | Se edita en | Y también en |
|---|---|---|
| Foto | Ajustes → Mi Perfil (`AvatarUploader`) | Mi Espacio → Perfil de talento (`Foto`) |
| Teléfono | Registro / Completar perfil (metadata) | Mi Espacio → Perfil de talento |
| Ciudad | Registro / Completar perfil (metadata) | Mi Espacio → Perfil de talento |

Son dos almacenes distintos: los metadatos del usuario en Supabase Auth por un
lado, y la tabla `perfil_talento` por otro. Cambiar la foto en Ajustes no cambia
la del perfil de talento, y al contrario. El resultado es que la misma persona
puede aparecer con dos fotos y dos teléfonos según por dónde se la mire, y nadie
sabe cuál es el bueno.

### El flujo que propongo

La idea es **una identidad, varias facetas**. Hoy se comporta como tres
identidades sueltas.

1. **Un solo dato base, editable en un solo sitio.** Nombre, foto, teléfono,
   ciudad y correo son de la PERSONA, no de una faceta. Deben vivir en un solo
   lugar —los metadatos del perfil— y editarse solo en Ajustes → Mi Perfil.

2. **Las facetas dejan de repetirlos y los muestran heredados**, con un enlace
   del tipo «esto viene de tu perfil · cambiar». Así se ve el dato donde hace
   falta sin abrir un segundo sitio donde escribirlo.

3. **Cada faceta se queda solo con lo que es suyo:**
   - *Talento:* titular, sobre ti, habilidades, hoja de vida, portafolio.
   - *Organizador:* empresa, logo, marca, tagline, redes.
   - *Expositor:* stand, categoría, galería (esto ya está aparte y bien).

4. **La faceta aparece cuando se usa, no antes.** «Mis stands» ya lo hace: solo
   sale si tienes alguno. Lo mismo debería valer para «Perfil de talento»
   —mostrarlo cuando te postulas por primera vez o desde la vacante— y para
   «Colaborador» —cuando te invitan a un equipo. Seis pestañas de entrada, la
   mayoría vacías, es lo que hace sentir que la aplicación está duplicada aunque
   no lo esté.

5. **Explorar se queda como está.** Eventos y vacantes en la misma pantalla con
   un conmutador es correcto: son las dos cosas que se buscan desde fuera, y
   separarlas obligaría a adivinar en qué sección buscar.

### Por dónde empezar

- [ ] Migración: decidir si `perfil_talento` deja de tener `foto`, `telefono` y
      `ciudad`, o si se sincronizan. Yo quitaría las columnas y leería del
      perfil: dos fuentes para el mismo dato siempre acaban discrepando.
- [ ] `PerfilTalentoEditor`: quitar esos tres campos y mostrarlos heredados.
- [ ] `MiEspacioPage`: que las pestañas aparezcan por uso, como ya hace «Mis
      stands».
- [ ] Revisar que nada dependa de `perfil_talento.foto` antes de tocarla —el
      snapshot que se congela al postularse la copia, y ahí sí tiene que
      quedarse como estaba.

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
      *(Las dos tablas nuevas de esta ronda —`torneo_categorias` y
      `sugerencias_catalogo`— nacen con sus políticas escritas, para no
      alargar la lista.)*
- [x] ~~**`0007_event_roles.sql` miente.**~~ **Arreglado en el origen.** Siembra
      los seis roles con los ids en español, los mismos valores que dejan la
      0054 y la 0056, así que aplicarlas encima no cambia ninguna fila.
      Reconstruir desde las migraciones da por fin el mismo resultado que la
      base de hoy, con o sin la 0054 detrás. El backfill pasó a `on conflict`
      para añadir lo que falte sin pisar lo que el organizador haya editado, y
      la cabecera de la 0054 dejó de advertir de algo ya corregido.
- [ ] **Ocho copias de `generarCodigo()`** a mano: `routes/clientes.js`,
      `eventos.publicos.js`, `pagos.js`, `wompi.js`, `me.js`, `interacciones.js`,
      `lib/agente.js`, `lib/ticketLookup.js`. Lo nuevo usa `lib/codigoTicket.js`.
      Unificar las ocho toca los caminos de pago y merece su propio cambio.
- [x] ~~**`page_json` es un campo compartido por demasiadas cosas.**~~
      **Arreglado (0064 + `lib/eventoSitio.js`).** Marca, páginas y navbar
      salen a columnas propias: ya no comparten campo. Y el `PATCH` deja de
      REEMPLAZAR `page_json` para **mezclar por claves de primer nivel**, que
      es lo que protege a las trece pantallas que siguen guardando con
      `{...evento.page_json, loMío}` — una pantalla que manda sólo lo suyo ya
      no puede borrar lo de otra aunque su copia sea de hace media hora.

      Dos decisiones que conviene no deshacer, explicadas largo en la
      migración y en `PENDIENTE.md`: las tres claves **se quitan** del JSON al
      migrar (dos copias obligan a elegir cuál gana, y la regla obvia resucita
      la marca borrada), y un `page_json` entrante con `branding` dentro **se
      descarta en vez de ascenderse** a la columna (ascender reconstruiría el
      fallo original con trece culpables en vez de dos).

      Sigue dentro de `page_json` todo lo demás —seo, checkout, mapa, zonas,
      accesos, documentos, cartera, credenciales, automatizaciones—, pero cada
      una tiene un solo editor y ahora la mezcla las protege. Sacarlas es
      posible y ya no urge.
- [ ] **`pg_net` instalado en el esquema `public`.** Aviso del linter de Supabase.
- [ ] **Seis permisos del catálogo que no verifica nadie**: `gestionar_descuentos`,
      `vip_zone`, `crear_canales`, `borrar_mensajes`, `ver_pagos` y
      `reembolsar`. Concederlos no cambia nada todavía.
      *Esto decía que estaban marcados con `aplicado: false` en
      `src/lib/permisos.js` y **no era cierto**: el campo no existía. Ahora sí,
      y el selector de permisos del equipo pinta un «sin efecto aún» al lado,
      que era el punto — que se sepa al concederlo y no un mes después.*
      *Y faltaban tres en el catálogo que el backend SÍ comprueba
      (`gestionar_agenda`, `gestionar_torneo`, `gestionar_expositores`): la
      semilla los repartía pero no se podían conceder a mano. Añadidos.*
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
| Inscripción a sub-evento → correo → asistencia | pantalla construida, sin probar |
| **Cupo liberado → correo → el siguiente compra** | construido; **no se puede probar sin SMTP** |
| Stand → cuota → dar puntos hasta el tope | el tope sí, probado en base |
| Chat con dos cuentas, una de ellas staff | RLS verificada, sin probar en vivo |
| Vacante pública → candidato aplica | el backend nunca se desplegó |
| iFrame incrustado en web externa | construido (#32), sin pegarlo en una web real |
| Colaborador invitado → acepta → ve tareas | la vista ya no está vacía (#45); hace falta una segunda cuenta |

### El recorrido, en orden

Cada paso depende del anterior. Conviene hacerlo de una sentada con un evento de
prueba real y apuntar dónde se rompe. Está en `DESPLIEGUE.md`, sección 5.
