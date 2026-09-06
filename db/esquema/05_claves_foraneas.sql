/* ═══════════════════════════════════════════════════════════════════════════════
 * GESTEK · Volcado de la base de Supabase — 05 · CLAVES FORÁNEAS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generado: 2026-09-04, corriendo db/esquema/generar-esquema.mjs contra Postgres
 *           (proyecto `GestorEventosMarcaBlanca`, yopontbwgdybfsniqawz).
 * Va al FINAL, después de tablas, datos e índices: hay ciclos entre tablas y
 * no existe un orden de creación que las respete todas. NO incluye las claves
 * que en Postgres apuntan a auth.users — quedan como CHAR(36) con índice; ver
 * NOTAS-ESQUEMA.md.
 *
 * Este archivo es la salida del generador. NO se edita a mano: si el esquema
 * de Postgres cambia, se vuelve a correr este script y se compara con
 * `git diff`. El «por qué» de cada traducción está en
 * `db/migraciones/NOTAS-ESQUEMA.md`; el orden de aplicación de los seis
 * archivos, en el README.md de esta carpeta.
 * ═══════════════════════════════════════════════════════════════════════════════ */

SET NAMES utf8mb4;

ALTER TABLE `agenda_favoritos` ADD CONSTRAINT `agenda_favoritos_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `agenda_favoritos` ADD CONSTRAINT `agenda_favoritos_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `agenda_sessions` (`id`) ON DELETE CASCADE;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE CASCADE;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_speaker_id_fkey` FOREIGN KEY (`speaker_id`) REFERENCES `speakers` (`id`) ON DELETE SET NULL;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types` (`id`) ON DELETE SET NULL;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_torneo_id_fkey` FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE SET NULL;
ALTER TABLE `agenda_sessions` ADD CONSTRAINT `agenda_sessions_zona_id_fkey` FOREIGN KEY (`zona_id`) REFERENCES `zonas` (`id`) ON DELETE SET NULL;
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE SET NULL;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE SET NULL;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_organizador_id_fkey` FOREIGN KEY (`organizador_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_recompensa_id_fkey` FOREIGN KEY (`recompensa_id`) REFERENCES `recompensas` (`id`) ON DELETE SET NULL;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `canjes` ADD CONSTRAINT `canjes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `catalogo_roles` ADD CONSTRAINT `catalogo_roles_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_channel_prefs` ADD CONSTRAINT `chat_channel_prefs_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_channel_prefs` ADD CONSTRAINT `chat_channel_prefs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_channels` ADD CONSTRAINT `chat_channels_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `profiles` (`id`);
ALTER TABLE `chat_channels` ADD CONSTRAINT `chat_channels_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_channels` ADD CONSTRAINT `chat_channels_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_borrado_por_fkey` FOREIGN KEY (`borrado_por`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE;
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`);
ALTER TABLE `cobros_vacantes` ADD CONSTRAINT `cobros_vacantes_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE SET NULL;
ALTER TABLE `cobros_vacantes` ADD CONSTRAINT `cobros_vacantes_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `cobros_vacantes` ADD CONSTRAINT `cobros_vacantes_postulacion_id_fkey` FOREIGN KEY (`postulacion_id`) REFERENCES `postulaciones` (`id`) ON DELETE SET NULL;
ALTER TABLE `cobros_vacantes` ADD CONSTRAINT `cobros_vacantes_vacante_id_fkey` FOREIGN KEY (`vacante_id`) REFERENCES `vacantes` (`id`) ON DELETE SET NULL;
ALTER TABLE `discount_codes` ADD CONSTRAINT `discount_codes_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `email_cola` ADD CONSTRAINT `email_cola_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `email_log` ADD CONSTRAINT `email_log_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `email_log` ADD CONSTRAINT `email_log_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `agenda_sessions` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_torneo_id_fkey` FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_members` ADD CONSTRAINT `event_members_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_members` ADD CONSTRAINT `event_members_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `profiles` (`id`);
ALTER TABLE `event_members` ADD CONSTRAINT `event_members_rol_id_fkey` FOREIGN KEY (`rol_id`) REFERENCES `event_roles` (`id`) ON DELETE SET NULL;
ALTER TABLE `event_members` ADD CONSTRAINT `event_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `event_requests` ADD CONSTRAINT `event_requests_autor_id_fkey` FOREIGN KEY (`autor_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `event_requests` ADD CONSTRAINT `event_requests_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_roles` ADD CONSTRAINT `event_roles_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_views` ADD CONSTRAINT `event_views_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_waitlist` ADD CONSTRAINT `event_waitlist_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_waitlist` ADD CONSTRAINT `event_waitlist_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types` (`id`) ON DELETE CASCADE;
ALTER TABLE `event_waitlist` ADD CONSTRAINT `event_waitlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_alertas` ADD CONSTRAINT `evento_alertas_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_alertas` ADD CONSTRAINT `evento_alertas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_anuncios` ADD CONSTRAINT `evento_anuncios_autor_id_fkey` FOREIGN KEY (`autor_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_anuncios` ADD CONSTRAINT `evento_anuncios_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_bolsa_puntos` ADD CONSTRAINT `evento_bolsa_puntos_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_bolsa_puntos` ADD CONSTRAINT `evento_bolsa_puntos_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_email_envios` ADD CONSTRAINT `evento_email_envios_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_email_envios` ADD CONSTRAINT `evento_email_envios_smtp_id_fkey` FOREIGN KEY (`smtp_id`) REFERENCES `evento_smtp` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_email_plantillas` ADD CONSTRAINT `evento_email_plantillas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_email_plantillas` ADD CONSTRAINT `evento_email_plantillas_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_legal` ADD CONSTRAINT `evento_legal_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_legal` ADD CONSTRAINT `evento_legal_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `evento_motivos` ADD CONSTRAINT `evento_motivos_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_motivos` ADD CONSTRAINT `evento_motivos_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE CASCADE;
ALTER TABLE `evento_smtp` ADD CONSTRAINT `evento_smtp_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_categoria_id_fkey` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`);
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `networking_citas` ADD CONSTRAINT `networking_citas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `networking_citas` ADD CONSTRAINT `networking_citas_horario_id_fkey` FOREIGN KEY (`horario_id`) REFERENCES `networking_horarios` (`id`) ON DELETE CASCADE;
ALTER TABLE `networking_expositores` ADD CONSTRAINT `networking_expositores_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `networking_expositores` ADD CONSTRAINT `networking_expositores_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `networking_expositores` ADD CONSTRAINT `networking_expositores_zona_id_fkey` FOREIGN KEY (`zona_id`) REFERENCES `zonas` (`id`) ON DELETE SET NULL;
ALTER TABLE `networking_horarios` ADD CONSTRAINT `networking_horarios_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE CASCADE;
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `oauth_codes` ADD CONSTRAINT `oauth_codes_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients` (`client_id`) ON DELETE CASCADE;
ALTER TABLE `oauth_tokens` ADD CONSTRAINT `oauth_tokens_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients` (`client_id`) ON DELETE CASCADE;
ALTER TABLE `padron_previo` ADD CONSTRAINT `padron_previo_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_promocion_id_fkey` FOREIGN KEY (`promocion_id`) REFERENCES `promociones` (`id`) ON DELETE SET NULL;
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types` (`id`) ON DELETE SET NULL;
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `perfil_talento` ADD CONSTRAINT `perfil_talento_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `points_log` ADD CONSTRAINT `points_log_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE SET NULL;
ALTER TABLE `points_log` ADD CONSTRAINT `points_log_organizador_id_fkey` FOREIGN KEY (`organizador_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `points_log` ADD CONSTRAINT `points_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `postulaciones` ADD CONSTRAINT `postulaciones_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `postulaciones` ADD CONSTRAINT `postulaciones_vacante_id_fkey` FOREIGN KEY (`vacante_id`) REFERENCES `vacantes` (`id`) ON DELETE CASCADE;
ALTER TABLE `promociones` ADD CONSTRAINT `promociones_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `promociones` ADD CONSTRAINT `promociones_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `ticket_types` (`id`) ON DELETE SET NULL;
ALTER TABLE `puntos_balance` ADD CONSTRAINT `puntos_balance_organizador_id_fkey` FOREIGN KEY (`organizador_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `puntos_balance` ADD CONSTRAINT `puntos_balance_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `recompensas` ADD CONSTRAINT `recompensas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `recompensas` ADD CONSTRAINT `recompensas_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE CASCADE;
ALTER TABLE `recompensas` ADD CONSTRAINT `recompensas_organizador_id_fkey` FOREIGN KEY (`organizador_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `sesion_inscripciones` ADD CONSTRAINT `sesion_inscripciones_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `sesion_inscripciones` ADD CONSTRAINT `sesion_inscripciones_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `agenda_sessions` (`id`) ON DELETE CASCADE;
ALTER TABLE `sesion_inscripciones` ADD CONSTRAINT `sesion_inscripciones_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `speakers` ADD CONSTRAINT `speakers_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `sponsors` ADD CONSTRAINT `sponsors_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `sugerencias_catalogo` ADD CONSTRAINT `sugerencias_catalogo_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `sugerencias_dinamica` ADD CONSTRAINT `sugerencias_dinamica_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE SET NULL;
ALTER TABLE `talento_resenas` ADD CONSTRAINT `talento_resenas_de_user_id_fkey` FOREIGN KEY (`de_user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `talento_resenas` ADD CONSTRAINT `talento_resenas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `talento_resenas` ADD CONSTRAINT `talento_resenas_para_user_id_fkey` FOREIGN KEY (`para_user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `talento_resenas` ADD CONSTRAINT `talento_resenas_postulacion_id_fkey` FOREIGN KEY (`postulacion_id`) REFERENCES `postulaciones` (`id`) ON DELETE CASCADE;
ALTER TABLE `talento_resenas` ADD CONSTRAINT `talento_resenas_vacante_id_fkey` FOREIGN KEY (`vacante_id`) REFERENCES `vacantes` (`id`) ON DELETE SET NULL;
ALTER TABLE `tarea_log` ADD CONSTRAINT `tarea_log_tarea_id_fkey` FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE;
ALTER TABLE `tarea_log` ADD CONSTRAINT `tarea_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`);
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_asignado_rol_id_fkey` FOREIGN KEY (`asignado_rol_id`) REFERENCES `event_roles` (`id`) ON DELETE SET NULL;
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_asignado_user_id_fkey` FOREIGN KEY (`asignado_user_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `profiles` (`id`);
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `ticket_interacciones` ADD CONSTRAINT `ticket_interacciones_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `ticket_interacciones` ADD CONSTRAINT `ticket_interacciones_expositor_id_fkey` FOREIGN KEY (`expositor_id`) REFERENCES `networking_expositores` (`id`) ON DELETE SET NULL;
ALTER TABLE `ticket_interacciones` ADD CONSTRAINT `ticket_interacciones_motivo_id_fkey` FOREIGN KEY (`motivo_id`) REFERENCES `evento_motivos` (`id`) ON DELETE SET NULL;
ALTER TABLE `ticket_interacciones` ADD CONSTRAINT `ticket_interacciones_operador_id_fkey` FOREIGN KEY (`operador_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `ticket_interacciones` ADD CONSTRAINT `ticket_interacciones_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE;
ALTER TABLE `ticket_movimientos` ADD CONSTRAINT `ticket_movimientos_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `ticket_movimientos` ADD CONSTRAINT `ticket_movimientos_operador_id_fkey` FOREIGN KEY (`operador_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `ticket_movimientos` ADD CONSTRAINT `ticket_movimientos_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE;
ALTER TABLE `ticket_types` ADD CONSTRAINT `ticket_types_crea_torneo_id_fkey` FOREIGN KEY (`crea_torneo_id`) REFERENCES `torneos` (`id`) ON DELETE SET NULL;
ALTER TABLE `ticket_types` ADD CONSTRAINT `ticket_types_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_discount_fk` FOREIGN KEY (`discount_code_id`) REFERENCES `discount_codes` (`id`) ON DELETE SET NULL;
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_promocion_id_fkey` FOREIGN KEY (`promocion_id`) REFERENCES `promociones` (`id`) ON DELETE SET NULL;
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types` (`id`);
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`);
ALTER TABLE `torneo_categorias` ADD CONSTRAINT `torneo_categorias_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `torneo_categorias` ADD CONSTRAINT `torneo_categorias_padre_id_fkey` FOREIGN KEY (`padre_id`) REFERENCES `torneo_categorias` (`id`) ON DELETE CASCADE;
ALTER TABLE `torneo_equipos` ADD CONSTRAINT `torneo_equipos_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;
ALTER TABLE `torneo_equipos` ADD CONSTRAINT `torneo_equipos_torneo_id_fkey` FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;
ALTER TABLE `torneo_partidos` ADD CONSTRAINT `torneo_partidos_equipo_a_id_fkey` FOREIGN KEY (`equipo_a_id`) REFERENCES `torneo_equipos` (`id`) ON DELETE SET NULL;
ALTER TABLE `torneo_partidos` ADD CONSTRAINT `torneo_partidos_equipo_b_id_fkey` FOREIGN KEY (`equipo_b_id`) REFERENCES `torneo_equipos` (`id`) ON DELETE SET NULL;
ALTER TABLE `torneo_partidos` ADD CONSTRAINT `torneo_partidos_siguiente_partido_id_fkey` FOREIGN KEY (`siguiente_partido_id`) REFERENCES `torneo_partidos` (`id`) ON DELETE SET NULL;
ALTER TABLE `torneo_partidos` ADD CONSTRAINT `torneo_partidos_torneo_id_fkey` FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;
ALTER TABLE `torneos` ADD CONSTRAINT `torneos_categoria_id_fkey` FOREIGN KEY (`categoria_id`) REFERENCES `torneo_categorias` (`id`) ON DELETE SET NULL;
ALTER TABLE `torneos` ADD CONSTRAINT `torneos_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE SET NULL;
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `vacantes` ADD CONSTRAINT `vacantes_event_rol_id_fkey` FOREIGN KEY (`event_rol_id`) REFERENCES `event_roles` (`id`) ON DELETE SET NULL;
ALTER TABLE `vacantes` ADD CONSTRAINT `vacantes_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `vacantes` ADD CONSTRAINT `vacantes_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `vacantes` ADD CONSTRAINT `vacantes_rol_id_fkey` FOREIGN KEY (`rol_id`) REFERENCES `catalogo_roles` (`id`) ON DELETE SET NULL;
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks` (`id`) ON DELETE CASCADE;
ALTER TABLE `webhooks` ADD CONSTRAINT `webhooks_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
ALTER TABLE `zona_cortes` ADD CONSTRAINT `zona_cortes_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;
ALTER TABLE `zona_cortes` ADD CONSTRAINT `zona_cortes_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
ALTER TABLE `zonas` ADD CONSTRAINT `zonas_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;
