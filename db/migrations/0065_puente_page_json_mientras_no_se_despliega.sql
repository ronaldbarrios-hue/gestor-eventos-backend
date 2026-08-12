-- 0065 · PUENTE TEMPORAL. Se borra cuando el código nuevo esté desplegado.
--
-- ── Qué pasó ──────────────────────────────────────────────────────────
--
-- La 0064 sacó `branding`, `pages` y `navbar` de `page_json` dando por hecho
-- que el código nuevo subiría a la vez. No fue así: **el backend de Render
-- está vivo y corre el código viejo**, que devuelve `page_json` en crudo, sin
-- el `conSitio` que vuelve a meter las tres claves dentro. El frontend viejo
-- lee `page_json.pages` para pintar la landing, así que las páginas públicas
-- de los 31 eventos salieron vacías hasta que se aplicó esto.
--
-- (El `POR-HACER.md` decía que el backend nunca se había desplegado en Render.
--  Era falso. Comprobar antes de migrar, no leer.)
--
-- ── Qué hace ──────────────────────────────────────────────────────────
--
--   1. Devuelve las copias a `page_json`, para que el código viejo LEA bien.
--   2. Un trigger mantiene las columnas al día cuando el código viejo ESCRIBE
--      `page_json`. Sin él, editar una landing desde el panel actual dejaría
--      las columnas viejas, y al desplegar lo nuevo —que lee de la columna—
--      esas ediciones parecerían haberse perdido.
--
-- ── Por qué es seguro para el código nuevo ────────────────────────────
--
--   · Al LEER, `lib/eventoSitio.js` siempre pisa las claves del JSON con el
--     valor de la columna, incluso vacío. Las copias son inertes: no pueden
--     resucitar una marca borrada, que era el motivo de quitarlas.
--   · Al ESCRIBIR, `partirSitio` borra esas claves del payload entrante, así
--     que el trigger no ve nada y no toca las columnas. Se vuelve inerte solo
--     el día que se despliegue.
--
-- ── Cómo retirarlo ────────────────────────────────────────────────────
--
-- Con el backend Y el frontend nuevos desplegados y comprobados:
--
--     drop trigger if exists trg_puente_page_json on public.eventos;
--     drop function if exists private.fn_puente_page_json();
--     update public.eventos
--        set page_json = page_json - 'branding' - 'pages' - 'navbar'
--      where page_json ?| array['branding', 'pages', 'navbar'];
--
-- Ese `update` es el que quedó pendiente de la 0064. Hasta entonces hay dos
-- copias del mismo dato a propósito, y el trigger es lo que evita que se
-- separen.

/* ── 1 · Devolver las copias ───────────────────────────────────────── */
update public.eventos
   set page_json = coalesce(page_json, '{}'::jsonb)
                 || jsonb_build_object('pages', paginas)
                 || case when branding <> '{}'::jsonb
                         then jsonb_build_object('branding', branding) else '{}'::jsonb end
                 || case when navbar   <> '{}'::jsonb
                         then jsonb_build_object('navbar', navbar)     else '{}'::jsonb end;

/* ── 2 · Mantener las columnas al día si escribe el código viejo ───── */
create or replace function private.fn_puente_page_json()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  /* Sólo actúa si el payload TRAE la clave dentro del JSON, que es la firma
     del código viejo. El nuevo la quita antes de guardar. */
  if new.page_json ? 'pages' and jsonb_typeof(new.page_json -> 'pages') = 'array'
     and new.page_json -> 'pages' is distinct from new.paginas then
    new.paginas := new.page_json -> 'pages';
  end if;

  if new.page_json ? 'branding' and jsonb_typeof(new.page_json -> 'branding') = 'object'
     and new.page_json -> 'branding' is distinct from new.branding then
    new.branding := new.page_json -> 'branding';
  end if;

  if new.page_json ? 'navbar' and jsonb_typeof(new.page_json -> 'navbar') = 'object'
     and new.page_json -> 'navbar' is distinct from new.navbar then
    new.navbar := new.page_json -> 'navbar';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_puente_page_json on public.eventos;
create trigger trg_puente_page_json
  before insert or update of page_json on public.eventos
  for each row execute function private.fn_puente_page_json();

comment on function private.fn_puente_page_json() is
  'PUENTE TEMPORAL (0065). Mantiene branding/paginas/navbar al día mientras siga vivo el código que escribe dentro de page_json. Borrar junto con el trigger cuando backend y frontend nuevos estén desplegados.';
