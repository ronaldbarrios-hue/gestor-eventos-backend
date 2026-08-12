-- 0066 + 0067 · El puente, en los dos sentidos y con la precedencia correcta.
-- Sigue siendo TEMPORAL: se retira cuando no quede código leyendo
-- `page_json.branding` / `.pages` / `.navbar`. Ver el final de la 0065.
--
-- ── Por qué hacían falta los dos sentidos ─────────────────────────────
--
-- La 0065 sólo copiaba `page_json → columnas`. Eso cubre "el código viejo
-- escribe", pero durante el despliegue conviven cuatro combinaciones:
--
--   backend viejo + frontend viejo  → escribe page_json      (0065 lo cubría)
--   backend nuevo + frontend nuevo  → escribe columnas       ← faltaba
--   backend nuevo + frontend viejo  → manda page_json, pero `partirSitio` le
--                                     quita las claves, así que acaba siendo
--                                     una escritura de columnas             ← faltaba
--   backend viejo + frontend nuevo  → el backend viejo ignora las columnas
--                                     (no están en CAMPOS_EDITABLES)
--
-- Sin el sentido `columna → page_json`, en cuanto se desplegara el backend las
-- copias del JSON se quedarían congeladas y el frontend viejo —que lee de
-- ahí— seguiría mostrando la landing de antes del despliegue.
--
-- ── La precedencia, que la primera versión tenía mal ──────────────────
--
-- El primer intento decidía "si page_json trae la clave, gana el JSON". Está
-- mal: en un UPDATE que sólo toca la COLUMNA, `new.page_json` no es que traiga
-- la clave, es que la fila ya la tenía. El trigger leía esa copia vieja y
-- pisaba con ella el valor recién escrito:
--
--     update eventos set paginas = <nuevo>;   -- el trigger lo revertía
--
-- Es decir: el código nuevo no habría podido guardar la landing. Se detectó
-- probando los cuatro caminos, no leyendo el código.
--
-- La regla correcta no es "quién la trae" sino "quién CAMBIÓ en esta
-- sentencia", y eso se sabe comparando NEW con OLD:
--
--   1. Cambió el JSON    → lo escribió el código viejo  → gana el JSON.
--   2. Cambió la columna → lo escribió el código nuevo  → gana la columna.
--   3. No cambió ninguno → se mantienen espejadas.
--
-- Si cambiaran los dos a la vez gana la columna, que es la fuente de verdad
-- del diseño final. No debería pasar: ningún cliente escribe las dos.
--
-- Comprobado en producción, en una transacción deshecha, los cinco casos:
-- viejo→columna, columna→json, marca por columna, otra pantalla que sólo
-- guarda lo suyo, y borrar la marca a propósito sin que resucite.

create or replace function private.fn_puente_page_json()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  pj          jsonb := coalesce(new.page_json, '{}'::jsonb);
  pj_previo   jsonb := case when tg_op = 'UPDATE' then coalesce(old.page_json, '{}'::jsonb) else '{}'::jsonb end;
  json_cambio boolean;
  col_cambio  boolean;
begin
  ---------------------------------------------------------------- paginas
  json_cambio := (pj -> 'pages') is distinct from (pj_previo -> 'pages');
  col_cambio  := tg_op = 'INSERT' or new.paginas is distinct from old.paginas;

  if col_cambio then
    pj := pj || jsonb_build_object('pages', coalesce(new.paginas, '[]'::jsonb));
  elsif json_cambio and jsonb_typeof(pj -> 'pages') = 'array' then
    new.paginas := pj -> 'pages';
  else
    pj := pj || jsonb_build_object('pages', coalesce(new.paginas, '[]'::jsonb));
  end if;

  --------------------------------------------------------------- branding
  json_cambio := (pj -> 'branding') is distinct from (pj_previo -> 'branding');
  col_cambio  := tg_op = 'INSERT' or new.branding is distinct from old.branding;

  if col_cambio then
    if coalesce(new.branding, '{}'::jsonb) <> '{}'::jsonb then
      pj := pj || jsonb_build_object('branding', new.branding);
    else
      /* Marca borrada a propósito: la copia se va con ella, o el código viejo
         la resucitaría en la siguiente lectura. */
      pj := pj - 'branding';
    end if;
  elsif json_cambio and jsonb_typeof(pj -> 'branding') = 'object' then
    new.branding := pj -> 'branding';
  elsif coalesce(new.branding, '{}'::jsonb) <> '{}'::jsonb then
    pj := pj || jsonb_build_object('branding', new.branding);
  end if;

  ----------------------------------------------------------------- navbar
  json_cambio := (pj -> 'navbar') is distinct from (pj_previo -> 'navbar');
  col_cambio  := tg_op = 'INSERT' or new.navbar is distinct from old.navbar;

  if col_cambio then
    if coalesce(new.navbar, '{}'::jsonb) <> '{}'::jsonb then
      pj := pj || jsonb_build_object('navbar', new.navbar);
    else
      pj := pj - 'navbar';
    end if;
  elsif json_cambio and jsonb_typeof(pj -> 'navbar') = 'object' then
    new.navbar := pj -> 'navbar';
  elsif coalesce(new.navbar, '{}'::jsonb) <> '{}'::jsonb then
    pj := pj || jsonb_build_object('navbar', new.navbar);
  end if;

  new.page_json := pj;
  return new;
end;
$$;

/* Ahora también tiene que dispararse al tocar las COLUMNAS, no sólo page_json. */
drop trigger if exists trg_puente_page_json on public.eventos;
create trigger trg_puente_page_json
  before insert or update of page_json, branding, paginas, navbar on public.eventos
  for each row execute function private.fn_puente_page_json();

comment on function private.fn_puente_page_json() is
  'PUENTE TEMPORAL (0065/0066). Mantiene iguales las columnas branding/paginas/navbar y sus copias en page_json, escriba quien escriba. Borrar cuando no quede código leyendo page_json.branding/pages/navbar.';
