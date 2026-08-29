# Mover el backend de Render a cPanel

Es la fase 1.b, y es la que quita el congelamiento de la aplicación. No cambia
ni una línea de la interfaz.

## Por qué, en un párrafo

Render duerme el servicio del plan gratuito. Medido: **la primera petición
tarda 21,4 segundos y la segunda 0,19**. Veintiún segundos con la pantalla
quieta es exactamente lo que la gente describe como «se congela», y es también
el origen del sondeo cada 5 y 8 segundos que alguien puso para que no pasara —
sondeo que multiplicó las peticiones hasta las decenas de miles al día.

En cPanel el arranque en frío también existe, pero es despertar un proceso Node
con el disco caliente: del orden de un segundo, no de veintiuno.

Ya está comprobado que el servidor sirve: **Passenger 6.1.8** corriendo Node por
Application Manager, con dos aplicaciones registradas, y
`api.gestekeventost.dpdns.org/health` responde 200 en 0,78 s. Lo que **no** está
desplegado ahí es el backend completo: `/categorias` da 404.

---

## 1 · La aplicación en cPanel

**Setup Node.js App** → *Create Application*:

| Campo | Valor |
|---|---|
| Node.js version | 22.x (o la más nueva que ofrezca) |
| Application mode | Production |
| Application root | `api` (la carpeta donde va el repositorio) |
| Application URL | el subdominio de la API |
| **Application startup file** | **`app.js`** |

`app.js` y no `index.js`, y la diferencia importa: `index.js` abre el puerto a
mano y enciende el planificador de recordatorios dentro del proceso. En cPanel
las dos cosas están mal — el puerto lo pone Passenger, y del planificador habla
el punto 3.

Luego, en esa misma pantalla, **Run NPM Install**.

## 2 · Las variables

Las mismas que hay hoy en Render, en *Environment variables*. Passenger las lee
**al reiniciar la aplicación**, no al guardarlas: hay que pulsar *Restart*.

Las que no pueden faltar: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`QR_JWT_SECRET`, `FRONTEND_URL`.

> **`QR_JWT_SECRET` tiene que viajar idéntico.** Los QR ya emitidos se firmaron
> con él; si cambia, ninguna boleta valida en la puerta. Es el único secreto que
> se copia tal cual.

## 3 · Los recordatorios, al cron del panel

Hoy corren con `node-cron` dentro del proceso. En cPanel eso no vale:
**Passenger duerme la aplicación cuando nadie la usa**, y un planificador
dentro de un proceso dormido no corre. El fallo sería silencioso y sólo
aparecería con poca actividad — o sea de madrugada, que es cuando salen los
recordatorios del día siguiente.

**Cron Jobs** → dos entradas. La ruta de `node` se copia de *Setup Node.js App*
(el botón que da el comando de entrada al entorno virtual); **no** es el `node`
del sistema, que suele ser más viejo.

Cada quince minutos, los recordatorios:

```
*/15 * * * *   cd /home/CUENTA/api && /home/CUENTA/nodevenv/api/22/bin/node scripts/cron-recordatorios.js >> /home/CUENTA/logs/recordatorios.log 2>&1
```

Cada minuto, la cola de correo:

```
* * * * *      cd /home/CUENTA/api && /home/CUENTA/nodevenv/api/22/bin/node scripts/cron-cola.js >> /home/CUENTA/logs/cola.log 2>&1
```

La cola va aparte y cada minuto porque su gracia es repartir los envíos: a
ráfagas cada quince minutos, el proveedor de SMTP corta por spam.

Los dos scripts salen con código 1 si fallan, así que un fallo se ve en el
panel en vez de perderse en un log que nadie abre. Y el de la cola sólo escribe
cuando hay algo que decir: una línea por minuto son medio millón al año
diciendo «nada que hacer», en un disco de 9,81 GB compartido.

## 4 · El despliegue

Con **Git Version Control** de cPanel, el `.cpanel.yml` de este repositorio hace
el `npm ci` y reinicia Passenger al pulsar *Deploy HEAD Commit*.

Passenger reinicia cuando cambia `tmp/restart.txt`, que es lo que hace la última
línea del `.cpanel.yml`. Sin eso, el código nuevo está en el disco y el proceso
viejo sigue corriendo — y se pierde media hora buscando por qué el arreglo «no
subió».

## 5 · El cambio de dominio

Mientras Render siga en pie, los dos responden. El orden:

1. Desplegar en cPanel y comprobar contra su dominio directamente:
   `curl -s https://api.gestekeventost.dpdns.org/health` y
   `curl -s https://api.gestekeventost.dpdns.org/categorias` — el segundo tiene
   que devolver el catálogo, no un 404. Ése es el que dice si está desplegado el
   backend entero o sólo el «hola mundo» que hay hoy.
2. Cambiar `VITE_API_URL` en Vercel y volver a desplegar el frontend.
3. Mirar un rato. Si algo va mal, se devuelve la variable a Render: los dos
   siguen vivos.
4. Sólo cuando lleve unos días bien, apagar el de Render — y con él, sus crons.

> **Los dos a la vez, no.** Si Render y cPanel corren los recordatorios al mismo
> tiempo, cada asistente recibe dos correos. Al encender los crons de cPanel hay
> que apagar el servicio de Render o dejarlo sin las variables de correo.

## 6 · Lo que hay que mirar después

- **Si el congelamiento se acabó.** Es la pregunta que motivó todo esto. Con el
  backend despierto, ¿la interfaz sigue quedándose quieta tras un rato largo de
  uso? Si sí, además del arranque en frío hay algo en el navegador, y eso hay
  que buscarlo aparte.
- **Cuántas peticiones llegan de verdad.** Las ~70.000 de un día siguen sin
  medirse: no pasaron por Supabase. Con el backend en cPanel se ven en los logs
  de acceso del panel, que es la primera vez que ese número va a ser visible.
- **Que los recordatorios salen.** El primer ciclo después de configurarlos, y
  al día siguiente.
