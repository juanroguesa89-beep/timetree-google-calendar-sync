# TimeTree → Google Calendar

Sincronización unidireccional mediante GitHub Actions, sin ordenador encendido ni servicios de pago añadidos. Por seguridad se instala en **simulación**. No se ha ejecutado una sincronización real durante esta auditoría.

## Arquitectura y auditoría

Python `timetree-exporter==1.0.0` obtiene el calendario y genera ICS; TypeScript valida el archivo, consulta todos los eventos etiquetados en Google (con paginación), calcula diferencias y aplica altas y actualizaciones. Los identificadores y la huella de contenido persisten en `extendedProperties.private`; no se depende de la caché efímera de Actions.

Problemas encontrados: comparación incompatible de fechas/versiones que provocaba actualizaciones repetidas; cambios sin LAST-MODIFIED ignorados; registros con títulos y errores potencialmente sensibles; exportador sin timeout global; falta de pruebas; lotes truncados silenciosamente; excepciones recurrentes ignoradas; instalación Python sin versión fija; permisos excesivos en la documentación. Ya existían exclusión de ejecuciones simultáneas, secretos, simulación y bloqueo de borrados.

El exportador usa la API interna web de TimeTree (`/api/v1`, cookie de sesión), no una API pública con contrato estable. Inicia sesión con email/contraseña en cada ejecución; no necesita guardar ni renovar una cookie entre ejecuciones. Puede romperse por cambios de API, restricciones de cuenta o límites. No se garantiza que TimeTree entregue todos los registros. El adaptador `scripts/export.py` conserva esa autenticación, añade timeout HTTP, comprobación de estado y hasta tres reintentos GET ante fallos transitorios. No reintenta credenciales inválidas ni operaciones de login automáticamente. El proceso completo de exportación tiene 180 segundos de límite; Google tiene 30 segundos por petición y hasta tres reintentos del SDK. El job tiene 33 minutos de límite.

## Límites de integridad

- **No se borran eventos**, aunque desaparezcan de TimeTree. `ALLOW_DELETIONS` no habilita borrados. Las ausencias se cuentan como omitidas. Una exportación parcial nunca provoca borrado masivo.
- Un ICS válido vacío se distingue de un archivo inválido, pero ambos bloquean escrituras: sin metadatos fiables no se puede certificar que el calendario esté realmente vacío.
- Archivo truncado, registros incompletos, UID duplicados, fechas inválidas, horas sin zona, recurrencias, excepciones o cancelaciones explícitas abortan antes de escribir. El exportador omite cumpleaños y notas de tipo memo: no son eventos sincronizables en esta versión.
- RRULE, RDATE, EXDATE, RECURRENCE-ID y relaciones de recurrencia no están soportados de forma segura. Se bloquea la ejecución completa en lugar de crear series incorrectas. Las eliminaciones/cancelaciones que TimeTree omite del resultado permanecen en Google.
- Sólo se consultan/modifican eventos con la etiqueta de esta sincronización. Utiliza **un calendario Google dedicado y una sola fuente TimeTree**. No cambies el código de fuente conservando ese destino; crea otro destino. Los eventos heredados conservan sus IDs y reciben la nueva huella una vez.
- La huella compara título, descripción, ubicación, instantes, zonas horarias, día completo, recurrencia y categoría. No depende de LAST-MODIFIED. Los nuevos IDs Google derivan del UID: reintentar una inserción no crea un segundo ID. Un conflicto 409 requiere revisión o nueva ejecución; no se sobrescribe a ciegas. Los duplicados preexistentes bloquean el proceso.
- Fechas de día completo usan UTC y DTEND exclusivo. Se conservan instantes y zonas explícitas del ICS. Las horas flotantes se rechazan. Se mantienen los colores por categoría existentes.
- Más de 250 altas/actualizaciones abortan **antes de escribir**, sin lotes parciales silenciosos. Para una importación grande, revisa primero el dry-run y modifica `MAX_OPERATIONS` conscientemente.
- Google no ofrece una transacción para todo el lote. Si una operación falla, las exitosas quedan guardadas; el job falla y la próxima ejecución reanuda por diferencias. Una validación local no puede detectar todos los datos incorrectos que entregue la API interna.

Para sincronización completa con borrados/series hace falta una fuente con garantía de completitud y pruebas reales de excepciones: una suscripción ICS oficial si TimeTree la ofrece para tu cuenta, o una integración mantenida con un contrato fiable. Una suscripción directa desde Google es otra alternativa, con frecuencia de actualización controlada por Google. No se ha implementado ninguna alternativa ni servicio adicional.

## Configuración en GitHub

1. Activa Google Calendar API en un proyecto Google Cloud. Conserva la cuenta de servicio actual si funciona. Comparte **sólo el calendario destino** con esa cuenta, con permiso **Hacer cambios en eventos**, sin administrar el uso compartido. El código pide `calendar.events`, no acceso completo a Calendar. Google renueva automáticamente los tokens de acceso con la clave; la clave privada requiere rotación manual si expira o se compromete.
2. En Settings → Secrets and variables → Actions, crea estos **Secrets** (nunca pegarlos en issues, commits ni logs):

| Secret | Contenido |
|---|---|
| `TIMETREE_EMAIL` | Email TimeTree |
| `TIMETREE_PASSWORD` | Contraseña TimeTree |
| `TIMETREE_CALENDAR_CODE` | Código del calendario fuente |
| `GOOGLE_CALENDAR_ID` | ID del calendario destino dedicado |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | JSON de la cuenta de servicio codificado en base64 |

Base64 no cifra. Genera ese valor localmente (`base64 < clave.json`) y guárdalo sólo como secreto. El código de calendario se obtiene con el exportador existente en un terminal privado (`timetree-exporter`); puede mostrar nombres y códigos. No otorgues permisos extra a `GITHUB_TOKEN`: el workflow sólo usa `contents: read`.

3. Publica los cambios en la rama predeterminada del repositorio y habilita Actions.
4. Actions → **Sync TimeTree to Google Calendar** → **Run workflow** con `dry_run` marcado. Revisa los contadores del log y del resumen. No se publican títulos, ICS ni credenciales como artefactos.
5. Antes de activar escrituras, exporta el calendario Google desde su configuración y guarda esa copia en un lugar privado. Para autorizar la automatización crea una **variable** Actions `SYNC_ENABLED=true`. Las ejecuciones programadas escribirán desde entonces. Para una prueba manual real también debes desmarcar `dry_run`. Sin esa variable incluso las ejecuciones manuales permanecen en simulación.
6. Para pausar escrituras, elimina la variable o cambia su valor. También puedes deshabilitar el workflow.

No se han creado secretos, activado variables ni publicado cambios desde esta sesión.

## Horario, frecuencia y supervisión

El workflow dispara a las 04:00 y 05:00 UTC. El primer paso sólo permite sincronizar cuando la hora local `Europe/Madrid` es 06, cubriendo CET/CEST automáticamente. El otro disparo termina sin consultar servicios. GitHub puede retrasar/omitir ejecuciones: **06:00 es una hora objetivo, no una garantía**. Si se retrasa fuera de esa hora se omite; usa Run workflow para recuperar. Concurrencia fija y `cancel-in-progress: false` evitan solapamientos dentro de este repositorio; no ejecutes otra copia/localmente en paralelo.

Para modificar frecuencia edita conjuntamente el cron y el filtro horario de `.github/workflows/sync.yml`. Por ejemplo, cada hora: cron `0 * * * *` y elimina la condición de hora del filtro conservando `run=true`. Para otra hora diaria calcula sus dos equivalentes UTC y cambia el `06` del filtro. No existe un planificador local permanente.

Cada ejecución procesada registra `created`, `updated`, `deleted`, `skipped`, `errors`; el dry-run muestra además el plan de altas/actualizaciones/ausencias, con contadores aplicados en cero. Un error previo al plan informa cero operaciones y un error; si la infraestructura termina el job antes de iniciar Node, consulta el paso fallido. Los fallos de exportación/API se ocultan para no revelar datos personales.

En GitHub Settings → Notifications habilita avisos de Actions por email/web y, si está disponible, sólo fallos. Comprueba que tu cuenta recibe avisos de este workflow (GitHub puede asociar avisos del cron a quien lo modificó). No se añaden correos externos ni issues automáticos. En repositorios públicos GitHub puede desactivar cron tras 60 días sin actividad; revisa Actions periódicamente. Los minutos de Actions están sujetos al plan y cuotas de GitHub.

## Recuperación

Ante fallo, pausa `SYNC_ENABLED`, revisa el paso y ejecuta primero simulación. Corrige credenciales, fuente o duplicados antes de reactivar. Tras un fallo parcial se puede repetir: las altas exitosas se reconocen por UID/huella. No existe rollback transaccional; para revertir una actualización incorrecta usa tu exportación privada previa y revisa manualmente los eventos afectados en el calendario dedicado. No se guardan copias con datos personales en artefactos públicos ni en Git.

## Desarrollo y pruebas sin calendarios

```sh
npm ci
npm run typecheck
npm test
TZ=Pacific/Honolulu npm test
```

Las pruebas usan eventos ficticios y clientes simulados; no necesitan secretos. Comprueban idempotencia, cambios sin LAST-MODIFIED, duplicados, simulación, fechas de día completo durante cambio de horario, archivos truncados/vacíos y rechazo de recurrencias/cancelaciones.

Para ejecutar localmente instala Python 3.12 y `timetree-exporter==1.0.0`, configura los cinco valores correspondientes (la clave Google como ruta `GOOGLE_APPLICATION_CREDENTIALS`, no base64) y ejecuta `npm run sync` desde la raíz. Por defecto simula. Sólo `SYNC_DRY_RUN=false` junto con `SYNC_ENABLE_WRITE=YES_I_APPROVE` permite escrituras. No ejecutes localmente mientras Actions escribe. `ICS_FILE_PATH` permite cambiar el archivo temporal; cualquier archivo anterior en esa ruta se elimina antes de exportar.
