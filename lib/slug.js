/* Genera slug URL-safe a partir de un texto.
   Ej: "Summit Tech Ibague 2026" -> "summit-tech-ibague-2026" */
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* Genera un slug único en la tabla eventos. Si choca, agrega -2, -3, ... */
async function uniqueEventoSlug(supabase, base) {
  const baseSlug = slugify(base) || 'evento';
  let slug = baseSlug;
  let i = 2;
  for (let n = 0; n < 10; n++) {
    const { data } = await supabase.from('eventos').select('id').eq('slug', slug).maybeSingle();
    if (!data) return slug;
    slug = `${baseSlug}-${i++}`;
  }
  return `${baseSlug}-${Date.now()}`;
}

module.exports = { slugify, uniqueEventoSlug };
