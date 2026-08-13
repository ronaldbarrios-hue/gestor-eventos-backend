const test = require('node:test');
const assert = require('node:assert');

/* El router toca supabase al cargarse, así que hacen falta variables ficticias.
   No se hace ninguna llamada de red: estas pruebas sólo ejercitan el protocolo. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';

const { _test } = require('../routes/mcp.js');
const { manejar, TOOLS_MCP, comoMCP } = _test;

/* Un conector MCP falla de la peor manera: Claude se conecta, no ve
   herramientas o recibe un esquema que no entiende, y no dice por qué. Estas
   pruebas cubren el contrato, que es lo único que el cliente ve. */

test('initialize responde con la versión del protocolo y quién es el servidor', async () => {
  const r = await manejar({ jsonrpc: '2.0', id: 1, method: 'initialize' }, 'user-1');
  assert.equal(r.jsonrpc, '2.0');
  assert.equal(r.id, 1);
  assert.match(r.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.result.serverInfo.name, 'gestek');
  assert.ok(r.result.capabilities.tools, 'debe declarar que tiene herramientas');
});

test('una notificación no lleva respuesta', async () => {
  const r = await manejar({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'user-1');
  assert.equal(r, null, 'responder a una notificación rompe a algunos clientes');
});

test('tools/list publica las herramientas del agente', async () => {
  const r = await manejar({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'user-1');
  assert.ok(Array.isArray(r.result.tools));
  assert.ok(r.result.tools.length > 50, `esperaba decenas de herramientas, hay ${r.result.tools.length}`);
});

test('cada herramienta trae nombre, descripción y inputSchema', () => {
  for (const t of TOOLS_MCP) {
    assert.ok(t.name, 'herramienta sin nombre');
    assert.ok(t.description, `«${t.name}» sin descripción: el modelo no sabrá cuándo usarla`);
    assert.ok(t.inputSchema, `«${t.name}» sin inputSchema`);
    assert.equal(t.inputSchema.type, 'object', `«${t.name}»: el esquema raíz debe ser object`);
    /* El nombre de la clave es lo único que cambia respecto al formato de
       Anthropic. Si se cuela `input_schema`, el cliente no ve parámetros. */
    assert.equal(t.input_schema, undefined, `«${t.name}» conserva input_schema en snake_case`);
  }
});

test('la traducción de esquema conserva el JSON tal cual', () => {
  const original = {
    name: 'x', description: 'y',
    input_schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  };
  const m = comoMCP(original);
  assert.deepEqual(m.inputSchema, original.input_schema);
  assert.equal(m.inputSchema.required[0], 'a');
});

test('no se publica lo que sólo tiene sentido dentro del panel', () => {
  assert.ok(
    !TOOLS_MCP.some(t => t.name === 'solicitar_formulario'),
    'solicitar_formulario pinta un formulario en pantalla; en Claude no hay dónde',
  );
  assert.ok(!TOOLS_MCP.some(t => t.name.startsWith('_')), 'no se publican las internas');
});

test('un método desconocido devuelve -32601, no una excepción', async () => {
  const r = await manejar({ jsonrpc: '2.0', id: 3, method: 'inventado/loQueSea' }, 'user-1');
  assert.equal(r.error.code, -32601);
});

test('llamar a una herramienta que no existe devuelve -32602', async () => {
  const r = await manejar(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'no_existe', arguments: {} } },
    'user-1',
  );
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /desconocida/i);
});

test('tools/call sin nombre devuelve -32602', async () => {
  const r = await manejar({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} }, 'user-1');
  assert.equal(r.error.code, -32602);
});

test('ping responde vacío pero responde', async () => {
  const r = await manejar({ jsonrpc: '2.0', id: 6, method: 'ping' }, 'user-1');
  assert.deepEqual(r.result, {});
});

test('resources y prompts responden lista vacía, no error', async () => {
  const a = await manejar({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, 'user-1');
  const b = await manejar({ jsonrpc: '2.0', id: 8, method: 'prompts/list' }, 'user-1');
  assert.deepEqual(a.result.resources, []);
  assert.deepEqual(b.result.prompts, []);
});

test('el id de la petición vuelve tal cual, incluido el 0', async () => {
  /* Un `id: 0` es válido en JSON-RPC y se pierde con un `||` mal puesto. */
  const r = await manejar({ jsonrpc: '2.0', id: 0, method: 'ping' }, 'user-1');
  assert.equal(r.id, 0);
});
