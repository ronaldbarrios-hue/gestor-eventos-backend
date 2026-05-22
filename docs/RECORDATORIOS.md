# Recordatorios email automáticos

Sistema que envía un email a cada asistente con boleta pagada en tres momentos: **T-7 días**, **T-1 día** y **T-1 hora** antes del evento.

## Arquitectura

```
[pg_cron cada hora]
       ↓
[Edge Function send-reminders]
       ↓
[find_pending_reminders() SQL]   ← detecta qué hay que mandar
       ↓
[Resend API]                      ← provider de email
       ↓
[email_log]                       ← idempotencia (no duplicar)
```

- **Idempotencia**: un mismo ticket no recibe dos veces el mismo tipo (unique index `email_log (ticket_id, tipo)`).
- **Toggle**: cada evento tiene `email_reminders boolean default true` en `eventos`.
- **Estado del ticket**: solo se envía a tickets `estado='pagado'`.

## Setup paso a paso

### 1. Aplicar migration

En Supabase SQL editor, correr `db/migrations/0017_email_reminders.sql`.

Verificar que la función exista:
```sql
select * from public.find_pending_reminders(10);
```

### 2. Crear cuenta Resend (gratis hasta 3.000 emails/mes)

1. https://resend.com/signup
2. Verificar dominio (Settings → Domains → Add Domain). Mientras no tengas, podés usar el sandbox `onboarding@resend.dev` solo para mandar a TU email.
3. Crear API key (Settings → API Keys → Create). Copiarla, empieza con `re_...`.

### 3. Deploy de la Edge Function

Necesitás Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref <TU_PROJECT_REF>   # lo ves en la URL de Supabase
```

Deploy:
```bash
supabase functions deploy send-reminders --no-verify-jwt
```

> El flag `--no-verify-jwt` permite que pg_cron la invoque sin token de usuario. La función internamente usa service_role para acceder a la DB, así que no hay riesgo.

### 4. Configurar secrets de la Edge Function

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
supabase secrets set RESEND_FROM="GESTEK <onboarding@resend.dev>"
supabase secrets set PUBLIC_FRONTEND_URL=https://gestek.io
```

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen automáticamente en Edge Functions.

### 5. Probar la función manualmente

```bash
curl -X POST "https://<TU_PROJECT_REF>.supabase.co/functions/v1/send-reminders" \
  -H "Authorization: Bearer <TU_ANON_KEY>"
```

Respuesta esperada:
```json
{ "procesados": 0, "enviados": 0, "fallidos": 0, "detalles": [] }
```

Si tenés un evento de prueba con fecha exactamente en 7 días (o 24h o 1h), verás `procesados > 0`.

### 6. Schedule con pg_cron

En el SQL editor de Supabase:

```sql
-- Habilitar las extensiones (una vez)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Programar la Edge Function cada hora en :05
select cron.schedule(
  'send-reminders-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://<TU_PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <TU_ANON_KEY>',
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Verás el job activo con:
```sql
select * from cron.job;
```

Si querés desactivarlo:
```sql
select cron.unschedule('send-reminders-hourly');
```

## Troubleshooting

### "No llegan emails"
1. `curl` manual a la función — ¿devuelve `procesados > 0`?
2. Revisar `email_log` en la DB para ver intentos: `select * from email_log order by created_at desc limit 20;`
3. Si `status='failed'`, leer la columna `error`.

### "Veo el log pero el email no llega"
- Resend manda solo si el dominio está verificado, o si el destinatario es el mismo email con que creaste la cuenta Resend (sandbox).

### "Quiero apagar recordatorios para un evento puntual"
- Toggle en el tab Resumen del evento (`email_reminders = false`).

### "El cron no parece correr"
- Ver historial: `select * from cron.job_run_details order by start_time desc limit 10;`
- Verificar que pg_net respondió OK (columna `status`).

## Costos

- Resend: 3.000 emails/mes gratis, después USD 20/mes por 50.000.
- pg_cron + pg_net: incluidos en cualquier plan de Supabase, sin costo extra.
- Edge Function: ~500K invocations/mes gratis (con plan Free de Supabase).

Con un evento típico de 200 asistentes recibiendo 3 recordatorios = 600 emails. **Caben ~5 eventos/mes en el tier gratis de Resend.**

---

# Recordatorios in-app (notificaciones internas)

Independiente del email. Crea filas en `notificaciones` para owner + equipo +
asistentes con cuenta, en las mismas ventanas T-7d / T-1d / T-1h.

**No requiere Edge Function ni Resend** — es una función SQL pura que pg_cron
puede llamar directo.

## Setup

### 1. Aplicar migration

`db/migrations/0023_recordatorios_inapp.sql` en el SQL editor.

Verificá que funcione:
```sql
select public.generar_recordatorios_inapp();  -- devuelve cuántas creó
```

### 2. Schedule con pg_cron

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'recordatorios-inapp-hourly',
  '10 * * * *',                       -- cada hora en el minuto :10
  $$ select public.generar_recordatorios_inapp(); $$
);
```

Listo. No hay provider externo, no hay secrets, no hay Edge Function.

### 3. Probar sin esperar el cron

Desde la app (logueado), el backend expone:
```
POST /me/notificaciones/generar-recordatorios
```
Devuelve `{ ok: true, creadas: N }`. Si tenés un evento publicado con
`fecha_inicio` dentro de alguna de las ventanas, vas a ver `creadas > 0` y la
campana del TopBar recibirá la notificación en tiempo real.

## Desactivar para un evento

Mismo toggle que email: tab Resumen del evento → "Recordatorios email"
(`eventos.email_reminders = false`) apaga **ambos** (email + in-app).

## Idempotencia

Tabla `recordatorio_inapp_log` con unique `(scope_id, evento_id, tipo)`. Correr
la función mil veces no duplica notificaciones.
