/* GESTEK — Agendar el evento en el calendario de quien recibe el correo.

   Por qué existe: el recordatorio masivo es el único envío que NO cabe. La
   boletería se reparte sola —la gente compra a lo largo de semanas— pero un
   «mañana es el evento» a 7.000 personas son 7.000 correos de golpe: 35 horas
   al tope de 200/hora de cPanel, y pasarse bloquea la cuenta.

   La salida es no mandarlo: si al comprar la boleta la persona agenda el evento
   en SU calendario, el recordatorio lo da su teléfono. No cuesta un envío, no
   depende de que nuestro correo llegue ese día, y es más fiable que cualquier
   cosa que hagamos nosotros.

   Dos piezas, y hacen falta las dos:

     · El enlace de Google Calendar — un clic, sin cuenta ni API nuestra. Pero
       sólo sirve a quien usa Google.
     · El archivo .ics adjunto — lo entienden Apple, Outlook, Google y
       cualquier otro, y es el único que puede llevar la ALARMA dentro. Ahí está
       la gracia: el aviso queda programado en el dispositivo al agendar.

   El .ics lleva dos alarmas, a un día y a una hora. Son las mismas que
   mandaría la plataforma, pero las da el teléfono. */

/* ── Fechas ─────────────────────────────────────────────────────────── */

/* Formato UTC del iCalendar: 20260915T140000Z */
function aUTC(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* Si el evento no dice cuándo termina se le dan dos horas. Un VEVENT sin DTEND
   lo interpretan distinto cada cliente, y algunos lo pintan de día completo. */
function finRazonable(inicio, fin) {
  if (fin) return fin;
  const d = new Date(inicio);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 2 * 3600 * 1000);
}

/* ── Texto del iCalendar ────────────────────────────────────────────── */

/* Escapado del RFC 5545: la coma y el punto y coma son separadores dentro del
   formato, así que sin escaparlos un lugar como «Calle 5, Bogotá» parte el
   campo y el archivo deja de abrir. */
function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/* Las líneas no pueden pasar de 75 octetos: se parten y la continuación
   empieza por un espacio. Se mide en BYTES, no en caracteres — con acentos y
   emojis contar caracteres se pasa del límite y Outlook rechaza el archivo. */
function plegar(linea) {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= 75) return linea;

  const partes = [];
  let inicio = 0;
  let limite = 75;
  while (inicio < bytes.length) {
    let corte = Math.min(inicio + limite, bytes.length);
    /* No partir a mitad de un carácter multibyte: se retrocede hasta el
       principio de la secuencia UTF-8. */
    while (corte > inicio && corte < bytes.length && (bytes[corte] & 0xc0) === 0x80) corte--;
    partes.push(bytes.slice(inicio, corte).toString('utf8'));
    inicio = corte;
    limite = 74;   // las continuaciones gastan un octeto en el espacio inicial
  }
  return partes.join('\r\n ');
}

/* Genera el .ics. Devuelve null si el evento no tiene fecha: un archivo de
   calendario sin cuándo no sirve de nada y es peor que no adjuntarlo. */
function generarICS({ evento, url, uid, descripcion }) {
  const inicio = aUTC(evento?.fecha_inicio);
  if (!inicio) return null;
  const fin = aUTC(finRazonable(evento.fecha_inicio, evento.fecha_fin));

  const lugar = evento.location_nombre || evento.location_direccion || '';
  const detalle = descripcion
    || [evento.descripcion, url].filter(Boolean).join('\n\n')
    || url || '';

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GESTEK//Event OS//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${esc(uid || `${evento.id}@gestek`)}`,
    `DTSTAMP:${aUTC(new Date())}`,
    `DTSTART:${inicio}`,
    ...(fin ? [`DTEND:${fin}`] : []),
    `SUMMARY:${esc(evento.titulo || 'Evento')}`,
    ...(detalle ? [`DESCRIPTION:${esc(detalle)}`] : []),
    ...(lugar ? [`LOCATION:${esc(lugar)}`] : []),
    ...(url ? [`URL:${esc(url)}`] : []),
    'STATUS:CONFIRMED',
    /* Las alarmas: esto es lo que sustituye al recordatorio por correo. */
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`Mañana: ${evento.titulo || 'tu evento'}`)}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${evento.titulo || 'Tu evento'} empieza en una hora`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  /* CRLF obligatorio por el RFC. Con \n suelto, Outlook no lo abre. */
  return lineas.map(plegar).join('\r\n') + '\r\n';
}

/* ── Google Calendar ────────────────────────────────────────────────── */

/* El template público de Google: no necesita cuenta nuestra ni API. Google no
   deja programar la alarma desde aquí —usa la que el usuario tenga por
   defecto—, y por eso el .ics sigue haciendo falta. */
function googleCalendarUrl({ evento, url }) {
  const inicio = aUTC(evento?.fecha_inicio);
  if (!inicio) return null;
  const fin = aUTC(finRazonable(evento.fecha_inicio, evento.fecha_fin));

  const p = new URLSearchParams({ action: 'TEMPLATE', text: evento.titulo || 'Evento' });
  const lugar = evento.location_nombre || evento.location_direccion || '';
  if (lugar) p.set('location', lugar);
  const detalle = [evento.descripcion, url].filter(Boolean).join('\n\n');
  if (detalle) p.set('details', detalle);
  p.set('dates', `${inicio}/${fin || inicio}`);

  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/* Lo que necesita el correo: el enlace, y el adjunto listo para nodemailer.
   Devuelve {} si el evento no tiene fecha, para poder esparcirlo sin más. */
function paraCorreo({ evento, url, uid }) {
  const ics = generarICS({ evento, url, uid });
  const google = googleCalendarUrl({ evento, url });
  if (!ics) return { google: google || '', adjuntos: [] };

  const nombre = `${(evento.slug || 'evento').replace(/[^a-z0-9-]/gi, '')}.ics`;
  return {
    google: google || '',
    adjuntos: [{
      filename: nombre,
      content: ics,
      /* `method=PUBLISH` y no REQUEST: REQUEST es una invitación que pide
         respuesta y algunos clientes la tratan como convocatoria del
         organizador, con su «¿asistirás?». Esto es un recordatorio, no una
         convocatoria. */
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    }],
  };
}

module.exports = { generarICS, googleCalendarUrl, paraCorreo };
