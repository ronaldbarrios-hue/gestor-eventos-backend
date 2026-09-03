-- 0092 · Las zonas dejan `page_json`. PASO 3 de 3 (contract).
--
-- APLICADA el 2026-09-03 — y se corrió ANTES de que el código estuviera
-- desplegado, aunque el PR ya estuviera fusionado. Cuatro pantallas se quedaron
-- en blanco durante horas: Zonas del evento, el selector de zona de un
-- sub-evento, el escáner y el bloque de mapa. Sin un solo error.
--
-- Se deja escrito el aviso original, que era correcto y no bastó:
--
--    **El código del paso 2 tiene que estar DESPLEGADO y corriendo.**
--
--    Producción sirve hoy el código viejo, que lee las zonas de
--    `page_json.zonas`. Si esta migración se corre antes de desplegar, el plano
--    de los eventos desaparece **en el momento**: no hay error, no hay aviso,
--    simplemente no hay zonas. Es el único paso de los tres que puede romper
--    algo, y por eso lleva este cartel.
--
--    Comprobación antes de correrla: entrar a «Zonas del evento → Zonas de
--    interés» en el panel desplegado y ver que las zonas siguen ahí. Si se ven,
--    el código nuevo está sirviendo y lee de la tabla.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────
--
-- **No borra: guarda.** `page_json.zonas` se copia a `page_json.zonas_respaldo`
-- y se quita del sitio donde el código lo busca. Deshacerlo es una línea, y
-- mientras el respaldo exista este paso sigue siendo reversible — que es justo
-- lo que un `contract` normalmente deja de ser.
--
-- El respaldo se borra en otra migración, más adelante, cuando lleve semanas
-- sin hacer falta. Un jsonb con siete objetos no le pesa a nadie; perder el
-- plano de un evento en marcha, sí.
--
-- ── La red de seguridad ──────────────────────────────────────────────────
--
-- Se niega a correr si la tabla `zonas` tiene MENOS zonas que el JSON de ese
-- evento. Eso sólo puede significar que la copia de la 0091 se quedó corta o
-- que alguien creó zonas con el código viejo después: en los dos casos, quitar
-- el JSON perdería datos.
--
-- Idempotente: un evento que ya pasó no tiene `zonas` que mover.

do $$
declare
  v_evento record;
  v_en_json integer;
  v_en_tabla integer;
  v_movidos integer := 0;
begin
  for v_evento in
    select id, page_json from public.eventos
     where page_json ? 'zonas'
  loop
    select count(*) into v_en_json
      from jsonb_array_elements(coalesce(v_evento.page_json->'zonas', '[]'::jsonb)) el
     where nullif(el->>'id', '') is not null
       and nullif(trim(el->>'nombre'), '') is not null;

    select count(*) into v_en_tabla
      from public.zonas where evento_id = v_evento.id;

    if v_en_tabla < v_en_json then
      raise exception
        'El evento % tiene % zonas en page_json y sólo % en la tabla. No se quita nada: primero hay que averiguar por qué falta alguna.',
        v_evento.id, v_en_json, v_en_tabla;
    end if;

    update public.eventos
       set page_json = (page_json - 'zonas') || jsonb_build_object('zonas_respaldo', page_json->'zonas')
     where id = v_evento.id;

    v_movidos := v_movidos + 1;
  end loop;

  raise notice 'zonas movidas a respaldo en % evento(s)', v_movidos;
end $$;

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   update public.eventos
--      set page_json = (page_json - 'zonas_respaldo')
--                      || jsonb_build_object('zonas', page_json->'zonas_respaldo')
--    where page_json ? 'zonas_respaldo';
--
-- Y con eso el código viejo vuelve a encontrar sus zonas donde las busca.
