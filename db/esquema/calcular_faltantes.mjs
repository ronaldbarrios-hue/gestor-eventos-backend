import fs from 'node:fs';

const existentes = new Set(`agenda_favoritos_evento_id_fkey
agenda_favoritos_session_id_fkey
agenda_sessions_evento_id_fkey
agenda_sessions_expositor_id_fkey
agenda_sessions_speaker_id_fkey
agenda_sessions_ticket_type_id_fkey
agenda_sessions_torneo_id_fkey
agenda_sessions_zona_id_fkey
api_tokens_owner_id_fkey
audit_log_actor_id_fkey
audit_log_evento_id_fkey
canjes_evento_id_fkey
canjes_expositor_id_fkey
canjes_organizador_id_fkey
canjes_recompensa_id_fkey
canjes_ticket_id_fkey
canjes_user_id_fkey
catalogo_roles_owner_id_fkey
chat_channel_prefs_channel_id_fkey
chat_channel_prefs_user_id_fkey
chat_channels_created_by_fkey
chat_channels_evento_id_fkey
chat_channels_parent_id_fkey
chat_messages_borrado_por_fkey
chat_messages_channel_id_fkey
chat_messages_user_id_fkey
cobros_vacantes_evento_id_fkey
cobros_vacantes_owner_id_fkey
cobros_vacantes_postulacion_id_fkey
cobros_vacantes_vacante_id_fkey
discount_codes_evento_id_fkey
email_cola_evento_id_fkey
email_log_evento_id_fkey
email_log_ticket_id_fkey
event_form_fields_evento_id_fkey
event_form_fields_session_id_fkey
event_form_fields_ticket_type_id_fkey
event_form_fields_torneo_id_fkey
event_members_evento_id_fkey
event_members_invited_by_fkey
event_members_rol_id_fkey
event_members_user_id_fkey
event_requests_autor_id_fkey
event_requests_evento_id_fkey
event_roles_evento_id_fkey
event_views_evento_id_fkey
event_waitlist_evento_id_fkey
event_waitlist_ticket_type_id_fkey
event_waitlist_user_id_fkey
evento_alertas_created_by_fkey
evento_alertas_evento_id_fkey
evento_anuncios_autor_id_fkey
evento_anuncios_evento_id_fkey
evento_bolsa_puntos_evento_id_fkey
evento_bolsa_puntos_updated_by_fkey
evento_email_envios_evento_id_fkey
evento_email_envios_smtp_id_fkey
evento_email_plantillas_evento_id_fkey
evento_email_plantillas_updated_by_fkey
evento_legal_evento_id_fkey
evento_legal_updated_by_fkey
evento_motivos_evento_id_fkey
evento_motivos_expositor_id_fkey
evento_smtp_evento_id_fkey
eventos_categoria_id_fkey
eventos_owner_id_fkey
networking_citas_evento_id_fkey
networking_citas_horario_id_fkey
networking_expositores_evento_id_fkey
networking_expositores_ticket_id_fkey
networking_expositores_zona_id_fkey
networking_horarios_expositor_id_fkey
notificaciones_evento_id_fkey
notificaciones_user_id_fkey`.split('\n'));

const ruta = 'db/esquema/05_claves_foraneas.sql';
if (!fs.existsSync(ruta)) {
  console.error(`No encontré ${ruta}. ¿Estás parado en la carpeta correcta del proyecto?`);
  process.exit(1);
}
const lineas = fs.readFileSync(ruta, 'utf8').split('\n').filter(l => l.startsWith('ALTER TABLE'));

const faltantes = lineas.filter(l => {
  const m = l.match(/ADD CONSTRAINT `(\w+)`/);
  return m && !existentes.has(m[1]);
});

fs.writeFileSync('db/esquema/05b_faltantes.sql', 'SET NAMES utf8mb4;\n\n' + faltantes.join('\n') + '\n');

console.log(`Total de claves en tu archivo: ${lineas.length}`);
console.log(`Ya estaban cargadas: ${lineas.length - faltantes.length}`);
console.log(`Faltan (escritas en db/esquema/05b_faltantes.sql): ${faltantes.length}`);
