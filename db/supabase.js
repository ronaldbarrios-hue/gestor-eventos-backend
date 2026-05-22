const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);


//RONALD TIENE DEBE AGREGAR LA URL Y KEY EN EL .ENV PARA QUE FUNCIONE EL SUPABASE, SI NO LO HACE NO FUNCIONARA NADA DE LO RELACIONADO CON LA BASE DE DATOS
module.exports = supabase;