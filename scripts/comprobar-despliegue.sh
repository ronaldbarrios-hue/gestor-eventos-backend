#!/usr/bin/env bash
# ¿Está desplegado lo que está fusionado?
#
# Fusionar no es desplegar, y este repo ya lo pagó: la 0092 se corrió con el PR
# fusionado y sin desplegar, y dejó cuatro pantallas en blanco durante horas SIN
# UN SOLO ERROR. Esto pregunta a la API —no a `main`— por señales que sólo
# existen si el código nuevo está corriendo.
#
#   bash scripts/comprobar-despliegue.sh
#
# Cada línea es una pregunta con respuesta sí/no. Ninguna escribe nada.
set -u
API="${API:-https://api.gestekeventost.dpdns.org}"
ok=0; mal=0

probar() {                       # probar <qué> <url> <patrón esperado> [método]
  local que="$1" url="$2" patron="$3" metodo="${4:-GET}"
  local cuerpo
  cuerpo=$(curl -s -X "$metodo" "$API$url" 2>/dev/null)
  if printf '%s' "$cuerpo" | grep -q "$patron"; then
    printf '  ok   %s\n' "$que"; ok=$((ok+1))
  else
    printf '  NO   %s\n' "$que"
    printf '       esperaba /%s/ y llegó: %.120s\n' "$patron" "$cuerpo"
    mal=$((mal+1))
  fi
}

echo "API: $API"
echo
echo "Vivo:"
probar "responde /health" "/health" '"status":"ok"'

echo
echo "Lo de esta tanda (si sale NO, falta desplegar):"

# La ruta del cupo dice POR QUÉ no vale un enlace. Antes contestaba
# `{"valida":false}` a secas y la página escribía la misma frase para tres
# personas distintas — incluida la que ya había comprado.
probar "el enlace de cupo dice el motivo" \
  "/eventos/publicos/cupo/tokenquenoexiste" '"motivo"'

# Retomar un pago a medias. Sin la ruta, un POST a un código inventado cae en
# el 401 del guardia genérico; con ella, contesta que no encuentra la boleta.
probar "existe la ruta para retomar un pago" \
  "/eventos/publicos/ticket/CODIGOQUENOEXISTE/reanudar-pago" 'No encontramos esa boleta' POST

echo
if [ "$mal" -eq 0 ]; then
  echo "Todo desplegado ($ok/$((ok+mal)))."
else
  echo "Faltan $mal de $((ok+mal)). En cPanel → Git Version Control → Deploy HEAD Commit,"
  echo "y comprobar que el paso 3 (el restart de Passenger) llegó a correr."
fi
exit "$mal"
