/* Que el barrido de OAuth siga estando enchufado a un cron.
 *
 * `public.oauth_barrer()` existe desde la 0073 y su cabecera dice que la
 * llamaría «el backend en el mismo ciclo que ya corre cada quince minutos».
 * Ese paso no se dio: la función quedó en la base sin que nadie la llamara y
 * `oauth_codes` / `oauth_tokens` crecieron sin límite durante meses.
 *
 * Es la deuda más silenciosa que hay: no falla nada, no aparece en ningún log,
 * sólo engorda una tabla que nadie mira. Por eso se comprueba desde fuera —una
 * función escrita y no llamada vuelve a pasar desapercibida—.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

test('alguien llama al barrido de OAuth', () => {
  const dir = path.join(RAIZ, 'scripts');
  const crons = fs.readdirSync(dir).filter(f => /^cron-.*\.js$/.test(f));
  assert.ok(crons.length >= 2, `sólo veo ${crons.length} crons: revisa la prueba`);

  const llaman = crons.filter(f => /barrerOauth\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(
    llaman.length > 0,
    'ningún cron llama a barrerOauth(): oauth_codes y oauth_tokens vuelven a crecer sin límite',
  );
});

test('el barrido no puede tumbar el ciclo que lo lleva', () => {
  /* Va de pasajero en el cron de recordatorios, que es lo que la gente nota si
     falla. Perder un ciclo de correos porque no se pudo borrar un token
     caducado sería cambiar un problema silencioso por uno visible. */
  const dir = path.join(RAIZ, 'scripts');
  for (const f of fs.readdirSync(dir).filter(x => /^cron-.*\.js$/.test(x))) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/barrerOauth\s*\(/.test(txt)) continue;
    const i = txt.search(/barrerOauth\s*\(/);
    /* El `try` que lo envuelve tiene que estar cerca, no al principio del
       archivo envolviéndolo todo. */
    const antes = txt.slice(Math.max(0, i - 200), i);
    assert.match(antes, /try\s*\{/, `${f} llama a barrerOauth() sin envolverlo en su propio try`);
  }
});

test('el nombre de la función SQL no se inventa', () => {
  /* Si alguien renombra la función en una migración y no aquí, el RPC falla en
     silencio cada quince minutos y nadie lo ve hasta que la tabla pesa. */
  const lib = fs.readFileSync(path.join(RAIZ, 'lib', 'oauthBarrido.js'), 'utf8');
  const m = lib.match(/rpc\('([\w_]+)'\)/);
  assert.ok(m, 'no encuentro la llamada rpc() del barrido');

  const migraciones = fs.readdirSync(path.join(RAIZ, 'db', 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .map(f => fs.readFileSync(path.join(RAIZ, 'db', 'migrations', f), 'utf8'))
    .join('\n');
  assert.match(
    migraciones, new RegExp(`function\\s+public\\.${m[1]}\\s*\\(`),
    `el backend llama a ${m[1]}() y ninguna migración la define`,
  );
});
