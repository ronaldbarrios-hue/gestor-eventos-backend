/* ═══════════════════════════════════════════════════════════════════════════
 * GESTEK · Volcado de la base de Supabase — 04 · ÍNDICES (no parciales)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Salida del generador (sección 4). Se aplica DESPUÉS de cargar los datos
 * (03_datos.sql): insertar con los índices puestos es varias veces más lento.
 *
 * Las PRIMARY KEY ya van en 01_tablas.sql. Aquí van el resto.
 *
 * Los 8 índices ÚNICOS PARCIALES NO están aquí — van en
 * 02_indices_unicos_parciales.sql, escritos a mano uno por uno, porque quitar
 * la condición WHERE convierte un índice que permitía repetidos en uno que los
 * prohíbe. Las líneas «-- A MANO» de abajo son el recordatorio de cuáles son.
 *
 * `chat_channels_rol_ids_idx` era un índice GIN sobre un arreglo en Postgres;
 * en MySQL pasa a índice multivalor (8.0.17+).
 * ═══════════════════════════════════════════════════════════════════════════ */

SET NAMES utf8mb4;

CREATE UNIQUE INDEX `agenda_favoritos_session_id_user_id_key` ON `agenda_favoritos` (`session_id`, `user_id`);
CREATE INDEX `agenda_evento_idx` ON `agenda_sessions` (`evento_id`);
CREATE INDEX `agenda_sessions_zona_idx` ON `agenda_sessions` (`evento_id`, `zona_id`);
CREATE INDEX `idx_agenda_expositor` ON `agenda_sessions` (`expositor_id`);
CREATE INDEX `idx_agenda_sessions_subcategoria` ON `agenda_sessions` (`evento_id`, `subcategoria`);  -- era parcial: WHERE (subcategoria IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_agenda_sessions_tipo` ON `agenda_sessions` (`evento_id`, `tipo`);
CREATE INDEX `idx_agenda_sessions_torneo_id` ON `agenda_sessions` (`torneo_id`);
CREATE UNIQUE INDEX `api_tokens_hash_idx` ON `api_tokens` (`token_hash`);
CREATE INDEX `api_tokens_owner_idx` ON `api_tokens` (`owner_id`);
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_id`);  -- era parcial: WHERE (actor_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `audit_log_evento_idx` ON `audit_log` (`evento_id`, `created_at`);
CREATE UNIQUE INDEX `canjes_codigo_idx` ON `canjes` (`codigo`);
CREATE INDEX `canjes_org_idx` ON `canjes` (`organizador_id`, `created_at`);
CREATE INDEX `canjes_user_idx` ON `canjes` (`user_id`, `created_at`);
CREATE INDEX `idx_canjes_evento` ON `canjes` (`evento_id`);
CREATE INDEX `idx_canjes_expositor` ON `canjes` (`ticket_id`, `expositor_id`);
CREATE INDEX `idx_canjes_ticket` ON `canjes` (`ticket_id`);
-- A MANO (unico parcial): catalogo_roles_slug_global_uidx -- CREATE UNIQUE INDEX catalogo_roles_slug_global_uidx ON public.catalogo_roles USING btree (slug) WHERE (global = true)
CREATE UNIQUE INDEX `categorias_slug_key` ON `categorias` (`slug`);
CREATE INDEX `chat_channel_prefs_user_idx` ON `chat_channel_prefs` (`user_id`);  -- era parcial: WHERE (archivado = false) (no unico: la condicion se puede tirar)
-- A MANO (unico parcial): chat_channels_dm_uidx -- CREATE UNIQUE INDEX chat_channels_dm_uidx ON public.chat_channels USING btree (evento_id, dm_key) WHERE (dm_key IS NOT NULL)
CREATE INDEX `chat_channels_parent_idx` ON `chat_channels` (`parent_id`);
CREATE INDEX `chat_channels_rol_ids_idx` ON `chat_channels` ((CAST(`rol_ids` AS CHAR(36) ARRAY)));  -- era GIN sobre un arreglo
CREATE INDEX `chat_messages_canal_vivos_idx` ON `chat_messages` (`channel_id`, `created_at`);  -- era parcial: WHERE (borrado_at IS NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `chat_messages_channel_idx` ON `chat_messages` (`channel_id`, `created_at`);
CREATE INDEX `cobros_vacantes_owner_idx` ON `cobros_vacantes` (`owner_id`);
CREATE UNIQUE INDEX `discount_codes_evento_id_codigo_key` ON `discount_codes` (`evento_id`, `codigo`);
CREATE INDEX `idx_email_cola_evento` ON `email_cola` (`evento_id`, `created_at`);
CREATE INDEX `idx_email_cola_pendientes` ON `email_cola` (`prioridad`, `proximo_intento`);  -- era parcial: WHERE (estado = 'pendiente'::text) (no unico: la condicion se puede tirar)
CREATE INDEX `email_log_evento_idx` ON `email_log` (`evento_id`, `created_at`);
CREATE UNIQUE INDEX `email_log_unique` ON `email_log` (`ticket_id`, `tipo`);
CREATE INDEX `event_form_fields_session_idx` ON `event_form_fields` (`session_id`);  -- era parcial: WHERE (session_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_event_form_fields_evento` ON `event_form_fields` (`evento_id`);
CREATE INDEX `idx_form_fields_ticket_type` ON `event_form_fields` (`ticket_type_id`);
CREATE INDEX `event_members_email_idx` ON `event_members` ((lower(`email`)));
CREATE UNIQUE INDEX `event_members_evento_id_email_key` ON `event_members` (`evento_id`, `email`);
CREATE INDEX `event_members_evento_idx` ON `event_members` (`evento_id`);
CREATE INDEX `event_members_evento_user_idx` ON `event_members` (`evento_id`, `user_id`);  -- era parcial: WHERE (status = 'active'::text) (no unico: la condicion se puede tirar)
CREATE INDEX `event_members_user_idx` ON `event_members` (`user_id`);  -- era parcial: WHERE (user_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `event_requests_autor_idx` ON `event_requests` (`autor_id`);
CREATE INDEX `event_requests_estado_idx` ON `event_requests` (`evento_id`);  -- era parcial: WHERE (estado <> 'resuelta'::text) (no unico: la condicion se puede tirar)
CREATE INDEX `event_requests_evento_idx` ON `event_requests` (`evento_id`, `created_at`);
CREATE UNIQUE INDEX `event_roles_evento_id_nombre_key` ON `event_roles` (`evento_id`, `nombre`);
CREATE INDEX `event_roles_evento_idx` ON `event_roles` (`evento_id`);
CREATE INDEX `event_views_evento_idx` ON `event_views` (`evento_id`, `created_at`);
CREATE INDEX `event_views_visitor_idx` ON `event_views` (`evento_id`, `visitor_hash`, `created_at`);
CREATE UNIQUE INDEX `event_waitlist_evento_id_ticket_type_id_guest_email_key` ON `event_waitlist` (`evento_id`, `ticket_type_id`, `guest_email`);
CREATE INDEX `waitlist_estado_idx` ON `event_waitlist` (`estado`);
CREATE INDEX `waitlist_oferta_expira_idx` ON `event_waitlist` (`oferta_expira`);  -- era parcial: WHERE (oferta_expira IS NOT NULL) (no unico: la condicion se puede tirar)
-- A MANO (unico parcial): waitlist_oferta_token_uidx -- CREATE UNIQUE INDEX waitlist_oferta_token_uidx ON public.event_waitlist USING btree (oferta_token) WHERE (oferta_token IS NOT NULL)
CREATE INDEX `waitlist_posicion_idx` ON `event_waitlist` (`evento_id`, `ticket_type_id`, `posicion`);
CREATE INDEX `waitlist_tipo_idx` ON `event_waitlist` (`ticket_type_id`);
CREATE INDEX `evento_alertas_evento_idx` ON `evento_alertas` (`evento_id`, `resuelta`);
CREATE INDEX `evento_anuncios_idx` ON `evento_anuncios` (`evento_id`, `created_at`);
CREATE INDEX `evento_email_envios_evento_idx` ON `evento_email_envios` (`evento_id`, `created_at`);
CREATE INDEX `evento_email_envios_fallidos_idx` ON `evento_email_envios` (`evento_id`);  -- era parcial: WHERE (ok = false) (no unico: la condicion se puede tirar)
CREATE INDEX `evento_email_envios_por_smtp` ON `evento_email_envios` (`smtp_id`, `created_at`);
CREATE UNIQUE INDEX `evento_email_plantillas_evento_id_tipo_key` ON `evento_email_plantillas` (`evento_id`, `tipo`);
CREATE INDEX `evento_email_plantillas_evento_idx` ON `evento_email_plantillas` (`evento_id`);
CREATE INDEX `idx_motivos_evento` ON `evento_motivos` (`evento_id`, `orden`);
CREATE INDEX `idx_motivos_expositor` ON `evento_motivos` (`expositor_id`);
CREATE INDEX `evento_smtp_por_evento` ON `evento_smtp` (`evento_id`, `orden`);
CREATE UNIQUE INDEX `evento_smtp_unico` ON `evento_smtp` (`evento_id`, `host`, `usuario`);
CREATE INDEX `eventos_categoria_idx` ON `eventos` (`categoria_id`);
CREATE INDEX `eventos_estado_idx` ON `eventos` (`estado`);  -- era parcial: WHERE (deleted_at IS NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `eventos_fecha_idx` ON `eventos` (`fecha_inicio`);
CREATE INDEX `eventos_owner_idx` ON `eventos` (`owner_id`);
CREATE UNIQUE INDEX `eventos_slug_key` ON `eventos` (`slug`);
CREATE UNIQUE INDEX `networking_citas_horario_id_key` ON `networking_citas` (`horario_id`);
CREATE INDEX `idx_expositores_evento_activo` ON `networking_expositores` (`evento_id`, `activo`);
CREATE UNIQUE INDEX `networking_expositores_ticket_id_key` ON `networking_expositores` (`ticket_id`);
CREATE INDEX `notif_user_idx` ON `notificaciones` (`user_id`, `leida`, `created_at`);
CREATE INDEX `notif_user_unread_idx` ON `notificaciones` (`user_id`);  -- era parcial: WHERE (leida = false) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_oauth_codes_expira` ON `oauth_codes` (`expira_at`);
CREATE INDEX `idx_oauth_tokens_expira` ON `oauth_tokens` (`expira_at`);  -- era parcial: WHERE (NOT revocado) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_oauth_tokens_owner` ON `oauth_tokens` (`owner_id`, `revocado`);
CREATE UNIQUE INDEX `oauth_tokens_refresh_hash_key` ON `oauth_tokens` (`refresh_hash`);
CREATE UNIQUE INDEX `oauth_tokens_token_hash_key` ON `oauth_tokens` (`token_hash`);
CREATE UNIQUE INDEX `padron_previo_unico` ON `padron_previo` (`evento_id`, `documento_hash`);
CREATE INDEX `payment_transactions_referencia_idx` ON `payment_transactions` (`referencia`);
CREATE INDEX `payment_tx_evento_idx` ON `payment_transactions` (`evento_id`);
CREATE INDEX `payment_tx_payment_idx` ON `payment_transactions` (`payment_id`);
CREATE INDEX `payment_tx_preference_idx` ON `payment_transactions` (`preference_id`);
CREATE INDEX `payment_tx_user_idx` ON `payment_transactions` (`user_id`);  -- era parcial: WHERE (user_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `perfil_talento_ciudad_idx` ON `perfil_talento` (`ciudad`);
CREATE INDEX `perfil_talento_publicado_idx` ON `perfil_talento` (`publicado`);  -- era parcial: WHERE (publicado = true) (no unico: la condicion se puede tirar)
CREATE UNIQUE INDEX `perfil_talento_user_id_key` ON `perfil_talento` (`user_id`);
CREATE INDEX `idx_points_log_origen` ON `points_log` (`origen_tipo`, `origen_id`);  -- era parcial: WHERE (origen_tipo IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_points_log_usuario_evento` ON `points_log` (`user_id`, `evento_id`, `created_at`);
CREATE INDEX `points_log_evento_aud_idx` ON `points_log` (`evento_id`, `audiencia`);  -- era parcial: WHERE (evento_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `points_log_org_aud_idx` ON `points_log` (`organizador_id`, `audiencia`, `user_id`);
CREATE INDEX `postulaciones_user_idx` ON `postulaciones` (`user_id`);
CREATE UNIQUE INDEX `postulaciones_vacante_id_user_id_key` ON `postulaciones` (`vacante_id`, `user_id`);
CREATE INDEX `postulaciones_vacante_idx` ON `postulaciones` (`vacante_id`);
CREATE UNIQUE INDEX `profiles_email_key` ON `profiles` (`email`);
CREATE INDEX `profiles_handle_idx` ON `profiles` (`handle`);
CREATE UNIQUE INDEX `profiles_handle_key` ON `profiles` (`handle`);
CREATE INDEX `profiles_puntos_idx` ON `profiles` (`puntos_total`);  -- era parcial: WHERE (puntos_total > 0) (no unico: la condicion se puede tirar)
CREATE UNIQUE INDEX `promociones_evento_id_codigo_key` ON `promociones` (`evento_id`, `codigo`);
CREATE INDEX `promociones_evento_idx` ON `promociones` (`evento_id`);
CREATE INDEX `puntos_balance_rank_idx` ON `puntos_balance` (`organizador_id`, `audiencia`, `puntos`);
CREATE UNIQUE INDEX `puntos_balance_user_id_organizador_id_audiencia_key` ON `puntos_balance` (`user_id`, `organizador_id`, `audiencia`);
CREATE UNIQUE INDEX `push_subs_endpoint_idx` ON `push_subscriptions` (`endpoint`);
CREATE INDEX `push_subs_user_idx` ON `push_subscriptions` (`user_id`);
CREATE INDEX `idx_recompensas_evento` ON `recompensas` (`evento_id`);
CREATE INDEX `idx_recompensas_expositor` ON `recompensas` (`expositor_id`);
CREATE INDEX `recompensas_org_idx` ON `recompensas` (`organizador_id`, `audiencia`, `activo`);
CREATE INDEX `rec_inapp_log_evento_idx` ON `recordatorio_inapp_log` (`evento_id`);
CREATE UNIQUE INDEX `recordatorio_inapp_log_scope_id_evento_id_tipo_key` ON `recordatorio_inapp_log` (`scope_id`, `evento_id`, `tipo`);
CREATE UNIQUE INDEX `referral_codes_codigo_key` ON `referral_codes` (`codigo`);
-- A MANO (unico parcial): sesion_inscripciones_email_uidx -- CREATE UNIQUE INDEX sesion_inscripciones_email_uidx ON public.sesion_inscripciones USING btree (session_id, lower(email)) WHERE ((ticket_id IS NULL) AND (email IS NOT NULL))
CREATE INDEX `sesion_inscripciones_evento_idx` ON `sesion_inscripciones` (`evento_id`, `session_id`);
CREATE INDEX `sesion_inscripciones_sesion_idx` ON `sesion_inscripciones` (`session_id`, `estado`);
-- A MANO (unico parcial): sesion_inscripciones_ticket_uidx -- CREATE UNIQUE INDEX sesion_inscripciones_ticket_uidx ON public.sesion_inscripciones USING btree (session_id, ticket_id) WHERE (ticket_id IS NOT NULL)
CREATE INDEX `speakers_evento_idx` ON `speakers` (`evento_id`);
CREATE INDEX `sugerencias_catalogo_idx` ON `sugerencias_catalogo` (`catalogo`, `estado`, `created_at`);
CREATE INDEX `sugerencias_catalogo_user_idx` ON `sugerencias_catalogo` (`user_id`);  -- era parcial: WHERE (user_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `idx_sugerencias_estado` ON `sugerencias_dinamica` (`estado`, `created_at`);
CREATE INDEX `idx_sugerencias_owner` ON `sugerencias_dinamica` (`owner_id`, `created_at`);
CREATE INDEX `talento_resenas_para_idx` ON `talento_resenas` (`para_user_id`);
CREATE UNIQUE INDEX `talento_resenas_postulacion_id_de_user_id_key` ON `talento_resenas` (`postulacion_id`, `de_user_id`);
CREATE INDEX `tarea_log_tarea_idx` ON `tarea_log` (`tarea_id`, `created_at`);
CREATE INDEX `tareas_asignado_rol_idx` ON `tareas` (`asignado_rol_id`);  -- era parcial: WHERE (asignado_rol_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `tareas_asignado_user_idx` ON `tareas` (`asignado_user_id`);  -- era parcial: WHERE (asignado_user_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE INDEX `tareas_estado_idx` ON `tareas` (`estado`);
CREATE INDEX `tareas_evento_idx` ON `tareas` (`evento_id`);
CREATE INDEX `idx_interacciones_evento` ON `ticket_interacciones` (`evento_id`, `created_at`);
CREATE INDEX `idx_interacciones_expositor` ON `ticket_interacciones` (`expositor_id`, `ticket_id`);
CREATE INDEX `idx_interacciones_ticket` ON `ticket_interacciones` (`ticket_id`, `created_at`);
CREATE INDEX `ticket_movimientos_evento_idx` ON `ticket_movimientos` (`evento_id`);
CREATE INDEX `ticket_movimientos_ticket_idx` ON `ticket_movimientos` (`ticket_id`);
CREATE INDEX `ticket_movimientos_zona_id_idx` ON `ticket_movimientos` (`evento_id`, `zona_id`, `created_at`);
CREATE INDEX `ticket_movimientos_zona_idx` ON `ticket_movimientos` (`evento_id`, `zona`);
CREATE INDEX `ticket_types_evento_idx` ON `ticket_types` (`evento_id`);
CREATE INDEX `idx_tickets_legal_version` ON `tickets` (`evento_id`, `legal_version`);  -- era parcial: WHERE (legal_version IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE UNIQUE INDEX `tickets_codigo_key` ON `tickets` (`codigo`);
CREATE INDEX `tickets_estado_idx` ON `tickets` (`estado`);
CREATE INDEX `tickets_evento_idx` ON `tickets` (`evento_id`);
CREATE INDEX `tickets_evento_user_estado_idx` ON `tickets` (`evento_id`, `user_id`, `estado`);
CREATE UNIQUE INDEX `tickets_qr_token_key` ON `tickets` (`qr_token`);
CREATE INDEX `tickets_user_idx` ON `tickets` (`user_id`);
CREATE INDEX `torneo_categorias_evento_idx` ON `torneo_categorias` (`evento_id`, `orden`);
CREATE INDEX `torneo_categorias_padre_idx` ON `torneo_categorias` (`padre_id`);  -- era parcial: WHERE (padre_id IS NOT NULL) (no unico: la condicion se puede tirar)
-- A MANO (unico parcial): torneo_categorias_unica_hija -- CREATE UNIQUE INDEX torneo_categorias_unica_hija ON public.torneo_categorias USING btree (evento_id, padre_id, lower(nombre)) WHERE (padre_id IS NOT NULL)
-- A MANO (unico parcial): torneo_categorias_unica_raiz -- CREATE UNIQUE INDEX torneo_categorias_unica_raiz ON public.torneo_categorias USING btree (evento_id, lower(nombre)) WHERE (padre_id IS NULL)
CREATE INDEX `idx_torneos_evento_orden` ON `torneos` (`evento_id`, `orden`);
CREATE INDEX `torneos_categoria_idx` ON `torneos` (`categoria_id`);  -- era parcial: WHERE (categoria_id IS NOT NULL) (no unico: la condicion se puede tirar)
CREATE UNIQUE INDEX `user_badges_user_id_badge_slug_evento_id_key` ON `user_badges` (`user_id`, `badge_slug`, `evento_id`);
CREATE INDEX `user_badges_user_idx` ON `user_badges` (`user_id`);
CREATE INDEX `vacantes_ciudad_idx` ON `vacantes` (`ciudad`);
CREATE INDEX `vacantes_estado_idx` ON `vacantes` (`estado`);
CREATE INDEX `vacantes_evento_idx` ON `vacantes` (`evento_id`);
CREATE INDEX `waitlist_evento_idx` ON `waitlist` (`evento_id`, `estado`, `created_at`);
-- A MANO (unico parcial): waitlist_uniq_email -- CREATE UNIQUE INDEX waitlist_uniq_email ON public.waitlist USING btree (evento_id, ticket_type_id, lower(guest_email)) WHERE (estado = ANY (ARRAY['esperando'::text, 'promovido'::text]))
CREATE INDEX `wh_deliveries_idx` ON `webhook_deliveries` (`webhook_id`, `created_at`);
CREATE INDEX `webhooks_owner_idx` ON `webhooks` (`owner_id`, `activo`);
CREATE INDEX `zona_cortes_evento_idx` ON `zona_cortes` (`evento_id`, `zona_id`, `created_at`);
