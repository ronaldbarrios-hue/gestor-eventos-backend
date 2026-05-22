/* Cliente Supabase con service_role.
   Backend-only. Salta RLS porque el backend ya hace su propia autorización
   en cada handler (compara owner_id contra req.user.id). */
const { createClient } = require('@supabase/supabase-js');

const URL  = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !KEY) {
  console.error('[supabase] Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabase;
