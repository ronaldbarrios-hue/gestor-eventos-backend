/* GESTEK — Conexiones propias del organizador.

   Rutas:
   - GET    /me/conexiones/ia          → estado, sin la llave
   - PUT    /me/conexiones/ia          → guardar (comprueba antes de escribir)
   - POST   /me/conexiones/ia/probar   → volver a comprobar la guardada
   - DELETE /me/conexiones/ia          → desconectar

   La llave NUNCA se devuelve, ni a su dueño. El panel enseña una pista
   («sk-ant-…4f2a») y la fecha de la última comprobación. Si la perdió, la
   regenera donde la generó — no somos su gestor de contraseñas.
*/

const express = require('express');
const { sesion } = require('../core/permisos');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const conexionIA = require('../lib/conexionIA.js');

const router = express.Router();

/* Igual que en mcp.js: este router se monta en '/', asi que el middleware va
   por ruta. Un router.use() aqui exigiria sesion a toda la API publica. */

router.get('/me/conexiones/ia', verifySupabaseJWT, sesion("La llave de IA que el usuario conecta a su cuenta. Sólo él la ve y sólo él la borra."), async (req, res) => {
  try {
    res.json(await conexionIA.verConexion(req.user.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/me/conexiones/ia', verifySupabaseJWT, sesion("La llave de IA que el usuario conecta a su cuenta. Sólo él la ve y sólo él la borra."), async (req, res) => {
  try {
    const r = await conexionIA.guardar(req.user.id, req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({
      ok: true,
      conexion: r.conexion,
      /* Se dice explícitamente de quién es el gasto: es la razón de existir de
         esta pantalla y conviene que nadie se lleve una sorpresa. */
      aviso: r.conexion?.ok
        ? 'Listo. El asistente correrá con tu cuenta de Anthropic, y el consumo se factura a tu cuenta, no a la plataforma.'
        : null,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/me/conexiones/ia/probar', verifySupabaseJWT, sesion("La llave de IA que el usuario conecta a su cuenta. Sólo él la ve y sólo él la borra."), async (req, res) => {
  try {
    res.json(await conexionIA.verificar(req.user.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/me/conexiones/ia', verifySupabaseJWT, sesion("La llave de IA que el usuario conecta a su cuenta. Sólo él la ve y sólo él la borra."), async (req, res) => {
  try {
    const r = await conexionIA.borrar(req.user.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, aviso: 'Desconectada. El asistente vuelve al motor de la plataforma, si hay alguno configurado.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
