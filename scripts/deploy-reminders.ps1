# GESTEK — Despliega el Edge Function de recordatorios.
# Requisitos: Supabase CLI instalado y logueado (supabase login),
#             y el project ref vinculado (supabase link --project-ref <ref>).
#
# Uso:  powershell -File scripts/deploy-reminders.ps1
#
# Después de desplegar:
#  1) Cargar secrets:
#     supabase secrets set RESEND_API_KEY=... RESEND_FROM="GESTEK <eventos@tu-dominio.com>" PUBLIC_FRONTEND_URL=https://tu-front
#  2) Programar el cron: pega db/migrations/_cron_send_reminders.sql en el SQL Editor.

$ErrorActionPreference = 'Stop'

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI no encontrado. Instala: https://supabase.com/docs/guides/cli" -ForegroundColor Red
  exit 1
}

Write-Host "Desplegando función send-reminders..." -ForegroundColor Cyan
supabase functions deploy send-reminders --no-verify-jwt

if ($?) {
  Write-Host "`nListo. Ahora:" -ForegroundColor Green
  Write-Host "  1. supabase secrets set RESEND_API_KEY=... RESEND_FROM=... PUBLIC_FRONTEND_URL=..."
  Write-Host "  2. Pega db/migrations/_cron_send_reminders.sql en el SQL Editor (con tu project ref y anon key)."
  Write-Host "  3. Prueba manual: POST https://<ref>.supabase.co/functions/v1/send-reminders"
}
