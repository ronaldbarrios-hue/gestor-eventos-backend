# Migraciones pendientes en Supabase

Estado comprobado contra la base de producción el **2026-09-03**. Son cuatro, y
sólo una tiene condición previa.

| Nº | Qué hace | ¿Aplicada? | Condición previa |
|---|---|---|---|
| 0092 | Las zonas dejan `page_json` (paso 3 de 3) | **No** | Sí — leer abajo |
| 0093 | Un tipo de boleta declara qué crea al pagarse | **No** | Ninguna |
| 0094 | Una zona declara qué es (evento / ingreso / evacuación / otra) | **No** | Va después de la 0092 |
| 0095 | Cada torneo declara qué le pide a un equipo | **No** | Ninguna |

## Lo primero: las tres nuevas se pueden correr ya

**0093, 0094 y 0095 sólo AÑADEN.** No borran nada, no cambian ningún dato
existente y no alteran lo que hoy ve nadie: los eventos siguen funcionando igual
hasta que alguien use lo nuevo. El código desplegado funciona con y sin ellas
—sin ellas, las funciones nuevas simplemente no aparecen—, así que **el orden
entre desplegar y correr esto da igual**.

Todo junto, listo para pegar en **Supabase → SQL Editor → Run**:

    db/migrations/_pendientes_0093_0094_0095.sql

Es idempotente: correrlo dos veces no hace daño.

## La 0092 es la única con cuidado

`db/migrations/0092_zonas_contract.sql`

**Qué hace:** quita `page_json.zonas` del sitio donde lo busca el código y lo
guarda en `page_json.zonas_respaldo`. No borra: mueve.

**Por qué hay que mirar antes de correrla:** la comprobación no se puede hacer
desde SQL. Producción sirve el código que ya lee las zonas de la tabla, **o
no**, y esta migración da por hecho que sí. Si se corre antes de desplegarlo, el
plano de los eventos desaparece **en el momento**: sin error, sin aviso,
simplemente no hay zonas.

**Cómo comprobarlo, y son dos minutos:** entrar al panel desplegado, abrir
**Zonas del evento → Zonas de interés** y ver que las zonas siguen ahí. Si se
ven, el código nuevo está sirviendo.

**El estado hoy, medido:** las 11 zonas están en la tabla y las mismas 11 siguen
en el JSON —4 en TechNova Summit 2026, 7 en FESTECH IBAGUÉ—, así que la copia de
la 0091 está completa y la 0092 no perdería nada. Ningún evento tiene
`zonas_respaldo` todavía, que es como se sabe que no se ha corrido.

**Deshacerla es una consulta**, y está escrita al final del propio archivo.

## El orden, si se corre todo el mismo día

1. `_pendientes_0093_0094_0095.sql` — se puede ahora mismo.
2. Comprobar en el panel que las zonas se ven.
3. `0092_zonas_contract.sql`.

La 0094 va antes que la 0092 en esa lista y no pasa nada: sólo añade una columna
con valor por defecto y no toca `page_json`. Lo que **no** se puede hacer todavía
es mover las puertas a zonas de tipo ingreso —el paso de datos de Q6—, y ese
paso no está escrito aún: cada puerta arrastra su conteo de ingresos
(`ticket_movimientos.zona_id`) y hay que mirar evento por evento. Hoy hay una
sola puerta, en TechNova.

## Cómo saber si ya están puestas

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='ticket_types' and column_name='crea')            as m0093,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='zonas' and column_name='tipo')                   as m0094,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='event_form_fields' and column_name='torneo_id')  as m0095,
  (select count(*) from public.eventos where page_json ? 'zonas_respaldo')                       as m0092;
```

Un `1` en las tres primeras y un número mayor que cero en la última significa que
está todo aplicado.
