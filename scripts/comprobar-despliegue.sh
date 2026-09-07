#!/usr/bin/env bash
# ¿Está desplegado lo que está fusionado?
#
# Fusionar no es desplegar, y este repo ya lo pagó: la 0092 se corrió con el PR
# fusionado y sin desplegar, y dejó cuatro pantallas en blanco durante horas SIN
# UN SOLO ERROR. Esto pregunta a la API —no a `main`— por señales que sólo
# existen si el código nuevo está corriendo.
#
# Se preguntan LOS DOS servidores. La misma API vive en cPanel y en Render, se
# despliegan por separado, y uno puede quedarse atrás sin que nadie lo note: la
# respuesta útil no es «está desplegado», es «cuál no».
#
#   bash scripts/comprobar-despliegue.sh
#   API=https://otro.host bash scripts/comprobar-despliegue.sh   # sólo uno
#
# Ninguna comprobación escribe nada.
#
# ── AL SUBIR UNA TANDA, AÑADE AQUÍ SU SEÑAL ─────────────────────────────────
#
# Este archivo se queda viejo solo, y cuando se queda viejo MIENTE: contesta
# «al día» mirando lo que se desplegó hace un mes. Ya pasó — dijo que los dos
# servidores estaban al día mientras a cPanel le faltaba la rueda entera, y sólo
# se vio porque se preguntó a mano por una ruta de esta semana.
#
# Una señal buena es una ruta o un mensaje que ANTES no existía, que se puede
# pedir sin sesión y sin escribir nada. El patrón que mejor funciona: pedir algo
# inventado a una ruta nueva y pública. Si la ruta existe, contesta su propio
# «no lo encuentro»; si no existe, cae en el guardia genérico y contesta «Token
# requerido». Esa diferencia es la prueba.
set -u

HOSTS="${API:-https://api.gestekeventost.dpdns.org https://gestor-eventos-backend-yx75.onrender.com}"
mal=0

probar() {                       # probar <host> <qué> <url> <patrón> [método]
  local host="$1" que="$2" url="$3" patron="$4" metodo="${5:-GET}"
  local cuerpo
  cuerpo=$(curl -s -m 30 -X "$metodo" "$host$url" 2>/dev/null)
  if printf '%s' "$cuerpo" | grep -q "$patron"; then
    printf '  ok   %s\n' "$que"
  else
    printf '  NO   %s\n' "$que"
    printf '       esperaba /%s/ y llegó: %.110s\n' "$patron" "$cuerpo"
    mal=$((mal+1))
  fi
}

for api in $HOSTS; do
  echo "== $api"
  probar "$api" "responde" "/health" '"status":"ok"'

  # La ruta del cupo dice POR QUÉ no vale un enlace. Antes contestaba
  # `{"valida":false}` a secas y la página escribía la misma frase para tres
  # personas distintas — incluida la que ya había comprado.
  probar "$api" "el enlace de cupo dice el motivo" \
    "/eventos/publicos/cupo/tokenquenoexiste" '"motivo"'

  # Retomar un pago a medias. Sin la ruta, un POST con un código inventado cae
  # en el 401 del guardia genérico; con ella, contesta que no encuentra la
  # boleta — que es la prueba de que la ruta existe y es pública.
  probar "$api" "existe la ruta para retomar un pago" \
    "/eventos/publicos/ticket/CODIGOQUENOEXISTE/reanudar-pago" 'No encontramos esa boleta' POST

  # La agenda de una mesa (PR #46). Un código inventado en una ruta que EXISTE
  # contesta «Boleta no encontrada»; si la ruta no existe, cae en el guardia
  # genérico y contesta «Token requerido». Esa es toda la diferencia, y es la
  # que dice si este servidor tiene lo de la rueda.
  probar "$api" "la agenda de una mesa (rueda)" \
    "/eventos/publicos/expositor/CODIGOQUENOEXISTE/citas" 'Boleta no encontrada'
  echo
done

if [ "$mal" -eq 0 ]; then
  echo "Al día:$(printf ' %s' $HOSTS)"
else
  echo "$mal comprobación(es) en rojo."
  echo "cPanel:  Git Version Control → Deploy HEAD Commit. Ojo al paso 3 del"
  echo "         .cpanel.yml: sin el restart de Passenger el código nuevo está"
  echo "         en disco y el proceso viejo sigue atendiendo."
  echo "Render:  se despliega solo desde main; si está en rojo, mirar su log."
fi
exit "$mal"
