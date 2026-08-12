/* GESTEK — La configuración del sitio público de un evento.

   Contexto (migración 0064): `eventos.page_json` era un JSON compartido donde
   vivían quince cosas, y cada pantalla lo escribía ENTERO partiendo de su
   copia en memoria del evento. Si dos guardaban, la segunda borraba lo de la
   primera. Así se borraba la marca sola.

   La marca, las páginas y el navbar salieron a columnas propias. Este módulo
   es el único sitio que sabe cómo conviven las columnas nuevas con el JSON
   viejo, para que ninguna ruta tenga que acordarse:

     · `conSitio(evento)`  — al LEER: devuelve el evento con `page_json`
       completo (columnas incluidas), para que ningún lector existente se
       entere del cambio.
     · `partirSitio(updates, actual)` — al ESCRIBIR: saca del `page_json`
       entrante las tres claves que ahora son columnas, y MEZCLA el resto por
       claves de primer nivel en vez de reemplazarlo.

   La mezcla es la otra mitad del arreglo. Con ella, una pantalla que manda
   sólo `{seo: …}` no puede borrar `{checkout: …}` aunque su copia del evento
   sea de hace media hora. */

'use strict';

const CLAVES_PROPIAS = [
  ['branding', 'branding'],   // page_json.branding → columna branding
  ['pages',    'paginas'],    // page_json.pages    → columna paginas
  ['navbar',   'navbar'],     // page_json.navbar   → columna navbar
];

function esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/* Lectura: el evento tal cual, más un `page_json` que incluye lo que ahora
   vive en columnas. Los lectores viejos (`evento.page_json.branding`) siguen
   funcionando; los nuevos leen la columna y da lo mismo.

   La columna gana SIEMPRE, incluso vacía. La 0064 sacó las tres claves del
   JSON justamente para que no hubiera dos copias que comparar: si alguien
   borra su marca a propósito, tiene que quedarse borrada, y una regla del
   tipo "si la columna está vacía usa la del JSON" la resucitaría.

   Si la 0064 no está aplicada, las columnas no existen, `valor` es
   `undefined` y el `page_json` sale tal cual estaba: sigue funcionando. */
function conSitio(evento) {
  if (!evento || typeof evento !== 'object') return evento;

  const base = esObjetoPlano(evento.page_json) ? evento.page_json : {};
  const page_json = { ...base };

  for (const [clave, columna] of CLAVES_PROPIAS) {
    if (!(columna in evento)) continue;          // columna no pedida en el select
    const valor = evento[columna];
    if (valor === undefined || valor === null) continue;
    page_json[clave] = valor;
  }

  return { ...evento, page_json };
}

function listaConSitio(eventos) {
  return (eventos || []).map(conSitio);
}

/* Escritura. Devuelve los `updates` listos para el UPDATE:

   · Lo que llegue como columna (`branding`, `paginas`, `navbar`) se guarda tal
     cual. Es el único camino por el que se escriben.
   · Si viene `page_json` con `branding` / `pages` / `navbar` dentro, se
     DESCARTAN. No se ascienden a la columna, y ésta es la decisión importante
     de todo el arreglo — está explicada abajo.
   · Lo que quede de `page_json` se MEZCLA sobre lo guardado, clave a clave de
     primer nivel. Una pantalla que manda sólo lo suyo ya no borra lo demás.

   ── Por qué se descartan y no se ascienden ──

   Trece pantallas guardan hoy con el patrón `{...evento.page_json, loMio}`.
   Ese `evento.page_json` viene de la API, que lo sirve con la marca y las
   páginas metidas dentro por compatibilidad. Si al guardar se ascendiera esa
   copia a las columnas, cada una de esas trece pantallas escribiría su
   fotografía —posiblemente de hace media hora— encima de la marca buena.

   Es decir: ascender reconstruiría EXACTAMENTE el fallo que la 0064 viene a
   arreglar, sólo que con trece culpables en vez de dos.

   El precio de descartar es que un cliente muy viejo, que sólo supiera
   guardar la marca dentro del JSON, dejaría de guardarla. Se acepta a
   conciencia: no guardar se ve y se reintenta; borrar sin avisar no se ve
   hasta que alguien abre la página pública y la marca ya no está.

   `actual` es el `page_json` que hay hoy en la base. Si no se pasa, no hay
   con qué mezclar: quien llame tiene que leerlo antes. */
function partirSitio(updates, actual) {
  const salida = { ...updates };

  if ('page_json' in salida) {
    const entrante = esObjetoPlano(salida.page_json) ? { ...salida.page_json } : {};

    for (const [clave] of CLAVES_PROPIAS) delete entrante[clave];

    const previo = esObjetoPlano(actual) ? actual : {};
    /* Las copias legadas que la 0064 dejó dentro del JSON se conservan tal
       cual (vienen de `previo`): son el respaldo de los lectores viejos y no
       las toca nadie. */
    salida.page_json = { ...previo, ...entrante };
  }

  return salida;
}

module.exports = { conSitio, listaConSitio, partirSitio, CLAVES_PROPIAS };
