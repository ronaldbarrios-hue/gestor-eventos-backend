-- 0097 · Políticas RLS para las tablas que tenían la puerta cerrada y ninguna llave.
--
-- ── Qué había, medido el 2026-09-03 ─────────────────────────────────────
--
-- **23 tablas con RLS activada y CERO políticas.** (Los papeles decían 14; son
-- 23.) RLS sin políticas deniega todo, así que hoy no hay ninguna fuga: el
-- backend entra con la service key, que se salta RLS, y el navegador no lee
-- estas tablas directamente.
--
-- El problema es el día que haga falta: la consulta desde el navegador devuelve
-- una lista vacía **sin error**, y alguien pierde una tarde buscando el fallo en
-- el código. Ya pasó dos veces esta semana con otros datos que desaparecían sin
-- avisar.
--
-- ── La regla que gobierna este archivo ───────────────────────────────────
--
-- **Una política sólo puede ABRIR, nunca cerrar.** Sin política, todo está
-- denegado; cada línea de aquí abajo es un permiso nuevo. Así que la pregunta
-- para cada tabla no es «¿qué política le pongo?» sino **«¿quién necesita leer
-- esto desde un navegador, hoy?»** — y cuando la respuesta es «nadie», lo
-- correcto es no escribir nada y decir por qué.
--
-- Por eso este archivo deja **nueve tablas sin política a propósito**, con su
-- motivo escrito. No están olvidadas: están cerradas.
--
-- ── El idioma, copiado del que ya existe ─────────────────────────────────
--
-- Las políticas que ya había usan `owner_id = auth.uid()` y, para lo público,
-- `estado = 'publicado' and deleted_at is null`. Se sigue el mismo idioma y NO
-- se añade acceso por `event_members`: sería un permiso nuevo que hoy nadie
-- concede desde el navegador, y ampliar de más es el único error que este
-- archivo puede cometer.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Del dueño del evento, y sólo suyo
-- ═══════════════════════════════════════════════════════════════════════
--
-- Datos de operación: quién esperaba cupo, qué motivos hay, quién entró y salió
-- de cada zona. Los ve quien es dueño del evento; nadie más, ni siquiera el
-- resto del equipo (para eso está la API, que sí sabe de roles).

do $$
declare
  t      text;
  nombre text;
begin
  foreach t in array array[
    'event_form_fields', 'event_waitlist', 'evento_motivos', 'evento_alertas',
    'ticket_interacciones', 'ticket_movimientos', 'zona_cortes', 'padron_previo',
    'event_requests'
  ] loop
    /* El nombre de la política se arma aparte y se pasa como identificador
       propio. Pegarlo detrás del `%I` de la tabla produce `"tabla"_select_owner`,
       que no es SQL válido — y ese fallo sale al correr la migración, no al
       escribirla. */
    nombre := t || '_select_owner';

    execute format('drop policy if exists %I on public.%I', nombre, t);
    execute format(
      'create policy %I on public.%I for select using (exists ('
      || 'select 1 from public.eventos e where e.id = %I.evento_id and e.owner_id = auth.uid()))',
      nombre, t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Las zonas: públicas cuando el evento lo es
-- ═══════════════════════════════════════════════════════════════════════
--
-- `zonas` es el único caso de este grupo que el público YA ve: el bloque de mapa
-- de la landing pinta el nombre de cada punto del plano. La API lo sirve, así
-- que denegarlo aquí no protege nada — sólo obligaría a pasar siempre por la API
-- para un dato que es público por diseño.
--
-- Se abre en las mismas condiciones que el evento: publicado y sin borrar.

drop policy if exists zonas_select_publico on public.zonas;
create policy zonas_select_publico on public.zonas
  for select using (exists (
    select 1 from public.eventos e
     where e.id = zonas.evento_id
       and ((e.estado = 'publicado' and e.deleted_at is null) or e.owner_id = auth.uid())));

drop policy if exists zonas_write_owner on public.zonas;
create policy zonas_write_owner on public.zonas
  for all using (exists (
    select 1 from public.eventos e
     where e.id = zonas.evento_id and e.owner_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Lo que es de una persona, y de nadie más
-- ═══════════════════════════════════════════════════════════════════════

-- Su propio perfil de talento. Y el de quien lo haya PUBLICADO, que es lo que
-- significa publicarlo: aparecer en la búsqueda de quien contrata.
drop policy if exists perfil_talento_select on public.perfil_talento;
create policy perfil_talento_select on public.perfil_talento
  for select using (user_id = auth.uid() or publicado = true);

drop policy if exists perfil_talento_write_self on public.perfil_talento;
create policy perfil_talento_write_self on public.perfil_talento
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Una postulación la ven dos: quien se postuló y quien publicó la vacante.
drop policy if exists postulaciones_select on public.postulaciones;
create policy postulaciones_select on public.postulaciones
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.vacantes v where v.id = postulaciones.vacante_id and v.owner_id = auth.uid()));

-- Las reseñas: quien la escribió y quien la recibió.
drop policy if exists talento_resenas_select on public.talento_resenas;
create policy talento_resenas_select on public.talento_resenas
  for select using (de_user_id = auth.uid() or para_user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · Las vacantes publicadas son públicas
-- ═══════════════════════════════════════════════════════════════════════
--
-- Una vacante existe para que la vea gente que no tiene cuenta todavía. Lo que
-- no se abre es la que ya no recibe postulaciones.
--
-- El estado es **`abierta`**, comprobado contra los datos y contra
-- `routes/vacantes.js`, que expone exactamente ese. Escribir aquí `'publicada'`
-- —que es como suena— habría dejado una política que no coincide con nada: no
-- fallaría, simplemente no dejaría ver ninguna vacante, y eso se busca durante
-- horas.
--
-- Y el evento tiene que estar publicado también: una vacante abierta de un
-- evento en borrador no es pública.

drop policy if exists vacantes_select_publicas on public.vacantes;
create policy vacantes_select_publicas on public.vacantes
  for select using (
    owner_id = auth.uid()
    or (estado = 'abierta' and exists (
      select 1 from public.eventos e
       where e.id = vacantes.evento_id and e.estado = 'publicado' and e.deleted_at is null)));

drop policy if exists vacantes_write_owner on public.vacantes;
create policy vacantes_write_owner on public.vacantes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · El catálogo de roles
-- ═══════════════════════════════════════════════════════════════════════
--
-- Los globales son un catálogo: nombres de rol, sin nada dentro. Los que crea un
-- organizador son suyos.

drop policy if exists catalogo_roles_select on public.catalogo_roles;
create policy catalogo_roles_select on public.catalogo_roles
  for select using (global = true or owner_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════
-- 6 · Las que se quedan CERRADAS, y por qué
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ninguna de éstas lleva política, y no es un olvido. Un `select` desde el
-- navegador sobre cualquiera de ellas debe devolver vacío, porque el navegador
-- no tiene nada que hacer ahí:
--
--   · `evento_smtp`      — contraseña del correo del organizador, aunque esté
--                          cifrada. Ni el propio dueño la lee desde el
--                          navegador: la usa el servidor para enviar.
--   · `organizador_conexiones` — lo mismo: credenciales de terceros cifradas.
--   · `oauth_clients`, `oauth_codes`, `oauth_tokens` — el secreto, el código de
--                          intercambio y los tokens. Abrir cualquiera de las
--                          tres convierte el OAuth en un adorno.
--   · `email_cola`       — lleva el contexto de cada correo pendiente, con
--                          direcciones y datos personales de terceros.
--   · `cobros_vacantes`  — dinero entre dos partes que no son quien mira.
--   · `recordatorio_inapp_log` — sólo lo usa el proceso que evita mandar dos
--                          veces el mismo aviso.
--
-- Si algún día una de éstas hace falta desde el navegador, lo que hay que
-- escribir no es una política: es un endpoint que decida qué se puede enseñar.

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select c.relname,
--          (select count(*) from pg_policies p
--            where p.schemaname='public' and p.tablename=c.relname) as politicas
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
--    order by politicas, c.relname;
--
-- Tras aplicar esto, las que sigan en 0 tienen que ser exactamente las nueve de
-- la lista de arriba. Cualquier otra en 0 es una tabla nueva que nadie miró.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
-- Quitar una política sólo puede CERRAR, así que revertir es seguro: se borran
-- por nombre. Todas llevan el nombre de su tabla como prefijo.
