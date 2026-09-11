'use strict';

/* Qué commit está corriendo, en un solo sitio.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────
 *
 * Hay dos despliegues del mismo backend —Render y cPanel— y nada avisa
 * cuando dejan de coincidir. El síntoma no es un error: es que el mismo
 * clic funciona en uno y en el otro no, y nadie se entera de que está
 * hablando con el servidor viejo hasta que ya perdió una hora buscando por
 * qué "no se ve el cambio de ayer".
 *
 * Esto responde una sola pregunta —¿qué commit hay aquí?— sin tener que
 * entrar a mirar archivos. `GET /health` la expone; comparar Render contra
 * cPanel es entonces dos peticiones, no una sesión de SSH.
 *
 * ── Por qué el orden importa ────────────────────────────────────────────
 *
 * 1. `RENDER_GIT_COMMIT` — Render la pone sola, sin configurar nada. Si
 *    existe, es la respuesta correcta y no hay más que mirar.
 *
 * 2. `COMMIT.txt` en la raíz — esto es lo que hace falta en cPanel. El
 *    despliegue de cPanel (`.cpanel.yml`) copia el código con `rsync
 *    --exclude ".git"`, así que en el servidor NO hay repositorio: no se
 *    puede preguntar a git qué commit es porque git no está. La solución no
 *    es llevarse el `.git` (pesa, y el `.env` real vive fuera de él pero el
 *    hábito de copiar todo es como se cuelan cosas que no deberían),
 *    sino escribir el commit en un archivo de texto ANTES del rsync, en el
 *    paso de despliegue, cuando el `.git` todavía existe del lado del
 *    origen. Un `.txt` no está en la lista de exclusión y viaja con el
 *    resto del código.
 *
 * 3. `git rev-parse HEAD` en vivo — cuando se corre en local, con el
 *    repositorio completo a mano. Nunca pasa en producción por lo de
 *    arriba, pero es lo que se espera al probar esto en el portátil.
 *
 * 4. `'desconocido'` — si ninguna de las tres respondió, se dice así en vez
 *    de mentir con un valor fijo. Un `/health` que siempre contesta la
 *    misma cadena, venga lo que venga, es peor que uno que admite que no
 *    sabe: el primero parece que funciona y no está comprobando nada. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function leerCommitTxt() {
  try {
    const crudo = fs.readFileSync(path.join(RAIZ, 'COMMIT.txt'), 'utf8').trim();
    return crudo || null;
  } catch {
    return null; // no existe: normal en Render, y en local si nadie lo generó a mano.
  }
}

function leerGitEnVivo() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || null;
  } catch {
    return null; // sin `.git` (cPanel lo excluye a propósito) o sin `git` instalado.
  }
}

/* El commit desplegado aquí, o `null` si de verdad no hay forma de saberlo. */
function commitDesplegado() {
  return (
    process.env.RENDER_GIT_COMMIT
    || leerCommitTxt()
    || leerGitEnVivo()
    || null
  );
}

/* Corto, para mostrar: los primeros 7, que es lo que ya usa git para
   distinguir un commit de otro en el uso diario. */
function commitCorto() {
  const c = commitDesplegado();
  return c ? c.slice(0, 7) : 'desconocido';
}

module.exports = { commitDesplegado, commitCorto };
