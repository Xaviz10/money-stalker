import { useEffect, useRef, useState } from 'react';
import type { Map as LibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerURL from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { CapturedLocation } from '../../domain/location';
import type { TransactionPlace } from '../../domain/model';
const styleURL = import.meta.env.VITE_MAP_STYLE_URL?.trim();
const rasterStyle: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
export function CaptureMap({ captured, place }: { captured: CapturedLocation[]; place?: TransactionPlace }) {
  const node = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const evidenceKey = JSON.stringify({ captured, place });
  useEffect(() => {
    const evidence = JSON.parse(evidenceKey) as { captured: CapturedLocation[]; place?: TransactionPlace };
    const center = evidence.place ?? evidence.captured[0];
    if (!node.current || !center) return;
    let disposed = false;
    let map: LibreMap | undefined;
    setStatus('loading');
    const failed = () => { if (!disposed) setStatus('error'); };
    const timeout = window.setTimeout(failed, 15000);
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl, AttributionControl, setWorkerUrl }) => {
      if (disposed || !node.current) return;
      setWorkerUrl(workerURL);
      map = new Map({
        container: node.current, style: styleURL || rasterStyle,
        center: [center.longitude, center.latitude], zoom: 16,
        attributionControl: false,
        locale: { 'Map.Title': 'Mapa de la ubicación', 'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar', 'AttributionControl.ToggleAttribution': 'Créditos del mapa' },
        transformRequest: url => ({ url, referrerPolicy: 'strict-origin-when-cross-origin' }),
      });
      map.addControl(new AttributionControl({ compact: false }));
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', failed);
      map.on('load', () => { window.clearTimeout(timeout); if (!disposed) { setStatus('ready'); map?.resize(); } });
      for (const [index, location] of evidence.captured.entries()) {
        const marker = new Marker({ color: '#1949db' }).setLngLat([location.longitude, location.latitude]).addTo(map);
        marker.getElement().setAttribute('aria-label', `Ubicación del teléfono ${index + 1}`);
      }
      if (evidence.place) {
        const marker = new Marker({ color: '#207052' }).setLngLat([evidence.place.longitude, evidence.place.latitude]).addTo(map);
        marker.getElement().setAttribute('aria-label', 'Negocio confirmado por ti');
      }
    }).catch(failed);
    return () => { disposed = true; window.clearTimeout(timeout); map?.remove(); };
  }, [evidenceKey]);
  if (!captured.length && !place) return null;
  return <section className="capture-map" aria-label="Mapa de la ubicación del movimiento">
    <h3>Ubicación del movimiento</h3>
    <div className="capture-map-frame">
      <div ref={node} className="location-map" aria-label="Mapa de la ubicación capturada" hidden={status === 'error'} />
      {status === 'loading' && <p role="status" className="map-status small-note">Cargando mapa…</p>}
      {status === 'error' && <p role="status" className="map-status small-note">No se pudo cargar el mapa. Las coordenadas siguen disponibles; usa los enlaces para abrirlas.</p>}
    </div>
    <small>Azul: ubicación del teléfono. Verde: negocio confirmado por ti. La ubicación capturada no confirma el comercio.</small>
  </section>;
}
