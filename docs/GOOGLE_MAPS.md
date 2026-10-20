# Mapas y enlaces de Google Maps

El mapa del editor usa MapLibre GL JS y no necesita una clave de Google. El usuario puede pegar un enlace de Google Maps o escribir coordenadas; sin coordenadas puede solicitar su ubicación actual.

El servidor resuelve las redirecciones permitidas y, cuando es necesario, lee metadatos limitados de la página final. Los centros de vista previa son aproximados y requieren confirmación antes de guardarlos como lugar del movimiento. No se usa la API de Places ni se geocodifica el nombre del comercio automáticamente.

Consulta [LOCATION_CAPTURE.md](LOCATION_CAPTURE.md) para conocer formatos, límites, privacidad y funcionamiento sin conexión. Los lugares guardados anteriormente con un Google Place ID siguen siendo compatibles.
