import { useState } from 'react';
import { parseGoogleMapsLink, type GoogleLinkLocation } from '../../domain/location';
import { transactionPlaceSchema, type TransactionPlace } from '../../domain/model';
import { Field } from '../design-system/ui';
import { post } from '../api';

export function PlacePicker({ merchant, onChoose }: { merchant: string; onChoose: (place: TransactionPlace) => void }) {
  const [query, setQuery] = useState(merchant);
  const [link, setLink] = useState('');
  const [name, setName] = useState(merchant);
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [resolved, setResolved] = useState<GoogleLinkLocation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmCenter, setConfirmCenter] = useState(false);
  return <section className="place-picker" aria-label="Elegir o corregir lugar">
    <h3>Elegir o corregir el lugar</h3>
    <p className="small-note">Si el SMS llegó tarde, elige el lugar real de la compra. La muestra original del teléfono se conserva por separado.</p>
    <Field label="Buscar comercio o dirección"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Comercio y ciudad" maxLength={200} /></Field>
    {query.trim() && <a className="text-link place-search-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`} target="_blank" rel="noreferrer">Buscar en Google Maps</a>}
    <p className="small-note">Abre el resultado correcto, copia su enlace y pégalo aquí.</p>
    <Field label="Enlace de Google Maps"><input value={link} onChange={event => { setLink(event.target.value); setResolved(undefined); setReady(false); setError(''); }} inputMode="url" maxLength={2000} placeholder="https://maps.app.goo.gl/…" /></Field>
    <button type="button" className="button secondary" disabled={busy || !link.trim()} onClick={async () => {
      setBusy(true); setError(''); setReady(false); setConfirmCenter(false);
      try {
        const point = parseGoogleMapsLink(link) ?? await post<GoogleLinkLocation>('/places/resolve-link', { url: link.trim() });
        setResolved(point); setLatitude(String(point.latitude)); setLongitude(String(point.longitude));
        setName(point.name || query.trim() || merchant); setReady(true);
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? 'Leyendo enlace…' : 'Leer enlace'}</button>
    <details className="manual-place-details" open={ready || undefined}>
      <summary>Revisar lugar o escribir coordenadas</summary>
      {resolved?.approximate && <p className="small-note place-link-warning">Este enlace solo indica el centro del mapa, no la posición exacta del comercio. Corrige las coordenadas o copia el enlace de la ficha del lugar antes de usarlo.</p>}
      <Field label="Nombre del lugar"><input value={name} onChange={event => setName(event.target.value)} maxLength={200} placeholder="Nombre del comercio o lugar" /></Field>
      <Field label="Dirección del lugar (opcional)"><input value={address} onChange={event => setAddress(event.target.value)} maxLength={500} /></Field>
      <div className="form-grid">
        <Field label="Latitud del lugar"><input value={latitude} onChange={event => setLatitude(event.target.value)} inputMode="decimal" placeholder="4.600000" /></Field>
        <Field label="Longitud del lugar"><input value={longitude} onChange={event => setLongitude(event.target.value)} inputMode="decimal" placeholder="-74.100000" /></Field>
      </div>
      {resolved?.approximate && <label className="checkbox"><input type="checkbox" checked={confirmCenter} onChange={event => setConfirmCenter(event.target.checked)} /> Confirmo que las coordenadas mostradas corresponden al lugar que quiero guardar.</label>}
      <button type="button" className="button secondary" onClick={() => {
        setError('');
        if (resolved?.approximate && !confirmCenter) { setError('Confirma las coordenadas del centro del mapa o usa un enlace de la ficha del lugar.'); return; }
        const numeric = (value: string) => /^-?\d+(?:[.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN;
        const lat = numeric(latitude), lng = numeric(longitude);
        const fromLink = resolved && lat === resolved.latitude && lng === resolved.longitude;
        const result = transactionPlaceSchema.safeParse({ id: `coordinates:${lat}:${lng}`, name: name.trim(), address: address.trim(), latitude: lat, longitude: lng, source: fromLink ? 'google-link' : 'manual', ...(fromLink ? { url: resolved.url } : {}) });
        if (!result.success) { setError('Escribe el nombre y coordenadas válidas: latitud entre −90 y 90, longitud entre −180 y 180.'); return; }
        onChoose(result.data); setReady(false);
      }}>Usar este lugar</button>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
