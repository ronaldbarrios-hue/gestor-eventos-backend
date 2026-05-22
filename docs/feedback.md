# GESTEK EVENTOS — Bitácora Técnica

> Memoria técnica persistente del proyecto. Actualizada tras cada sesión significativa.
> Propósito: contexto rápido sin releer código. Reduce tokens por interacción.

---

## Estado actual

**Fecha:** 2026-05-12
**Versión backend:** 2.3.0 (service layer + scalability)
**Versión frontend:** 2.0.0 (build limpio)
**Tests:** 75/75 passing ✅ (+2 tests nuevos de notification)
**Build frontend:** 0 errores, 0 warnings ✅
**Entorno:** Desarrollo local

**Estado general:** Sistema estable y escalable. Arquitectura limpia con separación correcta de capas para auth y eventos. Notificaciones persistentes con graceful degradation. Socket.IO scoped por usuario. Listo para demo y pruebas de integración.

---

## Arquitectura de capas

```
HTTP Request
    ↓
routes/          ← Parsea req, delega, responde. Sin lógica de negocio.
    ↓
validators/      ← Valida shape/formato. Sin efectos secundarios. Sin BD.
    ↓
services/        ← Lógica de negocio + transformaciones + acceso a BD.
    ↓
db/supabase.js   ← Cliente único de Supabase.
```

**Regla de oro:** Si una función accede a BD, va en `services/`. Si no tiene efectos secundarios, va en `validators/`. Si parsea `req.body` o escribe `res.json()`, va en `routes/`.

---

## Estructura de archivos

```
GestorEventosMarcaBlanca/
├── index.js                          ← Entry: env → security → rutas → Socket.IO
├── instrument.js                     ← Sentry (primer require)
│
├── config/
│   ├── env.js                        ← Fuente única de vars. Exit(1) en prod si faltan
│   └── security.js                   ← Helmet + CORS enterprise + rate limiters + sanitize
│
├── middleware/
│   ├── auth.js                       ← JWT verify (usa config/env — sin fallback)
│   └── roles.js                      ← RBAC + permisos granulares
│
├── validators/                       ← Validaciones puras, sin efectos secundarios
│   ├── auth.validator.js             ← validateRegister / validateLogin / validateUpdateMe
│   └── evento.validator.js           ← validateCrear / validatePublicar / validateActualizar
│
├── services/                         ← Lógica de negocio desacoplada de HTTP
│   ├── auth.service.js               ← register / login / getProfile / updateProfile
│   ├── evento.service.js             ← crear / getCategorias / calcularProgreso
│   └── notification.service.js       ← Supabase + fallback memoria + Socket.IO scoped
│
├── routes/                           ← Routers delgados: validator → service → respuesta
│   ├── auth.js                       ← Refactorizado — usa auth.service + auth.validator
│   ├── eventos.js                    ← Router principal de eventos
│   ├── eventos_post.js               ← Refactorizado — usa evento.service + evento.validator
│   ├── eventos_get_lista.js          ← Sin refactorizar (próxima fase)
│   ├── eventos_get_detalle.js        ← Sin refactorizar
│   ├── eventos_patch_delete.js       ← Sin refactorizar
│   ├── usuarios.js                   ← Sin refactorizar
│   ├── notification.routes.js        ← Actualizado — async API + filtro por userId
│   └── analytics.js
│
├── docs/
│   ├── feedback.md                   ← Esta bitácora
│   └── migrations/
│       └── 001_notifications_table.sql ← SQL reproducible para tabla notifications
│
├── tests/
│   ├── setup.js                      ← Env vars globales para Jest
│   ├── auth.routes.test.js           ← 17 tests — comportamiento seguro
│   ├── responsividad.test.js         ← 13 tests — estructura para mobile
│   ├── notification.service.test.js  ← 18 tests — async API + scoped Socket.IO
│   └── roles.middleware.test.js      ← 27 tests — RBAC
│
└── frontend/src/
    ├── api/                          ← CAPA ÚNICA Axios (client, auth, eventos, usuarios, analytics)
    ├── context/                      ← AuthContext + ToastContext
    ├── components/layout/            ← PublicLayout, AppLayout, PublicNavbar, PublicFooter, Sidebar, TopBar
    └── pages/                        ← Todas implementadas (public/* + auth + dashboard + events + users + settings)
```

---

## Historial de cambios

### Sesión 2026-05-12 — FASE 5: Escalabilidad y Desacoplamiento

#### FASE 5.1 — Event Service (completada)

**`validators/evento.validator.js` — expandido:**
- Añadidas validaciones faltantes del `eventos_post.js` original:
  - Fechas en el pasado
  - Eventos físicos requieren `ciudad` AND `lugar`
  - `early_bird_price < regular_price` enforcement
  - Detección de códigos de descuento duplicados
  - Todos los arrays validados antes de iterar
- Exporta constantes reutilizables (MODALIDADES_VALIDAS, TIPOS_DESCUENTO, etc.)

**`services/evento.service.js` — creado:**
- `crear(body, organizador)`: orquesta validación BD → normalización → insert → progreso
- `getCategorias(q)`: búsqueda con ilike
- `calcularProgreso(datos)`: función pura extraída del route original
- Helpers privados: `_normalizarEntradas`, `_normalizarDescuentos`, `_normalizarSpeakers`, etc.
- `_resolverCategoria`: lookup BD + creación si no existe
- Responde `{ok, data}` o `{ok:false, status, error, meta}`

**`routes/eventos_post.js` — refactorizado (450 → 50 líneas):**
- Antes: 450 líneas mezclando validación + lógica + BD + HTTP
- Ahora: parsea body → llama validator → llama service → responde
- Misma respuesta JSON que antes (retrocompatible con frontend)

#### FASE 5.2 — Socket.IO Scoped (completada)

**`services/notification.service.js`:**
- `this._io.emit()` global → `this._io.to('user:${userId}').emit()` para notificaciones de usuario
- Alertas de sistema → `this._io.to('system_alerts').emit()`
- Nunca más broadcast a todos los clientes conectados

**`index.js`** (ya tenía desde sesión anterior):
- `socket.on('join', userId => socket.join('user:${userId}'))` — cliente se suscribe a su room
- Clientes admin también pueden suscribirse a `system_alerts`

#### FASE 5.3 — Notificaciones Persistentes (completada)

**`services/notification.service.js` — refactorizado:**
- Persiste en Supabase tabla `notifications` (ver migración 001)
- **Graceful degradation**: si Supabase falla → fallback a memoria sin crashear
- `create()`, `getAll()`, `markAsRead()` → todos `async`
- `getAll({ userId, limit, onlyUnread })` — soporta filtros
- Renombrado `_store` → `_memStore` (clarifica que es el fallback)

**`routes/notification.routes.js` — actualizado:**
- Añadida autenticación JWT
- Admins ven todas las notificaciones; usuarios solo las propias
- Soporta query params: `?unread=true`, `?limit=N`

**`docs/migrations/001_notifications_table.sql` — creado:**
- Tabla `notifications` con índices de performance
- Índice parcial para no-leídas (más eficiente que índice total)
- Índice compuesto para query principal
- RLS policy preparada para multi-tenancy
- Procedimiento `cleanup_old_notifications()` para limpieza automática
- Rollback documentado

**`tests/notification.service.test.js` — actualizado:**
- `create/getAll/markAsRead` → `await`
- `_store` → `_memStore`
- Socket.IO mock actualizado: `io.to(room).emit()` en lugar de `io.emit()`
- Tests de scoping: verifica que `user:42` y `system_alerts` reciben la notificación correcta
- Supabase mockeado para forzar modo memoria en tests (sin BD real)

---

## Archivos modificados — sesión 2026-05-12 (Fase 5)

```
Creados:
  services/evento.service.js
  docs/migrations/001_notifications_table.sql

Modificados:
  validators/evento.validator.js         (expandido con validaciones faltantes)
  services/notification.service.js       (Supabase + fallback + Socket.IO scoped)
  routes/eventos_post.js                 (450 → 50 líneas, delgado)
  routes/notification.routes.js          (async + auth + filtros)
  tests/notification.service.test.js     (async API + scoped socket tests)
```

---

## Estado de tests

| Suite | Tests | Estado |
|---|---|---|
| auth.routes.test.js | 17 | ✅ |
| responsividad.test.js | 13 | ✅ |
| notification.service.test.js | 18 | ✅ (+2 nuevos: scoped socket) |
| roles.middleware.test.js | 27 | ✅ |
| **Total** | **75** | **✅ 75/75** |

---

## Vulnerabilidades corregidas (historial)

| # | Vector | Estado |
|---|---|---|
| JWT_SECRET fallback hardcodeado | ✅ Eliminado |
| Registro acepta `rol` del body | ✅ Ignorado, siempre 'asistente' |
| Sin helmet / rate limiting / sanitize | ✅ Activos |
| Sentry DSN hardcodeado | ✅ Env var |
| Socket.IO broadcast global | ✅ Scoped por userId/room |
| Notificaciones en memoria (pérdida en restart) | ✅ Supabase + fallback |
| 450 líneas de negocio en una sola ruta | ✅ Extraído a service + validator |

---

## Riesgos pendientes

### Altos
| # | Descripción | Ubicación |
|---|---|---|
| Token JWT en localStorage (XSS) | `frontend/context/AuthContext.jsx` |
| Sin Row Level Security real en Supabase | BD — tabla `notifications` tiene RLS pero `eventos` no |
| Sin índices en tablas de eventos | Supabase — tabla `eventos` |
| eventos_get_lista / detalle / patch sin service layer | `routes/eventos_*.js` |

### Medios
| # | Descripción |
|---|---|
| Sin refresh tokens (JWT 8h sin revocación) |
| GET /eventos/:id/asistentes sin paginación |
| Sin tests para rutas de eventos |
| Coverage actual ~45% — necesita rutas de eventos |

---

## Decisiones técnicas

| Decisión | Justificación | Fecha |
|---|---|---|
| Graceful degradation en notifications | Supabase puede no tener la tabla si no se ejecutó la migración. El sistema no puede crashear por una función secundaria. | 2026-05-12 |
| Socket.IO `to('system_alerts')` para alertas sin userId | Separa notificaciones de usuario de alertas de sistema. Admin se suscribe a su room + a system_alerts desde el cliente. | 2026-05-12 |
| `_memStore` en lugar de `_store` | Comunica claramente que es el almacén de fallback, no el primario. | 2026-05-12 |
| Mock Supabase en tests de notification | El service intenta Supabase primero. Mockear hace que falle rápido y use memoria. Tests se ejecutan sin BD real. | 2026-05-12 |
| `crear()` en service retorna `{ok, data}` | Mismo patrón que `auth.service.js` — consistencia en toda la capa de servicios. | 2026-05-12 |
| `_resolverCategoria()` retorna `{_error: true}` en lugar de `throw` | El service no debe usar excepciones para flujo de negocio. El route lee `_error` y responde apropiadamente. | 2026-05-12 |

---

## Próximos pasos recomendados

### OBLIGATORIO antes de producción
1. **Ejecutar migración SQL** — `docs/migrations/001_notifications_table.sql` en Supabase
2. **Índices en tabla `eventos`** — nombre, fecha_inicio, estado, ciudad (sin índices → full table scan)
3. **JWT en localStorage** → migrar a HttpOnly cookie (2 días de esfuerzo)

### Prioridad alta (sprint 3)
4. **`services/usuario.service.js`** — extraer lógica de `routes/usuarios.js`
5. **Refactorizar `eventos_get_lista.js` y `eventos_patch_delete.js`** — mismo patrón que eventos_post
6. **Paginación en GET /eventos/:id/asistentes** — sin límite actualmente
7. **Tests para rutas de eventos** — coverage actual <50%

### Prioridad media
8. **Soft-delete** en eventos y usuarios (compliance)
9. **Refresh tokens** — access 15min + refresh 30d
10. **RLS en tabla `eventos`** — actualmente depende de filtros de aplicación
11. **Code splitting** en frontend (React.lazy) — bundle único de 386KB

---

## TODO pendiente

- [ ] Ejecutar `docs/migrations/001_notifications_table.sql` en Supabase
- [ ] Crear índices en tabla `eventos` (nombre, fecha_inicio, estado, ciudad)
- [ ] `services/usuario.service.js`
- [ ] Refactorizar eventos_get_lista.js → service layer
- [ ] Refactorizar eventos_patch_delete.js → service layer
- [ ] Paginación en GET /eventos/:id/asistentes
- [ ] Tests para rutas de eventos (crear, publicar, inscribir)
- [ ] JWT localStorage → HttpOnly cookie
- [ ] Refresh tokens
- [ ] RLS en tabla `eventos`
- [ ] Code splitting frontend

---

## Variables de entorno

```env
# OBLIGATORIAS — exit(1) en producción si faltan
JWT_SECRET=<mínimo 32 chars aleatorios>
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>

# RECOMENDADAS
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://tu-dominio.com
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
JWT_EXPIRES=8h

# OPCIONALES
ENABLE_SOCKETS=true
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_AUTH_WINDOW=15
RATE_LIMIT_API_MAX=200
RATE_LIMIT_API_WINDOW=15
```

---

## Deuda técnica

| Área | Descripción | Severidad | Esfuerzo |
|---|---|---|---|
| BD | Sin migración ejecutada en Supabase (notifications) | **Crítica** | 5 min (ejecutar SQL) |
| BD | Sin índices en tabla `eventos` | Alta | 4 horas |
| Arquitectura | eventos_get_lista / patch sin service layer | Alta | 2 días |
| Auth | JWT en localStorage (XSS) | Media | 2 días |
| Auth | Sin refresh tokens | Media | 2 días |
| Testing | Coverage <50% (faltan eventos, usuarios) | Alta | 3 días |
| Multi-tenancy | Sin RLS en tabla `eventos` | Alta | 2 días |
| Frontend | Bundle único sin code splitting | Baja | 3 horas |

---

*Última actualización: 2026-05-12 | Responsable: Claude Code + Misael Gallo*
