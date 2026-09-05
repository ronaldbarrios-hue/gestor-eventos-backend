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
