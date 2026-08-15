/* Tests de los campos del formulario y su validación.

   Lo que se protege: que un campo de correo no acepte "hola", que una selección
   no acepte una opción que no está en su lista, que la selección múltiple
   guarde un array, y que un obligatorio de la boleta de stand no bloquee la
   compra de una entrada general.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIPOS_CAMPO, IDS_TIPOS_CAMPO, CON_OPCIONES, GRUPOS, FICHAS,
  validarRespuesta, validarFormulario, normalizarRespuestas,
  esBuscable, UMBRAL_BUSCABLE, filaCampo, validarDefinicion,
  PLANTILLA, COLUMNAS_PLANTILLA, TIPOS_PREGUNTA, TIPOS_DATO, resolverTipoPlantilla,
} = require('../lib/formularioCampos.js');

const campo = (extra) => ({ id: 'c1', etiqueta: 'Campo', tipo: 'texto', requerido: false, ...extra });

/* ── Catálogo ── */

test('los tipos de campo no se repiten', () => {
  assert.equal(new Set(IDS_TIPOS_CAMPO).size, IDS_TIPOS_CAMPO.length);
});

test('cada tipo declara label y forma del valor', () => {
  for (const t of TIPOS_CAMPO) {
    assert.ok(t.label, `${t.id} sin label`);
    assert.ok(['texto', 'numero', 'fecha', 'lista', 'booleano'].includes(t.valor), `${t.id}: valor raro`);
  }
});

test('los tipos con opciones son exactamente seleccion y multiple', () => {
  assert.deepEqual([...CON_OPCIONES].sort(), ['multiple', 'seleccion']);
});

/* ── Las fichas ── */

test('las fichas usan tipos y grupos que existen', () => {
  for (const f of FICHAS) {
    assert.ok(f.id && f.nombre && f.descripcion, `${f.id} incompleta`);
    assert.ok(f.campos.length > 0, `${f.id} sin campos`);
    for (const c of f.campos) {
      assert.ok(IDS_TIPOS_CAMPO.includes(c.tipo), `${f.id}/${c.etiqueta}: tipo ${c.tipo} no existe`);
      assert.ok(GRUPOS.includes(c.grupo), `${f.id}/${c.etiqueta}: grupo "${c.grupo}" no existe`);
      assert.ok(c.etiqueta, `${f.id}: campo sin etiqueta`);
    }
  }
});

test('los campos con opciones de las fichas las traen, y sin repetir', () => {
  for (const f of FICHAS) {
    for (const c of f.campos) {
      if (!CON_OPCIONES.has(c.tipo)) continue;
      assert.ok(Array.isArray(c.opciones) && c.opciones.length > 0, `${f.id}/${c.etiqueta} sin opciones`);
      assert.equal(new Set(c.opciones).size, c.opciones.length, `${f.id}/${c.etiqueta}: opciones repetidas`);
    }
  }
});

test('la ficha de caracterización trae los grupos que pide el formato', () => {
  const ficha = FICHAS.find(f => f.id === 'caracterizacion');
  const grupos = new Set(ficha.campos.map(c => c.grupo));
  for (const g of ['Datos generales', 'Ubicación', 'Identidad de género',
                   'Autorreconocimiento étnico', 'Situación actual', 'Discapacidad']) {
    assert.ok(grupos.has(g), `falta el grupo ${g}`);
  }
});

test('la caracterización solo exige lo mínimo: nada sensible es obligatorio', () => {
  const ficha = FICHAS.find(f => f.id === 'caracterizacion');
  const sensibles = ['Identidad de género', 'Autorreconocimiento étnico', 'Situación actual', 'Discapacidad'];
  for (const c of ficha.campos) {
    if (sensibles.includes(c.grupo)) {
      assert.equal(c.requerido, false, `"${c.etiqueta}" no debería ser obligatorio: dejaría gente fuera`);
    }
  }
});

test('la ficha de caracterización pide correo, documento y teléfono', () => {
  const ficha = FICHAS.find(f => f.id === 'caracterizacion');
  const tipos = ficha.campos.map(c => c.tipo);
  for (const t of ['email', 'documento', 'telefono']) {
    assert.ok(tipos.includes(t), `falta un campo de tipo ${t}`);
  }
});

/* ── Obligatorios ── */

test('un obligatorio vacío se rechaza; uno opcional no', () => {
  assert.match(validarRespuesta(campo({ requerido: true }), ''), /obligatorio/);
  assert.equal(validarRespuesta(campo({ requerido: false }), ''), null);
  assert.equal(validarRespuesta(campo({ requerido: false }), undefined), null);
});

test('una lista vacía cuenta como vacía en selección múltiple', () => {
  const c = campo({ tipo: 'multiple', requerido: true, opciones: ['A', 'B'] });
  assert.match(validarRespuesta(c, []), /obligatorio|marcar/);
});

/* ── Correo ── */

test('el correo se valida de verdad', () => {
  const c = campo({ tipo: 'email', etiqueta: 'Correo electrónico' });
  assert.equal(validarRespuesta(c, 'ana@ejemplo.com'), null);
  assert.equal(validarRespuesta(c, 'ana.perez+tag@sub.ejemplo.co'), null);
  assert.match(validarRespuesta(c, 'hola'), /no parece un correo/);
  assert.match(validarRespuesta(c, 'ana@ejemplo'), /no parece un correo/);
  assert.match(validarRespuesta(c, 'ana @ejemplo.com'), /no parece un correo/);
  assert.match(validarRespuesta(c, '@ejemplo.com'), /no parece un correo/);
});

/* ── Teléfono y documento ── */

test('el teléfono acepta separadores pero exige dígitos suficientes', () => {
  const c = campo({ tipo: 'telefono', etiqueta: 'Teléfono celular' });
  assert.equal(validarRespuesta(c, '300 123 4567'), null);
  assert.equal(validarRespuesta(c, '+57 300-123-4567'), null);
  assert.match(validarRespuesta(c, '12345'), /entre 7 y 15/);
  assert.match(validarRespuesta(c, '1'.repeat(16)), /entre 7 y 15/);
});

test('el documento admite letras y puntos, pero no cualquier cosa', () => {
  const c = campo({ tipo: 'documento', etiqueta: 'Número de documento' });
  assert.equal(validarRespuesta(c, '1.020.304.050'), null);
  assert.equal(validarRespuesta(c, 'AB123456'), null);
  assert.match(validarRespuesta(c, 'no'), /no parece un número de documento/);
  assert.match(validarRespuesta(c, 'con espacios y símbolos !!'), /no parece/);
});

/* ── Número y fecha ── */

test('el número rechaza texto', () => {
  const c = campo({ tipo: 'numero', etiqueta: 'Edad' });
  assert.equal(validarRespuesta(c, '34'), null);
  assert.equal(validarRespuesta(c, 34), null);
  assert.match(validarRespuesta(c, 'treinta'), /debe ser un número/);
});

test('la fecha rechaza lo que no es fecha', () => {
  const c = campo({ tipo: 'fecha', etiqueta: 'Fecha de nacimiento' });
  assert.equal(validarRespuesta(c, '1991-04-17'), null);
  assert.match(validarRespuesta(c, 'ayer'), /no es una fecha válida/);
});

/* ── Selección ── */

test('una selección solo acepta opciones de su lista', () => {
  const c = campo({ tipo: 'seleccion', etiqueta: 'Sexo', opciones: ['Hombre', 'Mujer'] });
  assert.equal(validarRespuesta(c, 'Mujer'), null);
  assert.match(validarRespuesta(c, 'Marciano'), /no está en la lista/);
});

test('la selección múltiple exige un array y valida cada opción', () => {
  const c = campo({ tipo: 'multiple', etiqueta: 'Discapacidad', opciones: ['Motora', 'Visual', 'Ninguna'] });
  assert.equal(validarRespuesta(c, ['Motora', 'Visual']), null);
  assert.match(validarRespuesta(c, 'Motora'), /lista de opciones/);
  assert.match(validarRespuesta(c, ['Motora', 'Inventada']), /Inventada/);
});

/* ── Foto ── */

test('la foto exige una URL subida, no texto libre', () => {
  const c = campo({ tipo: 'foto', etiqueta: 'Foto' });
  assert.equal(validarRespuesta(c, 'https://cdn.ejemplo.com/a.jpg'), null);
  assert.match(validarRespuesta(c, 'mi-foto.jpg'), /URL de una imagen/);
  assert.match(validarRespuesta(c, 'javascript:alert(1)'), /URL de una imagen/);
});

/* ── Casilla ── */

test('una casilla sin marcar no es una respuesta que falte', () => {
  assert.equal(validarRespuesta(campo({ tipo: 'checkbox', requerido: false }), false), null);
});

test('pero una casilla obligatoria sí exige el sí', () => {
  const c = campo({ tipo: 'checkbox', requerido: true, etiqueta: 'Acepto los términos' });
  assert.ok(validarRespuesta(c, false));
  assert.equal(validarRespuesta(c, true), null);
});

/* ── El formulario completo, con tipos de boleta ── */

test('un obligatorio de otra boleta no bloquea esta compra', () => {
  const campos = [
    { id: 'g1', etiqueta: 'Cédula', tipo: 'documento', requerido: true, ticket_type_id: null },
    { id: 's1', etiqueta: 'NIT del stand', tipo: 'documento', requerido: true, ticket_type_id: 'tipo-stand' },
  ];
  /* Compra de entrada general: solo se le exige la cédula. */
  assert.equal(validarFormulario(campos, { g1: '1020304050' }, 'tipo-general'), null);
  /* Compra de boleta de stand: se le exigen las dos. */
  assert.match(validarFormulario(campos, { g1: '1020304050' }, 'tipo-stand'), /NIT del stand/);
});

test('validarFormulario devuelve null cuando todo está bien', () => {
  const campos = [
    { id: 'a', etiqueta: 'Correo', tipo: 'email', requerido: true },
    { id: 'b', etiqueta: 'Discapacidad', tipo: 'multiple', requerido: false, opciones: ['Motora', 'Ninguna'] },
  ];
  assert.equal(validarFormulario(campos, { a: 'ana@x.com', b: ['Ninguna'] }, null), null);
});

test('validarFormulario aguanta lista de campos vacía o nula', () => {
  assert.equal(validarFormulario([], {}, null), null);
  assert.equal(validarFormulario(null, {}, null), null);
});

/* ── Normalización ── */

test('normalizar deja cada valor en su tipo', () => {
  const campos = [
    { id: 'n', tipo: 'numero' },
    { id: 'b', tipo: 'checkbox' },
    { id: 'm', tipo: 'multiple' },
    { id: 'e', tipo: 'email' },
    { id: 't', tipo: 'texto' },
  ];
  const out = normalizarRespuestas(campos, {
    n: '34', b: 'true', m: 'Motora', e: '  ANA@X.COM ', t: '  hola  ',
  });
  assert.equal(out.n, 34);
  assert.equal(out.b, true);
  assert.deepEqual(out.m, ['Motora']);
  assert.equal(out.e, 'ana@x.com');
  assert.equal(out.t, 'hola');
});

test('normalizar ignora lo que no corresponde a ningún campo', () => {
  const out = normalizarRespuestas([{ id: 'a', tipo: 'texto' }], { a: 'x', colado: 'no debería estar' });
  assert.deepEqual(Object.keys(out), ['a']);
});

test('una casilla sin marcar se guarda como false, no se pierde', () => {
  const out = normalizarRespuestas([{ id: 'b', tipo: 'checkbox' }], { b: false });
  assert.equal(out.b, false);
});

/* ── Listas largas ───────────────────────────────────────────────────── */

test('una lista larga se marca como buscable y una corta no', () => {
  const muchas = Array.from({ length: 40 }, (_, i) => `Barrio ${i}`);
  assert.equal(esBuscable({ tipo: 'seleccion', opciones: muchas }), true);
  assert.equal(esBuscable({ tipo: 'multiple', opciones: muchas }), true);
  assert.equal(esBuscable({ tipo: 'seleccion', opciones: ['A', 'B', 'C'] }), false);
});

test('un booleano explícito manda sobre el tamaño', () => {
  const muchas = Array.from({ length: 40 }, (_, i) => `Barrio ${i}`);
  assert.equal(esBuscable({ tipo: 'seleccion', opciones: ['A'], buscable: true }), true);
  assert.equal(esBuscable({ tipo: 'seleccion', opciones: muchas, buscable: false }), false);
});

test('los tipos sin opciones nunca son buscables', () => {
  for (const tipo of ['texto', 'parrafo', 'numero', 'fecha', 'checkbox', 'foto']) {
    assert.equal(esBuscable({ tipo, buscable: true }), false, `${tipo} no debería serlo`);
  }
  assert.equal(esBuscable(null), false);
});

test('sólo se guarda un booleano explícito; lo demás vuelve a null', () => {
  const muchas = Array.from({ length: 40 }, (_, i) => `B${i}`);
  const auto = filaCampo({ tipo: 'seleccion', etiqueta: 'Barrio', opciones: muchas }, 0);
  assert.equal(auto.buscable, null, 'sin decisión explícita debe quedar en automático');

  const forzado = filaCampo({ tipo: 'seleccion', etiqueta: 'Barrio', opciones: muchas, buscable: false }, 0);
  assert.equal(forzado.buscable, false);

  /* Si un campo deja de tener opciones, la decisión vieja no puede sobrevivir:
     arrastraría un `buscable` que ya no significa nada. */
  const texto = filaCampo({ tipo: 'texto', etiqueta: 'Nombre', buscable: true }, 0);
  assert.equal(texto.buscable, null);
});

/* El umbral está duplicado en el frontend (CampoFormulario.jsx) porque el
   renderizador público no siempre tiene el catálogo cargado. Si alguien lo
   cambia aquí, esta prueba falla y recuerda que hay una segunda copia. */
test('el umbral es 8 — si cambia, cambiar también CampoFormulario.jsx', () => {
  assert.equal(UMBRAL_BUSCABLE, 8);
});


/* -- La plantilla de importacion --------------------------------------

   Lo que se protege aqui es que la plantilla que se DESCARGA y la que se
   ACEPTA al subir sigan siendo la misma. Son dos caminos distintos sobre la
   misma definicion, y es exactamente el tipo de par que se separa sin que
   nadie lo note: alguien agrega una columna al generador, el validador no se
   entera, y la plantilla oficial deja de pasar su propia validacion. */

test('la plantilla que se descarga pasa su propia validacion', () => {
  const idx = Object.fromEntries(COLUMNAS_PLANTILLA.map((c, i) => [c.id, i]));
  const campos = [];

  for (const fila of PLANTILLA.ejemplo) {
    assert.equal(fila.length, COLUMNAS_PLANTILLA.length,
      `la fila de ejemplo "${fila[idx.pregunta]}" no tiene una celda por columna`);

    const r = resolverTipoPlantilla(fila[idx.tipo_pregunta], fila[idx.tipo_dato]);
    assert.ok(!r.error, `el ejemplo se rechaza a si mismo: ${r.error}`);

    campos.push({
      etiqueta: fila[idx.pregunta],
      tipo: r.tipo,
      opciones: r.exigeOpciones
        ? String(fila[idx.opciones]).split(';').map(x => x.trim()).filter(Boolean)
        : null,
      requerido: /^s/i.test(String(fila[idx.obligatoria])),
    });
  }

  assert.equal(validarDefinicion(campos), null);
});

test('todo tipo de la plantilla existe en el catalogo real', () => {
  const validos = new Set(IDS_TIPOS_CAMPO);
  for (const t of TIPOS_PREGUNTA) {
    assert.ok(validos.has(t.tipo), `tipo de pregunta "${t.titulo}" apunta a ${t.tipo}, que no existe`);
  }
  for (const t of TIPOS_DATO) {
    if (t.tipo) assert.ok(validos.has(t.tipo), `tipo de dato "${t.titulo}" apunta a ${t.tipo}, que no existe`);
  }
});

test('el tipo de dato aporta la verificacion sobre un texto corto', () => {
  assert.equal(resolverTipoPlantilla('Texto corto', 'Correo electronico').tipo, 'email');
  assert.equal(resolverTipoPlantilla('Texto corto', 'Telefono').tipo, 'telefono');
  assert.equal(resolverTipoPlantilla('Texto corto', 'Documento').tipo, 'documento');
  assert.equal(resolverTipoPlantilla('Texto corto', 'Texto').tipo, 'texto');
  assert.equal(resolverTipoPlantilla('Texto corto', '').tipo, 'texto');
});

test('elegir una o varias manda sobre el tipo de dato', () => {
  /* Una lista de opciones no puede ser un correo por mucho que la columna de
     dato lo diga: si ganara el dato, el campo perderia sus opciones. */
  const una = resolverTipoPlantilla('Elegir una opcion', 'Correo electronico');
  assert.equal(una.tipo, 'seleccion');
  assert.equal(una.exigeOpciones, true);

  const varias = resolverTipoPlantilla('Elegir varias opciones', 'Numero');
  assert.equal(varias.tipo, 'multiple');
  assert.equal(varias.exigeOpciones, true);
});

test('los titulos se reconocen sin importar tildes ni mayusculas', () => {
  for (const escrito of ['Texto corto', 'texto corto', 'TEXTO CORTO', '  Texto   corto  ']) {
    assert.equal(resolverTipoPlantilla(escrito, '').tipo, 'texto', `no reconocio "${escrito}"`);
  }
  assert.equal(resolverTipoPlantilla('Elegir una opcion', '').tipo, 'seleccion');
  assert.equal(resolverTipoPlantilla('Elegir una opci\u00f3n', '').tipo, 'seleccion');
});

test('un tipo desconocido se rechaza diciendo cuales valen', () => {
  const r = resolverTipoPlantilla('Desplegable bonito', '');
  assert.ok(r.error);
  /* El mensaje tiene que listar las opciones validas: "tipo invalido" a secas
     obliga a ir a buscar la documentacion que nadie tiene abierta. */
  assert.ok(r.error.includes('Texto corto'), 'el error deberia listar los tipos validos');

  const d = resolverTipoPlantilla('Texto corto', 'Cedula o algo');
  assert.ok(d.error);
  assert.ok(d.error.includes('Documento'), 'el error deberia listar los datos validos');
});

test('sin tipo de pregunta no se adivina nada', () => {
  /* Adivinar es justo lo que se elimino: el importador viejo mapeaba por
     sinonimos y fallaba en silencio. */
  assert.ok(resolverTipoPlantilla('', 'Correo electronico').error);
  assert.ok(resolverTipoPlantilla(null, null).error);
});

test('las columnas obligatorias son las mismas que exige el importador', () => {
  const obligatorias = COLUMNAS_PLANTILLA.filter(c => c.obligatoria).map(c => c.id);
  assert.deepEqual(obligatorias, ['pregunta', 'tipo_pregunta']);
});
