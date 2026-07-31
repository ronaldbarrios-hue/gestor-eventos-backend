# Independizarse de Supabase — runbook

Objetivo: dejar de depender del Supabase **gestionado** (que en el plan gratis pausa
y limita) y correr **nuestro propio Supabase self-hosted** en un VPS. El código NO
cambia: solo variables de entorno. La migración se hace **en paralelo** con rollback.

> Ver el plan completo (contexto, arquitectura, riesgos): artifact "GESTEK · Migración
> e independencia de Supabase".

## 0. Requisitos
- Un **VPS** con Docker (Hetzner / DigitalOcean / Contabo, ~USD 6–20/mes).
- Un **dominio/subdominio**: `db.tudominio.com` (Supabase), `api.tudominio.com` (backend).
- La **connection string** del Supabase gestionado (para el `pg_dump`).
- `pg_dump`/`pg_restore` (Postgres 15) en tu máquina o en el VPS.

## 1. Levantar Supabase self-hosted
```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# Edita .env: POSTGRES_PASSWORD, JWT_SECRET (largo), ANON_KEY/SERVICE_ROLE_KEY
# (se generan a partir del JWT_SECRET), SITE_URL, API_EXTERNAL_URL=https://db.tudominio.com
docker compose up -d
```
Apunta `db.tudominio.com` al VPS y pon un reverse proxy con TLS (o usa el Kong incluido).

## 2. Migrar esquema + datos
```bash
# Volcado del gestionado (formato custom, sin owners/privilegios)
pg_dump "postgresql://postgres:PASS@db.PROY.supabase.co:5432/postgres" \
  --no-owner --no-privileges --schema=public -Fc -f gestek.dump

# Restaurar en el propio
pg_restore --no-owner --no-privileges -d \
  "postgresql://postgres:PASS@db.tudominio.com:5432/postgres" gestek.dump
```
> Alternativa: `supabase db dump` (CLI) si prefieres SQL plano. Revisa que las
> extensiones (`pgcrypto`, etc.) queden creadas; el self-hosted ya trae la mayoría.

## 3. Migrar Storage (archivos)
```bash
cd /ruta/al/backend
SRC_SUPABASE_URL=https://PROY.supabase.co SRC_SERVICE_KEY=<service_gestionado> \
DST_SUPABASE_URL=https://db.tudominio.com DST_SERVICE_KEY=<service_propio> \
node deploy/migrar-storage.mjs
```
Recrea buckets `avatars`, `event-media`, `form-uploads` como **públicos**. Reaplica
límites/MIME y **NO** vuelvas a poner la política de listado público (ver migración 0048).

## 4. Recrear lo que no viaja en el dump
- **Buckets**: público/límites/MIME (ver notas en `db/migrations/` y auditoría 0048).
- **Tareas programadas** (recordatorios): reconfigurar el cron en el nuevo entorno.
- Revisa `db/migrations/0029..0050` como referencia del estado esperado.

## 5. Desplegar el backend GESTEK en el VPS
```bash
cp deploy/.env.example deploy/.env   # y rellena (SUPABASE_URL=https://db.tudominio.com, etc.)
# Edita deploy/Caddyfile con api.tudominio.com
docker compose -f deploy/docker-compose.yml up -d --build
```

## 6. Repuntar el frontend
```
VITE_SUPABASE_URL=https://db.tudominio.com
VITE_SUPABASE_ANON_KEY=<anon_propio>
VITE_API_URL=https://api.tudominio.com
```
Rebuild y redeploy del frontend.

## 7. Verificar en staging (antes del cutover)
- [ ] Login / registro / recuperar contraseña (Auth).
- [ ] Subir una imagen (Storage) y verla por su URL pública.
- [ ] Comprar una boleta (pasarela sandbox) → webhook → boleta pagada + correo.
- [ ] Check-in en vivo desde 2 dispositivos → el contador se actualiza (**Realtime**).
- [ ] Chat del evento en tiempo real (**Realtime**).

## 8. Cutover y rollback
- **Cutover**: apunta producción (envs + DNS) al nuevo. Mantén el gestionado encendido.
- **Rollback**: si algo falla, revierte las envs al Supabase gestionado (minutos).
- Cuando lleve días estable → apaga/borra el proyecto gestionado.

## 9. Operación (desde el día 1)
- **Backups**: `pg_dump` programado (cron diario) + snapshot del VPS.
- **Monitoreo**: healthcheck del backend + alertas de disco/CPU.
- **Actualizaciones**: `docker compose pull && up -d` para Supabase y la API.

---
**Nota**: cambiar el `JWT_SECRET` invalida las sesiones activas (los usuarios
re-inician sesión una vez). Avísalo en el cutover.
