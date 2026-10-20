## Formato sencillo recomendado

En el mismo POST /capture-events, envía `latitude` y `longitude` directamente como números. No envíes la dirección como sustituto de las coordenadas.

```json
{"eventId":"sms-ejemplo-unico","source":"sms","observedAt":"2026-10-20T12:00:00-05:00","message":"TEXTO ORIGINAL DEL SMS","latitude":4.6,"longitude":-74.1}
```

Opcionalmente `location` puede ser el texto de la dirección y `locationObservedAt` la hora real de la muestra. Sin esta última se muestra la hora del evento como tal, sin presentarla como hora exacta de la muestra. Pares incompletos o inválidos se omiten sin impedir guardar el evento. El formato detallado sigue siendo compatible.

La edición manual presenta enlace, latitud, longitud y mapa; los enlaces compatibles se resuelven al pegarlos o salir del campo. Un enlace sin coordenadas resolubles muestra un error y permite entrada manual. La ubicación actual solo se solicita al pulsar el botón y nunca se obtiene automáticamente.

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

Si no hay conexión, falla el proveedor o WebGL no está disponible, la dirección, coordenadas, fecha y enlaces siguen visibles y el movimiento puede guardarse. La búsqueda existente de negocios de Google continúa como opción independiente y solo carga al expandirla; requiere la configuración descrita en `GOOGLE_MAPS.md`.

## Trazabilidad

La ubicación pertenece a cada observación, no a la identidad del comercio. Se conserva al conciliar SMS, Wallet y extractos. CSV/XLSX conserva `Ubicaciones` y agrega `DetalleUbicaciones`, un JSON con cada observación, sus campos originales, su precisión si existe y los enlaces por coordenadas. Una captura tardía o una dirección postal no confirma el lugar de compra.

Fuentes: [MapLibre raster sources](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), [Apple Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

## Elegir o corregir el lugar de un movimiento

La misma sección **Ubicación y negocio** está disponible al crear un movimiento manual, editar uno guardado o usar **Editar antes de guardar** en Revisión. Puede elegirse otro lugar aunque el SMS ya tenga coordenadas: la muestra original, su dirección y su fecha siguen asociadas a la observación. El lugar confirmado se guarda aparte en `transaction.place`.

MapLibre representa el mapa; no incluye un directorio de comercios. La opción universal es escribir comercio/ciudad, abrir **Buscar en Google Maps**, copiar el enlace del resultado y pegarlo en **Enlace de Google Maps**. **Leer enlace** prepara las coordenadas y el nombre para revisarlos. **Usar este lugar** confirma la selección en el formulario; los cambios solo se persisten al guardar el movimiento. También se pueden escribir nombre, dirección y coordenadas manualmente. La búsqueda integrada de Google sigue disponible cuando hay una clave configurada.

Se interpretan enlaces completos con coordenadas de la ficha o consultas de coordenadas. Una URL que solo contiene `@latitud,longitud` o un centro de mapa se marca como aproximada y requiere confirmación explícita: el centro de la cámara puede no ser el comercio. No se adivinan lugares a partir de rutas con múltiples destinos o enlaces ambiguos.

Los enlaces cortos se resuelven mediante `POST /places/resolve-link`, exclusivo de la sesión del propietario. No usa el token del Shortcut. Solo sigue redirecciones HTTPS entre dominios admitidos de Google Maps, con límite de saltos y tiempo; no descarga ni interpreta páginas de lugares, ni acepta destinos arbitrarios. Algunos enlaces usan JavaScript, consentimiento o identificadores sin coordenadas: si no pueden resolverse, la interfaz pide la URL completa o coordenadas manuales y conserva cualquier selección existente.

El lugar guarda `source` (`google`, `google-link` o `manual`) y, cuando procede, la URL de origen. Los lugares antiguos sin `source` conservan su compatibilidad con Google. Los ID locales por coordenadas nunca se envían como Google Place ID. Los exports incluyen `OrigenLugar` y `EnlaceLugar` junto con el lugar confirmado y la evidencia original del teléfono.
