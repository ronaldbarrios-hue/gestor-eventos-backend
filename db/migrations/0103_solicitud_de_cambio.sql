-- 0103 · Una solicitud que lleva el cambio dentro.
--
-- ── El hueco ─────────────────────────────────────────────────────────────
--
-- Quien colabora en un evento ve su rol y nada más: ni sus permisos reales, ni
-- cómo figura su nombre en las listas y en la escarapela. Y si algo está mal
-- —el nombre con una letra cambiada, el rol que dice «Logística» cuando lleva
-- sonido— sólo puede escribir una `solicitud` en prosa y esperar.
--
-- Del otro lado, quien organiza lee «por favor cámbienme el rol», abre otra
-- pantalla, busca a la persona y lo cambia a mano. Dos pasos y una
-- transcripción, que es donde se cuela el error.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────
--
-- La solicitud lleva el cambio DENTRO: qué campo, qué dice hoy y qué debería
-- decir. Quien organiza lo aprueba y se aplica solo. Nadie transcribe nada.
--
-- Y sigue siendo una solicitud: **no se aplica al pedirla**. Que el equipo
-- pueda corregir su propia ficha sin que nadie mire es justo lo que no se
-- quiere — un rol es lo que decide qué puede tocar cada uno.
--
-- ── Por qué jsonb y no tres columnas ────────────────────────────────────
--
-- Porque los campos que se van a poder pedir van a crecer —hoy el nombre y el
-- rol; mañana el correo de contacto, la zona asignada— y tres columnas
-- obligan a una migración por cada campo nuevo. Lo que NO va aquí es nada que
-- haya que consultar o cruzar: `cambio` es lo que la solicitud se lee a sí
-- misma cuando alguien la abre.
--
-- La lista de qué campos se aceptan vive en el código (`routes/solicitudes.js`),
-- que es donde se puede comprobar contra quién pide y sobre qué evento. Una
-- restricción en la base no sabe nada de eso.

alter table public.event_requests
  add column if not exists cambio jsonb;

comment on column public.event_requests.cambio is
  'Para las de tipo `cambio`: { campo, valor_actual, valor_propuesto, aplicado_at }. Nulo en las demás.';

-- Las de tipo `cambio` que siguen abiertas son la cola de trabajo de quien
-- organiza. El índice es parcial —sólo esas— porque el resto de solicitudes no
-- se buscan así y un índice que indexa de más se paga en cada escritura.
create index if not exists event_requests_cambio_abierto_idx
  on public.event_requests (evento_id, created_at desc)
  where tipo = 'cambio' and estado = 'abierta';

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select tipo, estado, cambio from public.event_requests order by created_at desc limit 5;
--
-- Las que ya existen (2 filas, `solicitud` y `sugerencia`) se quedan con
-- `cambio` en null, que es lo correcto: no llevaban ninguno.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   drop index if exists public.event_requests_cambio_abierto_idx;
--   alter table public.event_requests drop column if exists cambio;
--
-- Sin pérdida de nada anterior.
