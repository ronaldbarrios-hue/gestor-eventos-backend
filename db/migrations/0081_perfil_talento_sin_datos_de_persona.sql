-- 0081 · perfil_talento deja de tener foto, teléfono y ciudad.
-- PENDIENTE DE APLICAR.
--
-- Por qué: los mismos tres datos se editaban en dos sitios que no se hablan —
-- los metadatos del perfil general (Ajustes → Mi Perfil, vía auth.updateUser
-- + profiles) y el perfil de talento (Mi Espacio). Cambiar la foto en uno no
-- cambiaba el otro, y no había forma de saber cuál era el bueno. La decisión
-- (ver CONTINUAR.md §3.7 del frontend) es una identidad con varias facetas:
-- nombre, foto, teléfono y ciudad son de la PERSONA y viven en un solo sitio
-- —`profiles`—; cada faceta se queda solo con lo que es suyo. Para talento
-- eso es titular, bio, habilidades, hoja de vida y portafolio.
--
-- Comprobado contra producción antes de escribir esto: `perfil_talento` tiene
-- 0 filas. No hay ningún dato real que se pierda ni que reconciliar.
--
-- El código que ya no lee estas columnas va en el mismo commit que esta
-- migración (routes/vacantes.js: la postulación toma la foto y la ciudad de
-- `profiles` al congelar el snapshot, no de aquí).

begin;

alter table public.perfil_talento drop column if exists foto_url;
alter table public.perfil_talento drop column if exists telefono;
alter table public.perfil_talento drop column if exists ciudad;

commit;
