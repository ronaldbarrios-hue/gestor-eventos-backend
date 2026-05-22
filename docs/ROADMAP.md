# GESTEK Event OS — Roadmap (rama `MedinaDesarrollo`)

Documento maestro que fusiona el progreso real del repo con el plan del PDF
`GestekEventos_PlanFuncional v1.0`.

**Stack confirmado:**
- **Frontend:** Vite + React 18 + React Router 6 + Tailwind CSS
- **Backend:**  Node.js + Express (REST API en `localhost:3000`)
- **DB / Auth / Storage / Realtime:** Supabase
- **Comunicación front ↔ back:** JSON sobre HTTPS con JWT de Supabase Auth

---

## Estado actual (auditado el 2026-05-14)

### Fase 1 — Setup ✅
- [x] Rama `MedinaDesarrollo` desde `main`
- [x] Git local configurado como `Sekkon0906 <medinapipe123@gmail.com>` (sin co-autor Claude)
- [x] Emojis eliminados del código fuente
- [x] Logo real (GESTEK) en `frontend/src/assets/`
- [x] Roadmap publicado
- [x] Limpieza del backend viejo (bcryptjs, schemas SQL antiguos, Docker, rutas obsoletas)
- [ ] _(Opcional)_ `git filter-repo` sobre commits viejos en `main` + `push --force` — requiere ejecución manual

### Fase 2 — Rediseño visual ✅
- [x] Navbar píldora flotante con links + acciones
- [x] Tipografía y espaciados estilo Apple/Anthropic
- [x] Paleta sobria, sin neon
- [x] Landing rediseñada (`LandingHomePage`)
- [x] Página de login (`AuthPage` modo login)
- [x] Página de registro 2 pasos (`AuthPage` modo register)
- [x] Responsive en todas las vistas
- [x] Loaders unificados (`PageLoader`, `InlineLoader`)
- [x] Animaciones de transición entre rutas (`auth-in/out`)

### Fase 3 — Auth Supabase ✅
- [x] Cliente Supabase JS instalado y configurado
- [x] `AuthContext` contra Supabase Auth (login, register, logout, reset, update, resend)
- [x] Registro en 2 pasos (datos básicos → perfil del organizador)
- [x] Login funcional
- [x] Recuperación de contraseña (`/recuperar`)
- [x] Restablecer contraseña (`/restablecer`)
- [x] Confirmación de cuenta por email (`/confirmar`)
- [x] Sesión persistente + refresh tokens (PKCE)
- [x] Documentación en `docs/SUPABASE_SETUP.md`
- [x] Credenciales en `frontend/.env.local`

### Fase 4 — Rutas y páginas públicas ✅
- [x] `/` — Inicio
- [x] `/como-funciona`
- [x] `/producto`
- [x] `/explorar` (con datos mock por ahora — se conecta a Supabase en Fase A)
- [x] `/explorar/:slug` (placeholder — se conecta en Fase A)
- [x] `/planes`
- [x] `/faq`
- [x] `/login` y `/register` rediseñadas

---

## Lo que viene — derivado del PDF `Plan Funcional v1.0`

Fases reescritas según el documento, ordenadas para que cada PR sea testeable
de extremo a extremo. La URL pública del evento se mantiene en
`/explorar/[slug]` (no se usa el `/handle/slug` del PDF).

### Fase A — Núcleo de eventos contra schema nuevo
- [ ] Aplicar `db/migrations/0001_init.sql` en Supabase (SQL Editor del proyecto)
- [ ] Backend: middleware `verifySupabaseJWT` que valida el `access_token` de Supabase
- [ ] Backend: endpoints CRUD de eventos contra schema nuevo
  - `GET /eventos`, `GET /eventos/:id`, `POST /eventos`, `PATCH /eventos/:id`,
    `DELETE /eventos/:id` (soft delete), `POST /eventos/:id/publicar`
- [ ] Backend: `GET /eventos/publicos` (sin auth) y `GET /eventos/slug/:slug`
- [ ] Backend: `GET /categorias` y `GET /me/profile`
- [ ] Frontend: reescribir `api/eventos.js` contra los nuevos endpoints
- [ ] Frontend: conectar `EventsListPage`, `EventCreatePage`, `EventDetailPage`, `DashboardPage`
- [ ] Frontend: conectar `/explorar` y `/explorar/:slug` a datos reales

### Fase B — Editor visual drag & drop
- [ ] Instalar `@dnd-kit/core`, `@dnd-kit/sortable`, `@tiptap/react`
- [ ] Esqueleto del editor con 4 bloques iniciales: Hero, Texto, Galería, FAQ
- [ ] Persistir estructura en `eventos.page_json`
- [ ] Renderizado dinámico en `/explorar/:slug` desde `page_json`
- [ ] Bloques restantes: Agenda, Speakers, Patrocinadores, Mapa, Tickets, Redes, Video, Countdown
- [ ] Vista previa mobile/desktop dentro del editor
- [ ] SEO automático: meta tags, Open Graph, preview en WhatsApp

### Fase C — Tickets, pagos BRE-B y compra
- [ ] CRUD de `ticket_types` con Early Bird, cupos, códigos descuento
- [ ] Carrito y flujo de compra desde la página pública del evento
- [ ] Panel del organizador para configurar Nequi / Daviplata / PSE / QR BRE-B
- [ ] Webhook `POST /webhooks/bre-b` para confirmar pagos y emitir tickets
- [ ] Emails transaccionales con Resend (confirmación, recordatorios)
- [ ] PDF de boleta autogenerado con el QR adjunto
- [ ] Reembolsos manuales que invalidan el QR

### Fase D — QR y check-in en tiempo real
- [ ] Generación de QR JWT firmado al emitir cada ticket (`qrcode` en backend)
- [ ] Página `/scan` con `html5-qrcode` para staff
- [ ] Endpoint `POST /tickets/:id/checkin` con validación de zona
- [ ] Dashboard de ingreso en vivo con Supabase Realtime
- [ ] Modo offline PWA con IndexedDB
- [ ] Check-in manual por nombre/documento

### Fase E — Agente IA conversacional + chat interno
- [ ] Integración Groq (LLaMA 3) con Vercel AI SDK
- [ ] Tool-calling: el agente crea/edita eventos por instrucción natural
- [ ] Asistente para asistentes (preguntas sobre el evento)
- [ ] Chat interno staff con canales por evento (Supabase Realtime)
- [ ] Subchats por sector (acceso, logística, atención, VIP)
- [ ] Adjuntos en mensajes (Supabase Storage)

### Fase F — Gamificación y notificaciones
- [ ] Trigger `on_checkin_award_points` en Supabase
- [ ] Tablas `points_log`, `user_badges`, `missions`, `referral_codes` (ya en schema)
- [ ] UI de perfil con puntos, badges, ranking
- [ ] Misiones y retos configurables por organizador
- [ ] Códigos de referido con tracking
- [ ] Push notifications con Firebase FCM
- [ ] Recordatorios automáticos (cron `pg_cron` o cron en backend)

### Fase G — Pulido, analytics y lanzamiento
- [ ] Agenda con múltiples tracks + export iCal / PDF
- [ ] Dashboard analytics del organizador con Recharts
- [ ] Export CSV/Excel de asistentes y ventas
- [ ] Mapas Google Maps / Mapbox para ubicación del evento
- [ ] Onboarding guiado con el agente IA
- [ ] Tests E2E críticos con Playwright (compra + check-in)
- [ ] Optimización Lighthouse > 90
- [ ] Documentación API y guía de usuario en `/docs`

---

## Funcionalidades post-MVP (PDF sección 10)

Streaming en vivo · Encuestas en tiempo real · Reventa controlada de boletas ·
PWA instalable · Co-organización con permisos granulares · Marketplace de
eventos · API pública para integraciones · Certificados y memorias del evento.

---

## Riesgos y decisiones abiertas

- **BRE-B / PSE:** sin credenciales sandbox propias, se construye como
  integración donde el organizador pega su llave y QR estático.
- **Filter-repo en `main`:** pendiente decisión del usuario (requiere
  `push --force` a `origin/main`).
- **Auth0:** descartado. Solo Supabase Auth.
- **Next.js vs Vite:** confirmado Vite. SEO de páginas públicas se atenderá con
  prerender selectivo si es necesario, no migrando a Next.
- **shadcn/ui:** descartado. Se conserva el sistema de componentes Tailwind
  custom porque ya tiene identidad consistente (estilo Apple/Anthropic).
