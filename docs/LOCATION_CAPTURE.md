## Formato sencillo recomendado

En el mismo POST /capture-events, envía `latitude` y `longitude` directamente como números. No envíes la dirección como sustituto de las coordenadas.

```json
{"eventId":"sms-ejemplo-unico","source":"sms","observedAt":"2026-10-20T12:00:00-05:00","message":"TEXTO ORIGINAL DEL SMS","latitude":4.6,"longitude":-74.1}
```

Opcionalmente `location` puede ser el texto de la dirección y `locationObservedAt` la hora real de la muestra. Sin esta última se muestra la hora del evento como tal, sin presentarla como hora exacta de la muestra. Pares incompletos o inválidos se omiten sin impedir guardar el evento. El formato detallado sigue siendo compatible.

La edición manual muestra enlace, latitud, longitud y mapa cuando no hay ubicación. Si ya hay datos, muestra el nombre del lugar y el mapa, con **Ver en Google Maps** y **Editar ubicación**. Este último abre los campos y las opciones para recordar o aplicar el lugar a otros movimientos; **Listo** vuelve a la vista compacta. Los enlaces compatibles se resuelven al pegarlos o salir del campo. Un enlace sin coordenadas resolubles muestra un error y permite entrada manual. La ubicación actual solo se solicita al pulsar el botón y nunca se obtiene automáticamente.

# Ubicación en SMS y Wallet

El atajo envía una única solicitud `POST /capture-events`, autenticada con el mismo token revocable del dispositivo. `location` es un diccionario opcional dentro del JSON del evento; no existe una llamada separada para agregar ubicación.

## Configuración del atajo

1. Conserva el EventId estable y los datos originales del SMS o Wallet.
2. Intenta una sola muestra con **Obtener ubicación actual**. Usa **Obtener detalles de ubicaciones** sobre esa misma variable para extraer sus propiedades.
3. Guarda la fecha de la muestra en ISO 8601 como `location.observedAt`, separada de la fecha del movimiento y del `observedAt` del evento.
4. Crea `location` como diccionario: `latitude` y `longitude` deben ser números; `observedAt`, texto. Agrega solo los componentes disponibles. La precisión en metros es opcional; no todos los dispositivos la exponen.
5. Incluye el diccionario dentro del mismo cuerpo JSON enviado a `/capture-events`. Si no hay muestra válida, omite `location`. No uses coordenadas cero ni precisión cero como valores de reemplazo.
6. En un reintento conserva exactamente el EventId y el JSON original, incluida la muestra. Cambiar la ubicación bajo el mismo EventId produce un conflicto de idempotencia; no tomes otra muestra durante un reintento.

El formato ISO 8601 de Atajos puede terminar en `-0500`; la API también acepta esa variante y la normaliza a `-05:00`.

Ejemplo sintético del cuerpo de una única solicitud:

```json
{
  "eventId": "sms-location-demo",
  "source": "sms",
  "observedAt": "2026-10-20T12:00:00-05:00",
  "message": "Bancolombia: Compraste $22.000,00 en COMERCIO DE PRUEBA con tu T.Deb *1122, el 20/10/2026 a las 12:00.",
  "location": {
    "latitude": 4.6,
    "longitude": -74.1,
    "observedAt": "2026-10-20T12:00:02-05:00",
    "fullAddress": "Calle de Prueba 10, Ciudad de Prueba, Colombia",
    "street": "Calle de Prueba",
    "streetNumber": "10",
    "city": "Ciudad de Prueba",
    "state": "Departamento de Prueba",
    "postalCode": "000000",
    "region": "Región de Prueba",
    "country": "Colombia",
    "countryCode": "CO"
  }
}
```

También se admiten `name`, `accuracy` y `url`. Para un enlace de Apple Maps usa **Obtener URL de Mapas**: la propiedad URL de una ubicación puede ser otro enlace. Se conserva como enlace recibido, sin asumir que identifica un comercio. La app genera enlaces independientes a Apple Maps y Google Maps directamente desde latitud/longitud.

## Permisos y captura financiera

En el servidor, una ubicación inválida o ausente no impide guardar un evento financiero válido. Los componentes opcionales inválidos se omiten; no se inventan valores. OTP y mensajes de seguridad siguen rechazándose antes de persistir.

Esto no garantiza que iOS continúe un atajo tras fallar **Obtener ubicación actual**. La prueba de `IOS_CAPTURE_SPIKE.md` debe comprobar permisos denegados, teléfono bloqueado y demoras antes de activar el bloque. Si la acción detiene el atajo antes del envío, desactiva ese bloque hasta resolverlo: el envío financiero debe seguir funcionando sin ubicación. No se ha demostrado un mecanismo universal de timeout o captura de errores de Atajos en el teléfono del propietario.

## Mapa en la app

El mapa principal utiliza MapLibre GL JS 6 (con su worker empaquetado por Vite usando `?worker&url`) y se carga al abrir la ubicación de un movimiento. Sin configuración adicional usa teselas raster de OpenStreetMap con atribución visible. No necesita token de Apple Maps ni clave de Google. Los marcadores azules representan muestras del teléfono y el verde un negocio previamente confirmado por el usuario. El mapa no solicita una nueva ubicación al navegador ni infiere el comercio.

`VITE_MAP_STYLE_URL` permite usar un estilo JSON HTTPS de otro proveedor compatible. Es configuración pública del frontend; cualquier token incluido debe ser público y restringido por el proveedor. El proveedor recibe las solicitudes de teselas/estilo del área mostrada, no el SMS ni los datos financieros. Las solicitudes de mapa envían solo el origen como referencia entre sitios, respetan la caché HTTP normal y no se guardan en el service worker. No se implementan precargas masivas ni mapas sin conexión. El propietario debe elegir un proveedor adecuado a su volumen y sus términos.

Si no hay conexión, falla el proveedor o WebGL no está disponible, la dirección, coordenadas, fecha y enlaces siguen visibles y el movimiento puede guardarse. No se necesita una clave de Google para mostrar el mapa o resolver los enlaces compatibles.

## Trazabilidad

La ubicación pertenece a cada observación, no a la identidad del comercio. Se conserva al conciliar SMS, Wallet y extractos. CSV/XLSX conserva `Ubicaciones` y agrega `DetalleUbicaciones`, un JSON con cada observación, sus campos originales, su precisión si existe y los enlaces por coordenadas. Una captura tardía o una dirección postal no confirma el lugar de compra.

Fuentes: [MapLibre raster sources](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), [Apple Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

## Elegir o corregir el lugar de un movimiento

La misma sección **Ubicación y negocio** está disponible al crear un movimiento manual, editar uno guardado o usar **Editar antes de guardar** en Revisión. Puede elegirse otro lugar aunque el SMS ya tenga coordenadas: la muestra original, su dirección y su fecha siguen asociadas a la observación. El lugar confirmado se guarda aparte en `transaction.place`.

MapLibre representa el mapa; no incluye un directorio de comercios. El editor vacío muestra enlace de Google Maps, latitud, longitud y mapa; una ubicación configurada usa la vista compacta descrita arriba. Al pegar el enlace o salir del campo se preparan las coordenadas; guardar el movimiento persiste la selección. Si no hay coordenadas se ofrece **Usar mi ubicación**, siempre por acción explícita y con permiso del navegador.

Se interpretan enlaces completos con coordenadas de la ficha o consultas de coordenadas. Una URL que solo contiene `@latitud,longitud` o un centro de mapa se marca como aproximada y requiere confirmación explícita: el centro de la cámara puede no ser el comercio. No se adivinan lugares a partir de rutas con múltiples destinos o enlaces ambiguos.

Los enlaces cortos se resuelven mediante `POST /places/resolve-link`, exclusivo de la sesión del propietario. No usa el token del Shortcut. Sigue como máximo cinco solicitudes HTTPS entre dominios admitidos de Google Maps, con ocho segundos de límite total. Si la URL no contiene coordenadas explícitas, el servidor obtiene el identificador `ftid` o `cid` y consulta la ficha pública incrustada correspondiente a ese CID. `htmlparser2` lee una respuesta limitada a 256 KiB y extrae únicamente el JSON de `initEmbed`, sin ejecutar JavaScript. Las coordenadas solo se aceptan de la tupla de entidad cuyo feature ID y CID coincidan con el enlace. El CID se convierte con BigInt para preservar sus 64 bits. Identidades o puntos contradictorios se rechazan.

**Nunca usar `og:image`, el centro de un mapa estático, el estado de la cámara ni la ubicación del servidor para inferir el comercio.** Esos centros pueden ser genéricos y marcar otro país. Los centros escritos explícitamente en una URL por el usuario siguen siendo aproximados y requieren confirmación; un centro genérico obtenido al resolver un enlace corto se rechaza. El servidor no ejecuta scripts, descarga imágenes, sigue enlaces del HTML ni envía SMS o movimientos al proveedor. No se guardan los HTML ni los datos de la ficha.

Si Google devuelve consentimiento, CAPTCHA, una respuesta de error o datos de entidad ausentes/ambiguos, se ofrece introducir coordenadas manualmente y se conserva la selección anterior. El formato no es una API estable: si cambia, fallar sin inventar un punto. Las pruebas usan entidades y URLs sintéticas, con un centro genérico de otro país para comprobar que se ignora. No guardar enlaces personales ni páginas reales en Git.

Los lugares guardados antes de esta corrección no se modifican automáticamente: el usuario puede volver a pegar el enlace en el editor y guardar el punto verificado. La evidencia original del atajo se mantiene intacta.

## Ubicación recordada por comercio

El editor ofrece **Recordar esta ubicación para próximos movimientos de este comercio** cuando hay un lugar elegido. La regla usa el mismo nombre normalizado que las categorías (NFKC, espacios y mayúsculas), y guarda `MerchantRule.place` separadamente de categoría, nota e inversión. Guardar una categoría conserva el lugar recordado; recordar solo un lugar no crea reglas de categoría, nota ni inversión.

Al editar un movimiento también puede marcarse **Aplicar esta ubicación a todos los movimientos de este comercio**. Sustituye el lugar elegido en los movimientos activos de ese nombre, incluidos los que ya tenían otro punto, sin cambiar la regla futura salvo que se marque también la opción de recordarla. Cada modificación tiene revisión y auditoría; se procesa en bloques de 35 para respetar los límites de DynamoDB. No cambia importes, cuentas, categorías ni notas salvo que se seleccione también la opción correspondiente. No modifica movimientos eliminados ni `Observation.location`.

Usar la opción global solo cuando el nombre identifica la misma sede. El lugar recordado se propone en movimientos manuales y al editar capturas; una elección específica tiene prioridad. **Quitar lugar** permite guardar ese movimiento sin la ubicación recordada y mantiene la regla para otros movimientos. Las capturas de SMS/Wallet usan la regla al registrar el movimiento; la ubicación del teléfono se conserva como evidencia separada y nunca se convierte automáticamente en regla de comercio.

CSV/XLSX incluye la ubicación recordada en la observación de la vista previa y mantiene esa elección al confirmar, incluso si la regla cambia después de revisar el archivo. Las reglas permanecen dentro del hogar del usuario. Ninguna regla se aplica automáticamente a movimientos históricos: se requiere seleccionar la opción de aplicarla a todos.

## Nombre del lugar y acceso a Google Maps

Los enlaces verificados guardan el nombre extraído de la misma entidad de Google en `TransactionPlace.name`; se prefiere su nombre comercial a la dirección completa. Los enlaces completos pueden aportar el nombre de su ruta `/maps/place/...`. Si no existe un nombre verificable, se conserva el nombre previo o un rótulo genérico. Seleccionar una ubicación no cambia automáticamente `transaction.merchant`: el descriptor financiero sigue siendo editable por el usuario y es la clave de sus reglas por comercio.

**Ver en Google Maps** permanece disponible tanto en la vista compacta como durante la edición, incluso si falla el mapa. Usa el enlace de Google validado cuando corresponde al lugar elegido, o un enlace generado por coordenadas; las capturas del teléfono mantienen además sus enlaces originales dentro de su desplegable de evidencia.
