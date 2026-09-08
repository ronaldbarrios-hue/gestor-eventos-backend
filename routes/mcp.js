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
const { sesion, publica } = require('../core/permisos');
const { hashToken } = require('../lib/apitoken.js');
const supabase = require('../lib/supabase.js');
const oauth = require('../lib/oauth.js');
const agente = require('../lib/agente.js');
const alcance = require('../lib/alcanceMcp.js');

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

/* Las herramientas que ve ESTE token.
 *
 * Antes era una lista fija calculada al arrancar: todos los tokens veían las 73,
 * incluidas emitir cortesías, marcar boletas como pagadas y sacar gente del
 * equipo. La columna `api_tokens.scopes` existía y no la miraba nadie.
 *
 * Lo que nunca sale —`solicitar_formulario`, que pinta un formulario en la
 * pantalla del chat y por MCP no tiene dónde pintarlo— vive ahora en
 * `lib/alcanceMcp.js` y no en una segunda lista aquí. */
const toolsDe = (scopes) => alcance.herramientasPara(agente.TOOLS || [], scopes).map(comoMCP);

/* ── Métodos ──────────────────────────────────────────────────────────── */

async function manejar(peticion, ownerId, scopes = null) {
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
      return ok(id, { tools: toolsDe(scopes) });

    case 'tools/call': {
      const nombre = params?.name;
      const args = params?.arguments || {};
      if (!nombre) return err(id, E_PARAMS, 'Falta el nombre de la herramienta.');
      /* Se comprueba la LLAMADA, no que estuviera en la lista que se enseñó:
         un cliente MCP puede llamar a `tools/call` con cualquier nombre.
         Filtrar la lista es cortesía; comprobar aquí es la seguridad. */
      if (!alcance.puedeEjecutar(nombre, scopes, agente.TOOLS || [])) {
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

/* ── Autenticacion: dos caminos ────────────────────────────────────────

   · OAuth (gtkat_...) — lo que usa claude.ai, que no tiene donde pegar un
     token a mano.
   · Token de API (gtk_live_...) — lo que usan Claude Code y Claude Desktop,
     donde si se puede poner una cabecera.

   Se aceptan los dos porque cubren clientes distintos, no porque sobre uno.

   Y el 401 lleva `WWW-Authenticate` con la URL de los metadatos: es asi como
   un cliente MCP DESCUBRE que hay que autorizar y donde. Sin esa cabecera,
   claude.ai ve un 401 pelado, no sabe que existe OAuth, y el conector no
   arranca nunca. Es el detalle que hace que todo lo demas sirva. */
async function autenticar(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);

  const rechazar = (motivo) => {
    const base = oauth.baseUrl(req);
    res.set('WWW-Authenticate',
      `Bearer realm="GESTEK", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: motivo });
  };

  if (!m) return rechazar('Falta el token. Conecta GESTEK como conector para autorizarlo.');
  const token = m[1];

  /* OAuth primero: es el camino que va a usar la mayoria. */
  if (token.startsWith('gtkat_')) {
    const d = await oauth.dueñoDelToken(token);
    if (!d) return rechazar('Autorizacion invalida o caducada.');
    req.apiOwner = d.ownerId;
    req.mcpVia = 'oauth';
    return next();
  }

  /* Token de API de toda la vida. */
  if (token.startsWith('gtk_live_')) {
    const { data: tok } = await supabase
      .from('api_tokens').select('*').eq('token_hash', hashToken(token)).maybeSingle();
    if (!tok || tok.revoked) return rechazar('Token invalido o revocado.');
    supabase.from('api_tokens')
      .update({ last_used_at: new Date().toISOString() }).eq('id', tok.id)
      .then(() => {}, () => {});
    req.apiOwner = tok.owner_id;
    req.mcpVia = 'token';
    /* Lo que este token puede hacer. Un token sin alcances —los de antes de
       que existiera esta columna— los tiene todos: quitarle permisos a algo
       que ya funcionaba, sin avisar, rompe una integración en marcha. */
    req.mcpScopes = Array.isArray(tok.scopes) ? tok.scopes : null;
    return next();
  }

  return rechazar('Formato de token no reconocido.');
}

/* OJO: el middleware va POR RUTA, no con router.use().
   Este router se monta en '/', y un `router.use(auth)` se ejecuta para CADA
   peticion que pasa por el — no solo para las que casan con sus rutas. Puesto
   arriba, exigiria un token a la API publica entera: paginas de evento,
   categorias, todo. Cuesta repetir el middleware en tres lineas y evita
   tumbar el sitio. */
router.post('/mcp', autenticar, sesion('El servidor MCP se autentica con su propio token gtk_live_, no con la sesión del navegador. Cada token es de una cuenta y Claude actúa siempre sobre los eventos de su dueño.'), async (req, res) => {
  const cuerpo = req.body;

  /* JSON-RPC admite lotes. Los conectores los usan poco, pero rechazarlos
     rompería un cliente que sí los mande. */
  const esLote = Array.isArray(cuerpo);
  const peticiones = esLote ? cuerpo : [cuerpo];

  try {
    const respuestas = [];
    for (const p of peticiones) {
      const r = await manejar(p, req.apiOwner, req.mcpScopes);
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
router.get('/mcp', publica('Descubrimiento del servidor MCP: el cliente lo consulta antes de tener token.'), (_req, res) => {
  res.status(405).json({ error: 'Este servidor MCP no emite eventos; usa POST.' });
});

/* Para que el organizador confirme que su token sirve antes de pelearse con la
   configuración del cliente. */
router.get('/mcp/estado', autenticar, sesion('El servidor MCP se autentica con su propio token gtk_live_, no con la sesión del navegador. Cada token es de una cuenta y Claude actúa siempre sobre los eventos de su dueño.'), (req, res) => {
  res.json({
    ok: true,
    servidor: SERVIDOR,
    protocolo: PROTOCOLO,
    herramientas: TOOLS_MCP.length,
    cuenta: req.apiOwner,
    via: req.mcpVia,
  });
});

module.exports = router;

/* Para las pruebas: el protocolo se comprueba sin levantar el servidor ni
   tocar la base. */
module.exports._test = { manejar, toolsDe, comoMCP, PROTOCOLO, autenticar };
