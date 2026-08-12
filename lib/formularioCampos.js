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

module.exports = {
  TIPOS_CAMPO,
  IDS_TIPOS_CAMPO,
  TIPO_POR_ID,
  CON_OPCIONES,
  GRUPOS,
  FICHAS,
  validarRespuesta,
  validarFormulario,
  normalizarRespuestas,
};
