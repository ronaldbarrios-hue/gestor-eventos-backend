# Configuración de Supabase Auth — GESTEK

Esta guía configura el proyecto Supabase para que funcione el flujo completo
de autenticación: registro, confirmación por email, login y recuperación de
contraseña.

## 1. Crear el proyecto Supabase

1. Ve a https://supabase.com y crea un proyecto nuevo.
2. Anota la **URL del proyecto** y la **anon public key** (Dashboard → Project Settings → API).

## 2. Variables de entorno

Crea `frontend/.env.local` (no commitear) con:

```bash
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Reinicia el dev server después de cambiar el `.env.local`.

## 3. Configurar Auth en el dashboard

### 3.1 Email Provider

`Authentication → Providers → Email`:

- ✅ **Enable Email provider**
- ✅ **Confirm email** — obligar confirmación antes de login
- ⛔ **Disable signup** — dejar desactivado para permitir registro

### 3.2 SMTP (para mandar correos reales)

`Authentication → Settings → SMTP Settings`:

Para empezar, el SMTP por defecto de Supabase funciona (limitado a ~4 correos
por hora). Para producción configura tu propio SMTP — recomendado **Resend**,
**SendGrid** o **Postmark**:

```
Host:      smtp.resend.com
Port:      465
Username:  resend
Password:  <tu API key de Resend>
Sender:    noreply@tudominio.com
Sender name: GESTEK
```

### 3.3 URL Configuration (importante)

`Authentication → URL Configuration`:

**Site URL** (la del frontend en producción):
```
https://tudominio.com
```

En desarrollo:
```
http://localhost:5173
```

**Redirect URLs** (whitelisted — agregar TODAS estas):
```
http://localhost:5173/**
https://tudominio.com/**
```

### 3.4 Email templates

`Authentication → Email Templates`:

Personaliza los 3 templates en español. Mantén la variable `{{ .ConfirmationURL }}`
intacta — Supabase la reemplaza por el link correcto.

**Confirm signup**:
```html
<h2>Confirma tu cuenta en GESTEK</h2>
<p>Hola,</p>
<p>Gracias por registrarte. Confirma tu cuenta haciendo click en el siguiente enlace:</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar mi cuenta</a></p>
<p>Si no fuiste tú, ignora este correo.</p>
<p>— Equipo GESTEK</p>
```

**Reset password**:
```html
<h2>Restablecer contraseña</h2>
<p>Recibimos una solicitud para restablecer tu contraseña.</p>
<p><a href="{{ .ConfirmationURL }}">Crear nueva contraseña</a></p>
<p>Este enlace expira en 1 hora. Si no fuiste tú, ignora este correo.</p>
<p>— Equipo GESTEK</p>
```

**Magic Link** (opcional — no se usa por ahora pero conviene tenerlo en español).

## 4. Rutas de la app que Supabase llama

| Flow                       | URL de redirect              | Componente            |
|----------------------------|------------------------------|-----------------------|
| Confirm signup             | `/confirmar`                 | `ConfirmarPage`       |
| Reset password             | `/restablecer`               | `ResetPasswordPage`   |
| Login redirect tras OK     | `/dashboard`                 | `DashboardPage`       |

Estas rutas ya están registradas en `frontend/src/App.jsx`.

## 5. Probar el flujo end-to-end

1. `cd frontend && npm run dev`
2. Ir a `http://localhost:5173/register`
3. Llenar el formulario en 2 pasos con un email real
4. Verás "Revisa tu correo" — abre el email de Supabase
5. Click en el link → redirige a `/confirmar` → "Cuenta confirmada" → dashboard
6. Logout
7. Login con email + contraseña
8. Probar "¿Olvidaste tu contraseña?" → `/recuperar` → email → `/restablecer`

## 6. Metadata del usuario

Los datos extra del registro (nombre, teléfono, foto, ocupación, empresa,
ciudad, contexto, etc.) se guardan en `user_metadata` del auth user. Los lee
`mapUser()` en `frontend/src/context/AuthContext.jsx`.

Si necesitas estos datos en queries SQL, crea una tabla `profiles` enlazada a
`auth.users.id` y un trigger `on_auth_user_created` que la pueble. Eso es
trabajo de Fase 5 cuando construyamos el módulo de eventos.

## 7. Troubleshooting

- **"Email not confirmed"** — Activa "Confirm email" en el provider y verifica
  que el SMTP esté funcionando.
- **El email no llega** — Revisa spam, revisa el rate limit de SMTP default
  (4/hora), o configura un SMTP propio.
- **Link inválido o expirado** — El link de confirmación expira en 24h, el de
  reset en 1h. Pide uno nuevo.
- **"Invalid login credentials"** — Email o password incorrectos, o el email
  aún no fue confirmado.
- **Redirect a localhost en producción** — Configura el `Site URL` y los
  `Redirect URLs` en el dashboard.
