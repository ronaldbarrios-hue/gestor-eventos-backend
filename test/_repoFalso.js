'use strict';

/* Un repositorio de mentira, en memoria, con la misma superficie que
   `modules/auth/repositorio.js`.
 *
 * Existe por la razón por la que existe la regla de que sólo el repositorio
 * toca la base: si el servicio hablara con MySQL, probarlo exigiría un MySQL
 * levantado, y las pruebas que exigen infraestructura son las que se acaban
 * saltando. Con esto, las decisiones —que es donde están los fallos que
 * importan— se prueban con `node --test` y nada más.
 *
 * No imita a MySQL: imita el CONTRATO. Si una función de aquí y la de verdad se
 * separan, las pruebas pasan y producción falla, así que cualquier cambio en
 * `repositorio.js` tiene que llegar también aquí.
 */

const crypto = require('crypto');

function crearRepoFalso({ usuarios = [] } = {}) {
  const estado = {
    usuarios   : new Map(),
    identidades: [],
    sesiones   : [],
    tokens     : [],
    correosEnviados: [],
  };

  const normalizar = (email) => String(email || '').trim().toLowerCase();

  for (const u of usuarios) {
    estado.usuarios.set(u.id, {
      intentosFallidos: 0, bloqueadoHasta: null, metadata: {}, emailConfirmado: true,
      passwordHash: null, ...u, email: normalizar(u.email),
    });
  }

  const repo = {
    _estado: estado,
    normalizar,

    async porEmail(email) {
      const e = normalizar(email);
      return [...estado.usuarios.values()].find(u => u.email === e) || null;
    },

    async porId(id) {
      return estado.usuarios.get(id) || null;
    },

    async porIdentidad(proveedor, proveedorId) {
      const i = estado.identidades.find(x => x.proveedor === proveedor && x.proveedorId === String(proveedorId));
      return i ? estado.usuarios.get(i.usuarioId) || null : null;
    },

    async crear({ id, email, passwordHash, metadata, emailConfirmado }) {
      const u = {
        id, email: normalizar(email), passwordHash: passwordHash || null,
        metadata: metadata || {}, emailConfirmado: Boolean(emailConfirmado),
        intentosFallidos: 0, bloqueadoHasta: null,
      };
      estado.usuarios.set(id, u);
      return u;
    },

    async actualizarPassword(usuarioId, passwordHash) {
      estado.usuarios.get(usuarioId).passwordHash = passwordHash;
    },

    async actualizarMetadata(usuarioId, metadata) {
      const u = estado.usuarios.get(usuarioId);
      u.metadata = metadata;
      return u;
    },

    async marcarConfirmado(usuarioId) {
      estado.usuarios.get(usuarioId).emailConfirmado = true;
    },

    async marcarAcceso(usuarioId) {
      const u = estado.usuarios.get(usuarioId);
      u.intentosFallidos = 0;
      u.bloqueadoHasta = null;
    },

    async sumarIntentoFallido(usuarioId, { maximo, bloqueoMinutos }) {
      const u = estado.usuarios.get(usuarioId);
      u.intentosFallidos += 1;
      if (u.intentosFallidos >= maximo) {
        u.bloqueadoHasta = new Date(Date.now() + bloqueoMinutos * 60000);
      }
    },

    async enlazarIdentidad({ usuarioId, proveedor, proveedorId, email }) {
      const ya = estado.identidades.some(x => x.proveedor === proveedor && x.proveedorId === String(proveedorId));
      if (!ya) estado.identidades.push({ usuarioId, proveedor, proveedorId: String(proveedorId), email });
    },

    async crearSesion({ usuarioId, refreshHash, expiraAt, userAgent, ip }) {
      const s = {
        id: estado.sesiones.length + 1, usuarioId, refreshHash,
        expiraAt, usadoAt: null, revocadoAt: null, reemplazadaPor: null, userAgent, ip,
        creadoAt: new Date(),
      };
      estado.sesiones.push(s);
      return { id: s.id };
    },

    async sesionPorHash(refreshHash) {
      return estado.sesiones.find(s => s.refreshHash === refreshHash) || null;
    },

    async rotarSesion({ sesionVieja, usuarioId, refreshHash, expiraAt, userAgent, ip }) {
      const nueva = await repo.crearSesion({ usuarioId, refreshHash, expiraAt, userAgent, ip });
      const vieja = estado.sesiones.find(s => s.id === sesionVieja);
      vieja.usadoAt = new Date();
      vieja.revocadoAt = new Date();
      vieja.reemplazadaPor = nueva.id;
      return nueva;
    },

    async revocarSesion(refreshHash) {
      const s = estado.sesiones.find(x => x.refreshHash === refreshHash);
      if (s && !s.revocadoAt) s.revocadoAt = new Date();
    },

    async revocarTodas(usuarioId) {
      let n = 0;
      for (const s of estado.sesiones) {
        if (s.usuarioId === usuarioId && !s.revocadoAt) { s.revocadoAt = new Date(); n += 1; }
      }
      return n;
    },

    async sesionesDe(usuarioId) {
      return estado.sesiones.filter(s => s.usuarioId === usuarioId && !s.revocadoAt);
    },

    async crearTokenUnUso({ usuarioId, tipo, tokenHash, expiraAt }) {
      for (const t of estado.tokens) {
        if (t.usuarioId === usuarioId && t.tipo === tipo && !t.usadoAt) t.usadoAt = new Date();
      }
      estado.tokens.push({ id: estado.tokens.length + 1, usuarioId, tipo, tokenHash, expiraAt, usadoAt: null });
    },

    async tokenPorHash(tokenHash) {
      return estado.tokens.find(t => t.tokenHash === tokenHash) || null;
    },

    async marcarTokenUsado(id) {
      const t = estado.tokens.find(x => x.id === id);
      if (!t || t.usadoAt) return false;
      t.usadoAt = new Date();
      return true;
    },
  };

  return repo;
}

/* Correos de mentira: en vez de mandar nada, guardan el token del enlace, que
   es lo que la prueba necesita para seguir el flujo como lo seguiría alguien
   abriendo su bandeja. */
function crearCorreosFalsos(estado) {
  return {
    async confirmacion(usuario, token) {
      estado.correosEnviados.push({ tipo: 'confirmacion', para: usuario.email, token });
    },
    async recuperacion(usuario, token) {
      estado.correosEnviados.push({ tipo: 'recuperacion', para: usuario.email, token });
    },
    async avisarIntentoDeRegistro(usuario) {
      estado.correosEnviados.push({ tipo: 'aviso_registro', para: usuario.email });
    },
  };
}

const uuid = () => crypto.randomUUID();

module.exports = { crearRepoFalso, crearCorreosFalsos, uuid };
