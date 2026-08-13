/* GESTEK — Servidor MCP: la plataforma como conector dentro de Claude.

   La idea que pidió el equipo: que el organizador no tenga que entrar al panel
   para todo. Conecta GESTEK una vez en Claude —igual que se conectan Notion o
   GitHub— y después le habla normal: «móntame el evento de septiembre, con
   una boleta general a 50 mil y una VIP a 120», y Claude lo hace sobre su
   cuenta.

   Lo importante: aquí NO hay herramientas nuevas. Se publican las mismas 70 de
   lib/agente.js, con el mismo ejecutor. Mantener dos catálogos sería repetir
   exactamente el error que ya costó caro con los tipos de campo del formulario
   y con las plantillas de correo: dos listas que se separan en silencio.

   Autenticación: los tokens `gtk_live_` que ya existen. El organizador genera
   uno en el panel y lo pega en Claude como cabecera. Cada token es de una
   cuenta, así que Claude actúa siempre sobre los eventos de su dueño y nunca
   sobre los de otro.

   Transporte: JSON-RPC 2.0 sobre HTTP (Streamable HTTP), que es lo que
   consumen los conectores remotos. Sin sesiones ni SSE: cada petición es
   independiente, que es lo que hace falta para las tres operaciones que
   soportamos y lo que mejor sobrevive detrás de un proxy.
*/

const express = require('express');
const { verifyApiToken } = require('../lib/apitoken.js');
const agente = require('../lib/agente.js');

const router = express.Router();

const PROTOCOLO = '2025-06-18';
const SERVIDOR = { name: 'gestek', title: 'GESTEK Event OS', version: '1.0.0' };

/* ── JSON-RPC ─────────────────────────────────────────────────────────── */

const ok  = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
});

/* Códigos del estándar. -32602 es «parámetros inválidos», que es lo que
   devuelve una herramienta que no existe. */
const E_METODO   = -32601;
const E_PARAMS   = -32602;
const E_INTERNO  = -32603;

/* MCP usa `inputSchema` en camelCase; las herramientas del agente están
   escritas con `input_schema` porque nacieron para la API de Anthropic. Es la
   única traducción que hace falta: el esquema JSON es idéntico. */
function comoMCP(t) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema || { type: 'object', properties: {} },
  };
}

/* Herramientas que no tienen sentido fuera del panel: `solicitar_formulario`
   pinta un formulario en la pantalla de Gestbot, y en Claude no hay pantalla
   donde pintarlo. Se filtra en vez de dejar que Claude la llame y se quede
   esperando algo que nunca llega. */
const SOLO_PANEL = new Set(['solicitar_formulario']);

const TOOLS_MCP = (agente.TOOLS || [])
  .filter(t => t?.name && !t.name.startsWith('_') && !SOLO_PANEL.has(t.name))
  .map(comoMCP);

/* ── Métodos ──────────────────────────────────────────────────────────── */

async function manejar(peticion, ownerId) {
  const { id = null, method, params = {} } = peticion || {};

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOLO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVIDOR,
        instructions:
          'Herramientas para operar una cuenta de GESTEK Event OS: crear y publicar eventos, ' +
          'boletas, asistentes, agenda, equipo y torneos. Antes de editar o publicar algo, usa ' +
          'listar_eventos para obtener el id correcto. Publicar un evento lo hace visible al ' +
          'público: hazlo sólo si te lo piden explícitamente.',
      });

    /* Los `notifications/*` no llevan respuesta: el cliente avisa y sigue. */
    case 'notifications/initialized':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS_MCP });

    case 'tools/call': {
      const nombre = params?.name;
      const args = params?.arguments || {};
      if (!nombre) return err(id, E_PARAMS, 'Falta el nombre de la herramienta.');
      if (!TOOLS_MCP.some(t => t.name === nombre)) {
        return err(id, E_PARAMS, `Herramienta desconocida: ${nombre}`);
      }

      /* `acciones` es el registro que lleva el panel; aquí se recoge y se
         descarta, pero el ejecutor lo exige. */
      const acciones = [];
      const resultado = await agente.ejecutarTool(ownerId, nombre, args, acciones);

      /* MCP distingue «la llamada falló» de «la herramienta devolvió un
         error»: lo segundo va con isError, para que el modelo pueda leer el
         motivo y corregir en vez de darse por vencido. */
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(resultado ?? null, null, 2) }],
        isError: Boolean(resultado?.error),
      });
    }

    /* Se declaran para que un cliente que las sondee reciba una lista vacía en
       vez de un error feo. */
    case 'resources/list': return ok(id, { resources: [] });
    case 'prompts/list':   return ok(id, { prompts: [] });

    default:
      return err(id, E_METODO, `Método no soportado: ${method}`);
  }
}

/* ── Transporte ───────────────────────────────────────────────────────── */

router.use(verifyApiToken);

router.post('/mcp', async (req, res) => {
  const cuerpo = req.body;

  /* JSON-RPC admite lotes. Los conectores los usan poco, pero rechazarlos
     rompería un cliente que sí los mande. */
  const esLote = Array.isArray(cuerpo);
  const peticiones = esLote ? cuerpo : [cuerpo];

  try {
    const respuestas = [];
    for (const p of peticiones) {
      const r = await manejar(p, req.apiOwner);
      if (r) respuestas.push(r);   // las notificaciones no responden
    }
    /* Un lote entero de notificaciones no lleva cuerpo: 202 y nada más. */
    if (respuestas.length === 0) return res.status(202).end();
    res.json(esLote ? respuestas : respuestas[0]);
  } catch (e) {
    console.error('[mcp] error:', e.message);
    res.json(err(cuerpo?.id ?? null, E_INTERNO, e.message));
  }
});

/* Algunos clientes abren un GET para escuchar eventos del servidor. No
   emitimos ninguno, así que se dice claramente en vez de dejar la conexión
   colgada. */
router.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Este servidor MCP no emite eventos; usa POST.' });
});

/* Para que el organizador confirme que su token sirve antes de pelearse con la
   configuración del cliente. */
router.get('/mcp/estado', (req, res) => {
  res.json({
    ok: true,
    servidor: SERVIDOR,
    protocolo: PROTOCOLO,
    herramientas: TOOLS_MCP.length,
    cuenta: req.apiOwner,
  });
});

module.exports = router;

/* Para las pruebas: el protocolo se comprueba sin levantar el servidor ni
   tocar la base. */
module.exports._test = { manejar, TOOLS_MCP, comoMCP, PROTOCOLO };
