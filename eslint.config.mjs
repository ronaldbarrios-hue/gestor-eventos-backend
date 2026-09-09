import globals from 'globals';

/* Qué se revisa, y por qué tan poco.
 *
 * ── De dónde sale esto ───────────────────────────────────────────────────
 *
 * De un 500 en producción. En la rama de los registros GRATUITOS había escrito
 * `personasDeEspacio(espacioId)` con una variable que no existe en esa función:
 * leer una variable no declarada lanza `ReferenceError`, así que el registro
 * moría con un 500 sin JSON —después de haber insertado ya la boleta— y quien
 * se apuntaba quedaba apuntado viendo un error.
 *
 * Nada lo cazó: `node --check` sólo mira la sintaxis, `npm test` no ejecuta esa
 * ruta, y la rama sólo corre en un registro gratuito de verdad. El CI tenía un
 * paso «Revisar codigo (Lint)» con `--if-present`… y no existía el script, así
 * que llevaba desde siempre sin revisar nada.
 *
 * ── Por qué una lista corta y no un preset ───────────────────────────────
 *
 * Un preset entero sobre un repo de este tamaño saca cientos de avisos de
 * estilo, y un lint que grita por todo se apaga a la semana. Aquí van sólo las
 * reglas que cazan errores que YA se han cometido en este proyecto:
 *
 *   no-undef              lo único que FRENA, porque es lo único que aquí
 *                         siempre es un fallo: una variable que no existe
 *   no-use-before-define  aviso: `const` no se eleva, pero la regla no
 *                         distingue el caso peligroso del inofensivo
 *   no-dupe-keys          dos veces la misma clave: la segunda gana y la
 *                         primera desaparece sin aviso
 *   no-unsafe-optional-chaining  `(a?.b).c` revienta justo cuando `a` falta
 *   require-atomic-updates  un `await` en medio de un `x = x + 1`
 *
 * Si algún día conviene añadir estilo, va aparte y sin frenar el CI. Esto es
 * la red de los errores que rompen producción.
 */
export default [
  {
    files: ['**/*.js'],
    /* `.claude/**` lleva copias del propio repo (worktrees): sin esto, cada
       problema se reporta dos veces y el CI podría frenar por una copia. */
    ignores: ['node_modules/**', 'frontend/**', 'coverage/**', '.claude/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    linterOptions: {
      /* Un `eslint-disable` que ya no silencia nada se avisa: si no, la
         siguiente persona cree que ahí había un problema. */
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-undef': 'error',
      /* Aviso y no error, y con motivo: la regla no distingue una lectura de
         verdad adelantada —el `const` que se lee antes de existir, que revienta
         en ejecución y el build no ve— de una referencia hacia delante DENTRO
         de una función, que corre después y es segura. Casi todo lo que saca
         aquí es del segundo tipo. Frenar el CI por eso es cómo se apaga un
         lint a la semana; enseñarlo sirve para mirar el caso raro. */
      'no-use-before-define': ['warn', { functions: false, classes: true, variables: true }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unsafe-optional-chaining': 'error',
      /* También aviso: en Express, `req.apiOwner = ...` después de un `await`
         es la forma normal de pasar datos entre middlewares y la regla lo lee
         como carrera. El caso de verdad —dos peticiones tocando el mismo
         contador— se defiende en la BASE, con índices y funciones, no aquí. */
      'require-atomic-updates': 'warn',
      /* Una variable sin usar suele ser un renombrado a medias, y ése es el
         primo hermano del fallo de arriba. Se avisa y no se frena: hay bastantes
         de antes y bloquear el CI por ellas haría que nadie lo mirara.
         Los argumentos no se cuentan: `(req, res, next)` con `next` sin usar es
         la firma que Express exige. */
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
];
