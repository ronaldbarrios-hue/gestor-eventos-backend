'use strict';

/* Todo lo que se puede conceder dentro de un evento, en un solo sitio.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Hasta ahora la única lista completa de permisos que había en el backend era
 * la del rol «Administrador» en `modules/eventos/semillas.js`, escrita a mano.
 * Eso significa que el día que alguien añada el permiso número 22 y proteja
 * una ruta con él:
 *
 *   · el Administrador **no lo tendrá**, porque su lista es literal;
 *   · y nadie se enterará, porque un permiso que falta no da error: da un 403
 *     a alguien que debería poder, en una pantalla que quizá tarda semanas en
 *     abrirse.
 *
 * Con esto, «Administrador» pasa a definirse como *todos* en vez de como una
 * lista, y la prueba `permisosCatalogo.test.js` falla si una ruta comprueba un
 * permiso que aquí no está. El catálogo se refresca porque no compila si no.
 *
 * ── Tiene que decir lo mismo que el panel ────────────────────────────────
 *
 * El frontend tiene su propio catálogo en `src/lib/permisos.js`, con estas
 * mismas veintiuna entradas y sus etiquetas — lo necesita para pintar las
 * casillas al crear un rol. Son dos repositorios y no hay forma de compartir
 * un archivo, así que **el orden y los ids se mantienen a mano y a propósito
 * idénticos**: si divergen, el panel ofrece un permiso que el servidor no
 * comprueba, o al revés.
 *
 * Lo que NO se duplica es la decisión: quien manda es el servidor. El panel
 * dibuja; aquí se concede.
 */

/* `grupo` y `label` viajan para que el panel pueda pedir el catálogo al
   servidor el día que se quiera dejar de mantener las dos copias. Hoy no lo
   pide: está aquí para que la lista sea la misma cosa y no dos parecidas. */
const CATALOGO = [
  { id: 'editar_evento',         grupo: 'Evento',    label: 'Editar evento' },
  { id: 'publicar_evento',       grupo: 'Evento',    label: 'Publicar / cancelar' },
  { id: 'editar_pagina_publica', grupo: 'Evento',    label: 'Editar página pública' },
  { id: 'gestionar_imagenes',    grupo: 'Evento',    label: 'Imágenes y galería' },

  { id: 'gestionar_agenda',      grupo: 'Espacio',   label: 'Gestionar el espacio' },
  { id: 'gestionar_torneo',      grupo: 'Espacio',   label: 'Gestionar torneos' },
  { id: 'gestionar_expositores', grupo: 'Espacio',   label: 'Gestionar expositores' },
  /* Configurar por dónde se entra. Era del dueño y de nadie más, y eso deja a
     quien organiza como el único que puede decir que la puerta 3 admite
     prensa — una tarea de logística que hace otra persona. */
  { id: 'gestionar_accesos',     grupo: 'Espacio',   label: 'Configurar accesos e ingresos' },

  { id: 'invitar_staff',         grupo: 'Equipo',    label: 'Invitar al equipo' },
  { id: 'gestionar_roles',       grupo: 'Equipo',    label: 'Gestionar roles' },
  { id: 'remover_miembros',      grupo: 'Equipo',    label: 'Quitar miembros' },
  /* Atender lo que el equipo manda: sugerencias, incidencias y las peticiones
     de corregir la propia ficha. Iba pegado a «ser el dueño», y eso deja al
     organizador de un evento de siete mil personas como el único que puede
     aprobar que a alguien le cambien una letra del nombre en la escarapela. */
  { id: 'gestionar_solicitudes', grupo: 'Equipo',    label: 'Atender solicitudes del equipo' },
  /* Repartir el trabajo del evento: crear tareas, asignarlas y moverlas.
     Hasta ahora esto no era un permiso — era `owner_id`, comprobado dentro del
     handler con un «Solo el organizador puede crear tareas». O sea que quien
     lleva la logística podía ver el tablero y no poner nada en él. */
  { id: 'gestionar_tareas',      grupo: 'Equipo',    label: 'Asignar tareas' },
  /* VER los documentos del evento: contratos, riders, listas.
   *
   * De lectura y no de escritura, porque escribirlos ya tenía dueño: viven en
   * `page_json`, que sólo puede tocar quien tiene `editar_pagina_publica`. Lo
   * que no tenía dueño era MIRARLOS — cualquier miembro del equipo los veía, y
   * con un contrato dentro eso no es una decisión, es un descuido.
   *
   * Y se aplica de verdad: sin este permiso, `page_json.documentos` ni siquiera
   * viaja en la respuesta del evento. Esconder la pestaña y seguir mandando los
   * archivos sería teatro. */
  { id: 'ver_documentos',        grupo: 'Equipo',    label: 'Ver documentos del evento' },

  { id: 'gestionar_tickets',     grupo: 'Tickets',   label: 'Gestionar tipos de boleta' },
  { id: 'gestionar_descuentos',  grupo: 'Tickets',   label: 'Códigos de descuento' },

  { id: 'ver_clientes',          grupo: 'Clientes',  label: 'Ver lista de clientes' },
  { id: 'gestionar_clientes',    grupo: 'Clientes',  label: 'Editar clientes' },
  { id: 'checkin',               grupo: 'Clientes',  label: 'Hacer check-in' },
  { id: 'vip_zone',              grupo: 'Clientes',  label: 'Atender cualquier puerta' },
  /* BORRAR una boleta, que no es lo mismo que anularla.
   *
   * Anular deja la fila: la persona sigue en la lista, marcada como inválida, y
   * eso es lo correcto casi siempre — hay un rastro de que existió.
   *
   * Borrar es para lo que NO DEBIÓ EXISTIR: los duplicados que deja un fallo,
   * las pruebas del montaje. Es irreversible y se lleva por delante las
   * respuestas del formulario, así que va aparte de `gestionar_clientes`: quien
   * atiende asistentes reenvía boletas y corrige datos todo el día, y no tiene
   * por qué poder borrar de paso. */
  { id: 'borrar_boletas',        grupo: 'Clientes',  label: 'Borrar boletas' },

  { id: 'crear_canales',         grupo: 'Chat',      label: 'Crear canales' },
  { id: 'borrar_mensajes',       grupo: 'Chat',      label: 'Moderar mensajes' },
  /* Escribirle a todo el evento. Era del dueño, y quien lleva la comunicación
     de un festival no suele ser quien creó el evento en la plataforma. */
  { id: 'publicar_anuncios',     grupo: 'Chat',      label: 'Publicar anuncios' },

  { id: 'ver_pagos',             grupo: 'Pagos',     label: 'Ver pagos e ingresos' },
  { id: 'reembolsar',            grupo: 'Pagos',     label: 'Registrar reembolsos' },

  { id: 'ver_analytics',         grupo: 'Analytics', label: 'Ver analytics' },
];

/* Todos los ids. Es lo que hace que «Administrador» signifique «todo» y no
   «estos veintiuno que alguien escribió un martes». */
const TODOS = CATALOGO.map((p) => p.id);

/* Lo que NO se concede nunca por rol, y por eso no está en el catálogo:
 * transferir el evento y borrarlo. Son del dueño y de nadie más — un
 * administrador que pueda regalarle el evento a otro no es un administrador,
 * es un dueño. Queda escrito aquí para que la ausencia se lea como una
 * decisión y no como un olvido. */
const SOLO_DUENO = ['transferir_evento', 'borrar_evento'];

const existe = (id) => TODOS.includes(id);

module.exports = { CATALOGO, TODOS, SOLO_DUENO, existe };
