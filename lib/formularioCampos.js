/* GESTEK — Tipos de campo del formulario y fichas prearmadas.

   Una sola lista, en el servidor, que se le entrega al frontend. La lección
   viene de los correos: allí el panel editaba cinco tipos que el backend no
   conocía, y se diseñaban plantillas que nunca salían. Con los campos del
   formulario pasa lo mismo si cada lado mantiene su copia.

   Aquí vive además la validación por tipo. Antes solo se comprobaba que un
   campo obligatorio no llegara vacío: un campo de correo aceptaba "hola", uno
   de número aceptaba letras, y una selección aceptaba cualquier texto aunque no
   estuviera entre sus opciones. Eso ensucia los datos justo donde más duele,
   que es cuando hay que reportar. */

/* ── Tipos de campo ───────────────────────────────────────────────────
   `multiple` guarda un array; el resto, un valor suelto. */
const TIPOS_CAMPO = [
  { id: 'texto',     label: 'Texto corto',                   valor: 'texto' },
  { id: 'parrafo',   label: 'Texto largo (varias líneas)',   valor: 'texto' },
  { id: 'numero',    label: 'Número',                         valor: 'numero' },
  { id: 'fecha',     label: 'Fecha',                          valor: 'fecha' },
  { id: 'email',     label: 'Correo electrónico',             valor: 'texto' },
  { id: 'telefono',  label: 'Teléfono',                       valor: 'texto' },
  { id: 'documento', label: 'Número de documento',            valor: 'texto' },
  { id: 'seleccion', label: 'Selección (una opción)',         valor: 'texto',  conOpciones: true },
  { id: 'multiple',  label: 'Selección múltiple (varias)',    valor: 'lista',  conOpciones: true },
  { id: 'checkbox',  label: 'Casilla (sí / no)',              valor: 'booleano' },
  { id: 'foto',      label: 'Foto (la persona sube una imagen)', valor: 'texto' },
];

const IDS_TIPOS_CAMPO = TIPOS_CAMPO.map(t => t.id);
const TIPO_POR_ID = new Map(TIPOS_CAMPO.map(t => [t.id, t]));
const CON_OPCIONES = new Set(TIPOS_CAMPO.filter(t => t.conOpciones).map(t => t.id));

/* ── Listas largas ────────────────────────────────────────────────────
   Un desplegable con los 300 barrios de una ciudad es inservible: hay que
   recorrerlo entero para encontrar el propio. Y como casilla de selección
   múltiple es peor todavía.

   La solución NO es un tipo de campo nuevo. Un barrio sigue siendo una
   selección; lo único que cambia es cómo se pinta. Un tipo aparte obligaría al
   organizador a elegir entre «selección» y «búsqueda» sin saber por qué, y
   duplicaría la validación —que sigue siendo la misma: el valor tiene que
   estar entre las opciones—.

   Así que se decide solo: por encima de este umbral, el campo se pinta con
   buscador. Quien quiera forzarlo pone `buscable: true` o `false` en el campo,
   y su decisión manda. El umbral vive aquí, en el catálogo que ya viaja al
   frontend, para que los dos lados no acaben con copias distintas. */
const UMBRAL_BUSCABLE = 8;

/* `buscable` es opcional a propósito: null significa «decide tú por el
   tamaño». Sólo un booleano explícito anula el automático. */
function esBuscable(campo) {
  if (!campo || !CON_OPCIONES.has(campo.tipo)) return false;
  if (typeof campo.buscable === 'boolean') return campo.buscable;
  return (campo.opciones?.length || 0) > UMBRAL_BUSCABLE;
}


/* -- La plantilla de importacion ---------------------------------------

   Hasta ahora el importador aceptaba CUALQUIER hoja y adivinaba las columnas
   por sinonimos: "pregunta", "enunciado", "campo", "nombre"... Era comodo de
   vender y malo de usar. Adivinar falla en silencio: una columna llamada
   "Tipo" que contiene el tipo de BOLETA se interpreta como tipo de pregunta,
   y nadie lo nota hasta que el formulario sale mal en la pagina publica.

   Se invierte a proposito: hay UNA plantilla y la hoja se adapta a ella. El
   evento se adapta a la plataforma, no al reves. A cambio, el error deja de
   ser "no encontre la columna" y pasa a ser "falta la columna Pregunta".

   -- Por que DOS columnas de tipo ---------------------------------------
   Porque son dos preguntas distintas que en el catalogo interno viven juntas:

     - Tipo de pregunta -> COMO se pide (una linea, parrafo, elegir, marcar...)
     - Tipo de dato     -> QUE tiene que ser (correo, telefono, documento...)

   Separarlas hace visible la verificacion, que es justo lo que se pedia: en la
   hoja se ve que "Correo del asistente" es texto corto Y tiene que ser un
   correo. Con una sola columna habria que saberse que el tipo se llama
   `email`, y quien llena la plantilla no tiene por que. */

const TIPOS_PREGUNTA = [
  { id: 'texto_corto', titulo: 'Texto corto',            tipo: 'texto' },
  { id: 'texto_largo', titulo: 'Texto largo',            tipo: 'parrafo' },
  { id: 'una',         titulo: 'Elegir una opcion',      tipo: 'seleccion', exigeOpciones: true },
  { id: 'varias',      titulo: 'Elegir varias opciones', tipo: 'multiple',  exigeOpciones: true },
  { id: 'casilla',     titulo: 'Casilla si/no',          tipo: 'checkbox' },
  { id: 'fecha',       titulo: 'Fecha',                  tipo: 'fecha' },
  { id: 'numero',      titulo: 'Numero',                 tipo: 'numero' },
  { id: 'foto',        titulo: 'Foto o imagen',          tipo: 'foto' },
];

/* El tipo de dato solo MANDA cuando aporta una verificacion que el tipo de
   pregunta no tiene. "Correo" convierte un texto corto en un campo que exige
   arroba; "Texto" no cambia nada. */
const TIPOS_DATO = [
  { id: 'texto',     titulo: 'Texto',              tipo: null },
  { id: 'correo',    titulo: 'Correo electronico', tipo: 'email' },
  { id: 'telefono',  titulo: 'Telefono',           tipo: 'telefono' },
  { id: 'documento', titulo: 'Documento',          tipo: 'documento' },
  { id: 'numero',    titulo: 'Numero',             tipo: 'numero' },
  { id: 'fecha',     titulo: 'Fecha',              tipo: 'fecha' },
  { id: 'si_no',     titulo: 'Si / No',            tipo: 'checkbox' },
];

const COLUMNAS_PLANTILLA = [
  { id: 'orden',         titulo: 'Orden',            obligatoria: false, ayuda: 'En que posicion se pregunta. Vacio = el orden de las filas.' },
  { id: 'pregunta',      titulo: 'Pregunta',         obligatoria: true,  ayuda: 'El enunciado tal cual lo va a leer el asistente.' },
  { id: 'tipo_pregunta', titulo: 'Tipo de pregunta', obligatoria: true,  ayuda: 'Como se responde.' },
  { id: 'tipo_dato',     titulo: 'Tipo de dato',     obligatoria: false, ayuda: 'Que se verifica. Vacio o "Texto" = sin verificacion extra.' },
  { id: 'opciones',      titulo: 'Opciones',         obligatoria: false, ayuda: 'Separadas por punto y coma. Obligatorio para elegir una o varias.' },
  /* Vacio = SI, y no al reves: quien escribe una pregunta en la hoja la
     escribe porque la necesita. Con el criterio anterior una hoja sin esta
     columna llenada dejaba todas las preguntas opcionales. */
  { id: 'obligatoria',   titulo: 'Obligatoria',      obligatoria: false, ayuda: 'Si o No. Vacio = Si. Escribe "No" para las que se puedan saltar.' },
  /* La ayuda dice para que sirve DE VERDAD desde que el registro se pagina:
     esta columna no agrupa visualmente, decide en que pantalla se pregunta.
     Quien llena la hoja sin saberlo deja un formulario de una sola tirada. */
  { id: 'grupo',         titulo: 'Grupo',            obligatoria: false, ayuda: 'La seccion, y ademas el PASO en que se pregunta: las filas con el mismo Grupo salen juntas en una pantalla con ese titulo. Vacio = van al final, todas juntas.' },
  { id: 'ayuda',         titulo: 'Ayuda',            obligatoria: false, ayuda: 'Aclaracion que sale bajo la pregunta.' },
];

/* Se comparan sin tildes, mayusculas ni espacios de mas: quien llena la hoja
   escribe "Tipo de Pregunta" o "TIPO DE PREGUNTA" y las dos valen. Lo que NO
   se acepta es una columna que se llame de otra forma: eso es adivinar. */
const normalizarTitulo = (v) => String(v == null ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const buscarPorTitulo = (lista, valor) => {
  const k = normalizarTitulo(valor);
  if (!k) return null;
  return lista.find(x => normalizarTitulo(x.titulo) === k || x.id === k) || null;
};

/* Resuelve las dos columnas a UN tipo del catalogo interno. */
function resolverTipoPlantilla(tipoPregunta, tipoDato) {
  const p = buscarPorTitulo(TIPOS_PREGUNTA, tipoPregunta);
  if (!p) {
    return { error: `"${tipoPregunta || '(vacio)'}" no es un tipo de pregunta valido. Usa uno de: ${TIPOS_PREGUNTA.map(t => t.titulo).join(', ')}.` };
  }

  const d = tipoDato ? buscarPorTitulo(TIPOS_DATO, tipoDato) : null;
  if (tipoDato && !d) {
    return { error: `"${tipoDato}" no es un tipo de dato valido. Usa uno de: ${TIPOS_DATO.map(t => t.titulo).join(', ')}.` };
  }

  /* Elegir una o varias manda siempre: una lista de opciones no puede ser un
     correo por mucho que la columna de dato lo diga. */
  if (p.exigeOpciones) return { tipo: p.tipo, exigeOpciones: true };

  /* Y si el dato aporta verificacion, gana sobre el texto corto: es lo que
     convierte "Texto corto" + "Correo" en un campo que exige arroba. */
  return { tipo: (d && d.tipo) ? d.tipo : p.tipo, exigeOpciones: false };
}

const PLANTILLA = {
  columnas: COLUMNAS_PLANTILLA,
  /* El `tipo` del catalogo viaja tambien: sin el, el panel tendria que
     mantener su propia tabla de equivalencias para poder pintar el campo, y
     esa copia es exactamente lo que ya se separo una vez con los tipos de
     correo. Si aun asi divergieran, el servidor rechaza al guardar
     (validarDefinicion) — falla ruidosamente, no en silencio. */
  tipos_pregunta: TIPOS_PREGUNTA.map(({ id, titulo, exigeOpciones, tipo }) => ({
    id, titulo, tipo, exigeOpciones: !!exigeOpciones,
  })),
  tipos_dato: TIPOS_DATO.map(({ id, titulo, tipo }) => ({ id, titulo, tipo })),
  /* La fila de ejemplo va en la plantilla descargable: una plantilla vacia se
     rellena mal, una con un ejemplo de cada tipo se copia bien. */
  ejemplo: [
    ['1', 'Nombres y apellidos',    'Texto corto',            'Texto',     '',                                 'Si', 'Datos generales', ''],
    ['2', 'Correo electronico',     'Texto corto',            'Correo electronico', '',                        'Si', 'Datos generales', 'Ahi se envia la boleta'],
    ['3', 'Telefono celular',       'Texto corto',            'Telefono',  '',                                 'Si', 'Datos generales', ''],
    ['4', 'Numero de documento',    'Texto corto',            'Documento', '',                                 'Si', 'Datos generales', ''],
    ['5', 'Barrio',                 'Elegir una opcion',      'Texto',     'La Candelaria; Modelia; Chapinero', 'No', 'Ubicacion',       'Se busca escribiendo'],
    ['6', 'Que te interesa',        'Elegir varias opciones', 'Texto',     'Charlas; Torneos; Stands',         'No', '',                ''],
    ['7', 'Requiere acompanante',   'Casilla si/no',          'Si / No',   '',                                 'No', '',                ''],
  ],
};

/* Grupos con los que se ordenan los campos en pantalla. Un formulario de 34
   preguntas sin agrupar es un muro. */
const GRUPOS = [
  'Datos generales',
  'Ubicación',
  'Identidad de género',
  'Autorreconocimiento étnico',
  'Situación actual',
  'Discapacidad',
  'Otros',
];

/* ── Ficha de caracterización ─────────────────────────────────────────
   Es la batería que piden las entidades públicas en Colombia para reportar
   quién asistió: los mismos grupos y las mismas opciones que traen sus
   formatos. Va como una ficha que se agrega de un clic, no campo por campo.

   Sobre las opciones: se escriben tal como las pide el formato, incluida la
   redundancia aparente (por ejemplo "Reincorporado" y "Reintegrado" son cosas
   distintas en la norma). No se "corrigen" ni se agrupan por nuestra cuenta,
   porque el dato tiene que salir igual que en el reporte oficial.

   `requerido: false` en casi todo a propósito: son datos sensibles y una
   pregunta sobre discapacidad o pertenencia étnica que bloquea la inscripción
   deja gente fuera. Solo se exige lo que hace falta para emitir la boleta. */
const FICHA_CARACTERIZACION = {
  id: 'caracterizacion',
  nombre: 'Ficha de caracterización',
  descripcion: 'Datos generales, ubicación y enfoque diferencial. La batería que piden las entidades públicas para reportar asistencia.',
  campos: [
    /* Datos generales */
    { grupo: 'Datos generales', etiqueta: 'Nombres y apellidos', tipo: 'texto', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Tipo de documento', tipo: 'seleccion', requerido: true,
      opciones: ['Cédula de ciudadanía', 'Tarjeta de identidad', 'Cédula de extranjería',
                 'Pasaporte', 'Registro civil', 'PEP', 'PPT', 'NIT', 'Otro'] },
    { grupo: 'Datos generales', etiqueta: 'Número de documento', tipo: 'documento', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Teléfono celular', tipo: 'telefono', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Correo electrónico', tipo: 'email', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Edad', tipo: 'numero', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Fecha de nacimiento', tipo: 'fecha', requerido: false },
    { grupo: 'Datos generales', etiqueta: 'Sexo', tipo: 'seleccion', requerido: false,
      opciones: ['Hombre', 'Mujer', 'Intersexual', 'Prefiere no responder'] },

    /* Ubicación */
    { grupo: 'Ubicación', etiqueta: 'Lugar de vivienda', tipo: 'seleccion', requerido: false,
      opciones: ['Urbana', 'Rural', 'Rural disperso'] },
    { grupo: 'Ubicación', etiqueta: 'Dirección de residencia', tipo: 'texto', requerido: false },
    { grupo: 'Ubicación', etiqueta: 'Barrio o vereda', tipo: 'texto', requerido: false },
    { grupo: 'Ubicación', etiqueta: 'Comuna', tipo: 'texto', requerido: false },
    { grupo: 'Ubicación', etiqueta: 'Corregimiento', tipo: 'texto', requerido: false },
    { grupo: 'Ubicación', etiqueta: 'Municipio', tipo: 'texto', requerido: false },
    { grupo: 'Ubicación', etiqueta: '¿Es extranjero?', tipo: 'checkbox', requerido: false },
    { grupo: 'Ubicación', etiqueta: 'País de origen (si es extranjero)', tipo: 'texto', requerido: false },

    /* Identidad de género */
    { grupo: 'Identidad de género', etiqueta: 'Identidad de género', tipo: 'seleccion', requerido: false,
      opciones: ['Hombre', 'Mujer', 'Hombre trans', 'Mujer trans', 'LGTBIQ+', 'Otro', 'Prefiere no responder'] },

    /* Autorreconocimiento étnico */
    { grupo: 'Autorreconocimiento étnico', etiqueta: 'Autorreconocimiento étnico', tipo: 'seleccion', requerido: false,
      opciones: ['Reincorporado', 'Reintegrado', 'Niños, niñas y adolescentes', 'Raizal',
                 'Indígena', 'Afrodescendiente', 'Mestizo', 'Rrom o gitano', 'Otro', 'Ninguno'] },
    { grupo: 'Autorreconocimiento étnico', etiqueta: 'Pueblo o comunidad (si aplica)', tipo: 'texto', requerido: false },

    /* Situación actual / enfoque diferencial. Múltiple a propósito: alguien
       puede ser a la vez víctima y madre cabeza de hogar, y obligar a elegir
       una sola cosa falsea el reporte. */
    { grupo: 'Situación actual', etiqueta: 'Situación actual / enfoque diferencial', tipo: 'multiple', requerido: false,
      opciones: ['Víctima del conflicto', 'Población vulnerable', 'Madre cabeza de hogar',
                 'Padre cabeza de hogar', 'Migrante', 'Habitante de calle', 'Ninguno'] },

    /* Discapacidad */
    { grupo: 'Discapacidad', etiqueta: 'Discapacidad', tipo: 'multiple', requerido: false,
      opciones: ['Motora', 'Sensorial', 'Intelectual', 'Psíquica', 'Visceral', 'Múltiple', 'Ninguna'] },
    { grupo: 'Discapacidad', etiqueta: '¿Requiere apoyo o ayuda técnica?', tipo: 'texto', requerido: false },
  ],
};

/* Fichas más cortas, para eventos que no necesitan la batería completa. */
const FICHA_CONTACTO = {
  id: 'contacto',
  nombre: 'Contacto básico',
  descripcion: 'Documento, teléfono y correo. Lo mínimo para poder avisarle a alguien.',
  campos: [
    { grupo: 'Datos generales', etiqueta: 'Número de documento', tipo: 'documento', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Teléfono celular', tipo: 'telefono', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Correo electrónico', tipo: 'email', requerido: true },
  ],
};

const FICHA_STAND = {
  id: 'stand',
  nombre: 'Expositor / stand',
  descripcion: 'Para la boleta de stand: no se le piden los mismos datos que a un asistente.',
  campos: [
    { grupo: 'Datos generales', etiqueta: 'Nombre del stand o empresa', tipo: 'texto', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'NIT o documento', tipo: 'documento', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Persona de contacto', tipo: 'texto', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Teléfono de contacto', tipo: 'telefono', requerido: true },
    { grupo: 'Datos generales', etiqueta: 'Correo de contacto', tipo: 'email', requerido: true },
    { grupo: 'Otros', etiqueta: 'Categoría del negocio', tipo: 'texto', requerido: false },
    { grupo: 'Otros', etiqueta: 'Sitio web o redes', tipo: 'texto', requerido: false },
    { grupo: 'Otros', etiqueta: '¿Qué va a exhibir?', tipo: 'parrafo', requerido: false },
    { grupo: 'Otros', etiqueta: 'Logo', tipo: 'foto', requerido: false },
  ],
};

const FICHAS = [FICHA_CARACTERIZACION, FICHA_CONTACTO, FICHA_STAND];

/* ── Validación ───────────────────────────────────────────────────────
   Se aplica al guardar una respuesta, no al definir el campo. Devuelve un
   mensaje de error o null. */

/* Deliberadamente permisiva y sin lista de dominios: solo descarta lo que no
   puede ser un correo. Validar de más rechaza direcciones válidas raras. */
const RE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function validarRespuesta(campo, valor) {
  const tipo = campo.tipo;

  /* La casilla se resuelve aparte, porque `false` es una respuesta dada —"no"—
     y no un hueco. Solo bloquea cuando se exige el sí, que es el caso de
     aceptar términos. Tratarla como el resto haría que un "no" contara como
     campo sin responder. */
  if (tipo === 'checkbox') {
    const marcada = valor === true || valor === 'true' || valor === 1 || valor === '1';
    if (campo.requerido && !marcada) return `Debes marcar "${campo.etiqueta}".`;
    return null;
  }

  const vacio = valor === undefined || valor === null || valor === ''
    || (Array.isArray(valor) && valor.length === 0);

  if (vacio) {
    if (campo.requerido) return `El campo "${campo.etiqueta}" es obligatorio.`;
    return null;
  }

  switch (tipo) {
    case 'email':
      if (!RE_EMAIL.test(String(valor).trim())) {
        return `"${campo.etiqueta}" no parece un correo electrónico.`;
      }
      break;

    case 'telefono': {
      const digitos = String(valor).replace(/[^\d]/g, '');
      if (digitos.length < 7 || digitos.length > 15) {
        return `"${campo.etiqueta}" debe tener entre 7 y 15 dígitos.`;
      }
      break;
    }

    case 'documento': {
      const limpio = String(valor).replace(/[\s.-]/g, '');
      if (!/^[A-Za-z0-9]{4,20}$/.test(limpio)) {
        return `"${campo.etiqueta}" no parece un número de documento.`;
      }
      break;
    }

    case 'numero':
      if (!Number.isFinite(Number(valor))) {
        return `"${campo.etiqueta}" debe ser un número.`;
      }
      break;

    case 'fecha':
      if (Number.isNaN(new Date(valor).getTime())) {
        return `"${campo.etiqueta}" no es una fecha válida.`;
      }
      break;

    case 'seleccion': {
      const ops = campo.opciones || [];
      if (ops.length && !ops.includes(String(valor))) {
        return `"${campo.etiqueta}": esa opción no está en la lista.`;
      }
      break;
    }

    case 'multiple': {
      if (!Array.isArray(valor)) {
        return `"${campo.etiqueta}" debe traer una lista de opciones.`;
      }
      const ops = campo.opciones || [];
      const fuera = valor.filter(v => ops.length && !ops.includes(String(v)));
      if (fuera.length) {
        return `"${campo.etiqueta}": ${fuera.join(', ')} no está en la lista.`;
      }
      break;
    }

    case 'foto':
      if (!/^https?:\/\//i.test(String(valor))) {
        return `"${campo.etiqueta}" debe ser la URL de una imagen subida.`;
      }
      break;

    default:
      break;
  }
  return null;
}

/* Valida todas las respuestas de un formulario. `ticketTypeId` filtra los
   campos que aplican: un campo obligatorio de la boleta de stand no debe
   bloquear la compra de una entrada general. */
function validarFormulario(campos, respuestas = {}, ticketTypeId = null) {
  for (const c of campos || []) {
    if (c.ticket_type_id && String(c.ticket_type_id) !== String(ticketTypeId)) continue;
    const error = validarRespuesta(c, respuestas[c.id]);
    if (error) return error;
  }
  return null;
}

/* Normaliza lo que llega del cliente al tipo que corresponde, para que en la
   base no queden números guardados como texto ni listas como cadenas. */
function normalizarRespuestas(campos, respuestas = {}) {
  const out = {};
  for (const c of campos || []) {
    if (!(c.id in respuestas)) continue;
    const v = respuestas[c.id];
    if (v === undefined) continue;

    switch (c.tipo) {
      case 'numero':
        out[c.id] = v === '' || v === null ? null : Number(v);
        break;
      case 'checkbox':
        out[c.id] = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'multiple':
        out[c.id] = Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []);
        break;
      case 'email':
        out[c.id] = String(v).trim().toLowerCase();
        break;
      default:
        out[c.id] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

/* ── Guardado ─────────────────────────────────────────────────────────
   Lo comparten el formulario del evento y el de un sub-evento. Vivía suelto
   en routes/eventos.js; cuando apareció el segundo editor iba a acabar
   copiado, que es exactamente la trampa que ya se pagó con los catálogos de
   tipos de campo y con las plantillas de correo. */

/* Un formulario de caracterización son ~22 preguntas y las entidades piden
   fichas de más de 30. El tope estaba en 20 y la ficha completa no se podía
   guardar. */
const MAX_CAMPOS_FORMULARIO = 60;

/* Las columnas de una pregunta. `grupo` y `ayuda` los añade la 0055;
   `session_id`, la 0059. */
const COLUMNAS_CAMPO = 'id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id, grupo, ayuda, buscable';

/* Arma la fila a guardar. Las opciones sólo tienen sentido en los tipos que
   las usan; en los demás se limpian para que no queden restos de haber
   cambiado el tipo de un campo ya creado. */
function filaCampo(c, orden) {
  return {
    tipo: c.tipo,
    etiqueta: c.etiqueta.trim(),
    opciones: CON_OPCIONES.has(c.tipo) ? c.opciones : null,
    requerido: Boolean(c.requerido),
    orden,
    ticket_type_id: c.ticket_type_id || null,
    grupo: c.grupo ? String(c.grupo).slice(0, 80) : null,
    ayuda: c.ayuda ? String(c.ayuda).slice(0, 300) : null,
    /* Solo un booleano explicito se guarda. Cualquier otra cosa vuelve a null,
       que significa «decide la plataforma por el tamaño» —y así un campo que
       deja de tener opciones no arrastra una decision que ya no aplica. */
    buscable: CON_OPCIONES.has(c.tipo) && typeof c.buscable === 'boolean' ? c.buscable : null,
  };
}

/* Comprobaciones comunes a los dos editores. Devuelve el mensaje del primer
   fallo, o null si la lista está bien. */
function validarDefinicion(campos, { max = MAX_CAMPOS_FORMULARIO } = {}) {
  if (!Array.isArray(campos)) return 'Formato inválido.';
  if (campos.length > max) return `Máximo ${max} preguntas.`;
  for (const c of campos) {
    if (!c.etiqueta?.trim()) return 'Cada pregunta necesita un enunciado.';
    if (!IDS_TIPOS_CAMPO.includes(c.tipo)) return `Tipo de pregunta inválido: ${c.tipo}`;
    if (CON_OPCIONES.has(c.tipo) && (!Array.isArray(c.opciones) || c.opciones.length === 0)) {
      return `La pregunta "${c.etiqueta}" necesita al menos una opción.`;
    }
  }
  return null;
}

module.exports = {
  TIPOS_CAMPO,
  IDS_TIPOS_CAMPO,
  UMBRAL_BUSCABLE,
  esBuscable,
  PLANTILLA,
  COLUMNAS_PLANTILLA,
  TIPOS_PREGUNTA,
  TIPOS_DATO,
  resolverTipoPlantilla,
  normalizarTitulo,
  TIPO_POR_ID,
  CON_OPCIONES,
  GRUPOS,
  FICHAS,
  MAX_CAMPOS_FORMULARIO,
  COLUMNAS_CAMPO,
  filaCampo,
  validarDefinicion,
  validarRespuesta,
  validarFormulario,
  normalizarRespuestas,
};
