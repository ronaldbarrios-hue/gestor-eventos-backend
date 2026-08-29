-- 002_cerrar_profiles_entre_cuentas.sql
--
-- ⚠ POSTGRES (Supabase). Y **no se aplica todavía**: hay que esperar a que el
-- frontend que lee de `perfiles_publicos` esté desplegado. Si se aplica antes,
-- el chat se queda sin nombres ni fotos.
--
-- ── Qué cierra ───────────────────────────────────────────────────────────
--
-- El 29 de agosto se cerró la lectura ANÓNIMA de `profiles`: la política decía
-- `((auth.uid() = id) OR true)` y con la llave del bundle cualquiera en
-- internet leía 29 correos, 24 teléfonos y los tokens de pago.
--
-- Lo que quedó abierto fue entre cuentas: la política tuvo que quedar en
-- «cualquier autenticado lee la tabla entera», porque el chat necesitaba el
-- nombre y la foto de otras personas y las pedía a `profiles`. Con 29 cuentas
-- eso es poco riesgo; con el evento y sus invitados, ya no.
--
-- La vista `perfiles_publicos` (migración anterior) expone sólo id, nombre y
-- avatar. Cuando el frontend lea de ahí —commit «El chat lee la vista, no la
-- ficha entera»— esta migración termina el trabajo.
--
-- ── Antes de aplicarla, comprobar tres cosas ─────────────────────────────
--
-- 1. Que el frontend desplegado en producción trae el cambio. Se comprueba por
--    contenido, que es lo único concluyente: buscar `perfiles_publicos` en el
--    bundle que sirve Vercel. Comparar hashes NO vale.
-- 2. Abrir un chat de evento con dos cuentas distintas y ver que los mensajes
--    del otro salen con su nombre y su foto.
-- 3. Que Ajustes, Completar perfil y la conexión de Mercado Pago siguen
--    cargando: las tres leen la ficha PROPIA y siguen pudiendo.

BEGIN;

DROP POLICY IF EXISTS profiles_select_autenticados ON public.profiles;

-- Cada quien la suya, y nada más.
CREATE POLICY profiles_select_propia ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Comprobación: con esto, una cuenta cualquiera sólo puede ver una fila.
-- (Devuelve 1 si la política quedó bien escrita; 0 o 29 significan que no.)
SELECT count(*) AS filas_que_veria_una_cuenta
  FROM public.profiles
 WHERE id = '00000000-0000-0000-0000-000000000000';   -- sustituir por un uid real al probar

COMMIT;

-- Y después, para confirmarlo desde fuera y no desde aquí —con la service key
-- todo funciona siempre, que es la trampa de siempre—: entrar a la aplicación
-- con una cuenta normal y mirar que el chat sigue enseñando nombres.
