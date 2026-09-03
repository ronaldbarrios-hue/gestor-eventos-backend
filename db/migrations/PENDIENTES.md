# Migraciones pendientes en Supabase

**No queda ninguna.** Comprobado contra la base de producción el **2026-09-03**.

| Nº | Qué hace | Estado |
|---|---|---|
| 0092 | Las zonas dejan `page_json` (paso 3 de 3) | ✅ aplicada el 2026-09-03 |
| 0093 | Un tipo de boleta declara qué crea al pagarse | ✅ aplicada el 2026-09-03 |
| 0094 | Una zona declara qué es (evento / ingreso / evacuación / otra) | ✅ aplicada el 2026-09-03 |
| 0095 | Cada torneo declara qué le pide a un equipo | ✅ aplicada el 2026-09-03 |
| 0096 | Las puertas pasan a ser zonas de tipo ingreso | ✅ aplicada el 2026-09-03 |

Este archivo se mantiene al día **a propósito**. Una lista de pendientes que
miente entrena a no creerla, y entonces el día que una haga falta de verdad,
nadie la cree. Ya pasó en este repo: siete migraciones decían «PENDIENTE DE
APLICAR» en su cabecera y cinco estaban aplicadas.

## Lo que se aprendió corriéndolas, y hay que respetar la próxima vez

**Fusionar no es desplegar.**

La 0092 tiene una condición previa que no se puede comprobar desde SQL: el
código que lee las zonas de la tabla tiene que estar **sirviendo**. Se corrió
con el PR ya fusionado… y el despliegue de cPanel iba por detrás, así que la API
seguía respondiendo con el código anterior.

Resultado: cuatro pantallas en blanco a la vez —Zonas del evento, el selector de
zona de un sub-evento, el escáner y el bloque de mapa de la landing— durante
horas, **sin un solo error en ninguna parte**. El síntoma de este proyecto,
otra vez: cuando el dato cambia de sitio y alguien sigue mirando el sitio viejo,
no falla nada; simplemente no hay nada.

**Cómo comprobarlo bien**, y son dos minutos:

```bash
curl -s https://api.gestekeventost.dpdns.org/eventos/publicos/slug/technova-summit-2026 | grep -o '"zonas"'
```

Si no imprime nada, la API **no** tiene el código nuevo, por más que `main` sí.
Contra la API desplegada, nunca contra la rama.

## La red de seguridad, mientras exista

`page_json.zonas_respaldo` sigue guardado en cada evento. Devuelve las zonas al
sitio viejo con una consulta, y con eso el código anterior vuelve a
encontrarlas:

```sql
update public.eventos
   set page_json = (page_json - 'zonas_respaldo')
                   || jsonb_build_object('zonas', page_json->'zonas_respaldo')
 where page_json ? 'zonas_respaldo';
```

Se borrará en una migración futura, cuando lleve semanas sin hacer falta. Un
jsonb con once objetos no le pesa a nadie; perder el plano de un evento en
marcha, sí.

## Lo que sigue esperando una decisión (no son de hoy)

- **0081** — borra columnas de datos de persona en `perfil_talento`. Es
  `DROP COLUMN`: revertirla **no devuelve los datos**, así que antes hay que ver
  cuántas filas los tienen rellenos.
- **0083** — migra `credenciales` → `wallet.variantes`. No corre riesgo, pero
  toca los 33 eventos. Hoy no rompe nada porque `walletVariantes()` traduce la
  forma vieja en caliente: **el fallback del código está haciendo el trabajo de
  la migración**.

## Cómo comprobar el estado en cualquier momento

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='ticket_types' and column_name='crea')            as m0093,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='zonas' and column_name='tipo')                   as m0094,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='event_form_fields' and column_name='torneo_id')  as m0095,
  (select count(*) from public.eventos where page_json ? 'zonas_respaldo')                       as m0092,
  (select count(*) from public.zonas where tipo = 'ingreso')                                     as m0096;
```
