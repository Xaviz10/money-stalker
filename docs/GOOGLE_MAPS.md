# Mapas y enlaces de Google Maps

El mapa del editor usa MapLibre GL JS y no necesita una clave de Google. La vista de una ubicación configurada muestra su nombre, el mapa y los CTA **Ver en Google Maps** y **Editar ubicación**. Al editar, el usuario puede pegar un enlace de Google Maps o escribir coordenadas; sin coordenadas puede solicitar su ubicación actual.

El servidor sigue las redirecciones permitidas. Si el enlace no contiene coordenadas, consulta la ficha pública por su CID y acepta solo coordenadas ligadas al mismo identificador de comercio. Los centros de imágenes de vista previa o de la cámara del servidor se descartan: pueden señalar otro país. Si no se puede verificar el lugar, se permite escribir las coordenadas manualmente. No se usa la API de Places ni se geocodifica el nombre del comercio automáticamente.

Consulta [LOCATION_CAPTURE.md](LOCATION_CAPTURE.md) para conocer formatos, límites, privacidad y funcionamiento sin conexión. Los lugares guardados anteriormente con un Google Place ID siguen siendo compatibles.
