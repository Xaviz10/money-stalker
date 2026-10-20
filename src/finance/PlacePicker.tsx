import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkedGoogleMapsURL, googleMapsURL, parseGoogleMapsLink, type GoogleLinkLocation, type CapturedLocation } from '../../domain/location';
import { transactionPlaceSchema, type TransactionPlace } from '../../domain/model';
import { Field } from '../design-system/ui';
import { post } from '../api';
import { CaptureMap } from './CaptureMap';

const numeric = (value: string) => /^-?\d+(?:[.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN;
function safeMapsLink(value?: string) {
  try { return value ? checkedGoogleMapsURL(value).href : undefined; } catch { return undefined; }
}
export function PlacePicker({ merchant, captured, place, onChoose, children }: { children?: ReactNode; merchant: string; captured: CapturedLocation[]; place?: TransactionPlace; onChoose: (place?: TransactionPlace) => void }) {
  const initial = place ?? captured[0];
  const [link, setLink] = useState(place?.url ?? '');
  const [latitude, setLatitude] = useState(initial ? String(initial.latitude) : '');
  const [longitude, setLongitude] = useState(initial ? String(initial.longitude) : '');
  const [resolved, setResolved] = useState<GoogleLinkLocation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const revision = useRef(0);
  const edited = useRef(false);
  useEffect(() => {
    if (edited.current) return;
    const next = place ?? captured[0];
    setLatitude(next ? String(next.latitude) : '');
    setLongitude(next ? String(next.longitude) : '');
    setLink(place?.url ?? '');
  }, [place?.latitude, place?.longitude, place?.url, captured[0]?.latitude, captured[0]?.longitude]);
  const lastRead = useRef('');
  const beforeConfirmation = useRef<TransactionPlace | undefined>(place);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => () => { revision.current++; }, []);
  const point = transactionPlaceSchema.safeParse({ id: `coordinates:${latitude}:${longitude}`, name: resolved?.name || place?.name || (captured.length ? 'Ubicación del teléfono' : merchant || 'Ubicación del movimiento'), address: place?.address ?? '', latitude: numeric(latitude), longitude: numeric(longitude), source: 'manual' });
  const preview = point.success ? point.data : undefined;
  const hasValues = Boolean(link.trim() || latitude.trim() || longitude.trim());
  const showEditor = editing || !hasValues;
  const matchesPlace = place && preview && place.latitude === preview.latitude && place.longitude === preview.longitude;
  const mapsHref = preview
    ? (matchesPlace && place.source === 'google-link' ? safeMapsLink(place.url) : undefined) ?? googleMapsURL(preview.latitude, preview.longitude, matchesPlace && (!place.source || place.source === 'google') ? place.id : undefined)
    : safeMapsLink(link);
  function choose(lat: string, lng: string, url?: string, name?: string) {
    edited.current = true;
    const result = transactionPlaceSchema.safeParse({ id: `coordinates:${lat}:${lng}`, name: name || place?.name || merchant || 'Lugar del movimiento', address: '', latitude: numeric(lat), longitude: numeric(lng), source: url ? 'google-link' : 'manual', ...(url ? { url } : {}) });
    if (result.success) { onChoose(result.data); setError(''); return true; }
    if (lat || lng) setError('Completa ambas coordenadas: latitud entre −90 y 90 y longitud entre −180 y 180.');
    else { onChoose(undefined); setError(''); }
    return false;
  }
  async function readLink(value: string) {
    const key = value.trim();
    if (key) edited.current = true;
    if (key && lastRead.current === key) return;
    lastRead.current = key;
    const current = ++revision.current;
    beforeConfirmation.current = place;
    setConfirmed(false); setResolved(undefined); setError('');
    if (!key) { setBusy(false); return; }
    setBusy(true);
    try {
      const next = parseGoogleMapsLink(key) ?? await post<GoogleLinkLocation>('/places/resolve-link', { url: key });
      if (current !== revision.current) return;
      setResolved(next); setLatitude(String(next.latitude)); setLongitude(String(next.longitude));
      if (!next.approximate && choose(String(next.latitude), String(next.longitude), next.url, next.name)) setEditing(false);
    } catch { if (current === revision.current) { lastRead.current = ''; setEditing(true); setError('No pudimos obtener las coordenadas del enlace. Puedes escribirlas o usar tu ubicación actual.'); } }
    finally { if (current === revision.current) setBusy(false); }
  }
  return <section className="place-picker" aria-label="Elegir o corregir lugar">
    {hasValues && <div className="place-summary">
      <strong className="place-name">{preview?.name || place?.name || merchant || 'Ubicación del movimiento'}</strong>
      {showEditor
        ? <button type="button" className="text-button" disabled={busy || !preview || Boolean(error) || Boolean(resolved?.approximate && !confirmed)} onClick={() => setEditing(false)}>Listo</button>
        : <button type="button" className="text-button" onClick={() => setEditing(true)}>Editar ubicación</button>}
    </div>}
    <div className="place-edit-fields" hidden={!showEditor}>
      <Field label="Enlace de Google Maps"><input value={link} onChange={event => { setEditing(true); setLink(event.target.value); lastRead.current = ''; revision.current++; setBusy(false); setResolved(undefined); setError(''); }} onBlur={() => void readLink(link)} onPaste={event => { const value = event.clipboardData.getData('text'); event.preventDefault(); setEditing(true); setLink(value); void readLink(value); }} inputMode="url" maxLength={2000} placeholder="Pega el enlace del lugar" /></Field>
      {busy && <p className="small-note" role="status">Leyendo enlace…</p>}
      <div className="form-grid">
        <Field label="Latitud del lugar"><input value={latitude} onChange={event => { setEditing(true); revision.current++; setBusy(false); setResolved(undefined); setLatitude(event.target.value); choose(event.target.value, longitude); }} inputMode="decimal" placeholder="4.600000" /></Field>
        <Field label="Longitud del lugar"><input value={longitude} onChange={event => { setEditing(true); revision.current++; setBusy(false); setResolved(undefined); setLongitude(event.target.value); choose(latitude, event.target.value); }} inputMode="decimal" placeholder="−74.100000" /></Field>
      </div>
      {resolved?.approximate && <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); if (event.target.checked) choose(latitude, longitude, resolved.url, resolved.name); else onChoose(beforeConfirmation.current); }} /> Ubicación aproximada del enlace. Confirmo que el punto del mapa corresponde al lugar del movimiento.</label>}
      {!preview && <button type="button" className="button secondary" disabled={busy} onClick={() => {
        if (!navigator.geolocation) { setError('Este navegador no permite obtener la ubicación. Pega un enlace o escribe las coordenadas.'); return; }
        const current = ++revision.current;
        edited.current = true; setBusy(true); setError('');
        navigator.geolocation.getCurrentPosition(position => {
          if (current !== revision.current) return;
          const lat = String(position.coords.latitude), lng = String(position.coords.longitude);
          setLatitude(lat); setLongitude(lng); setResolved(undefined); setLink(''); choose(lat, lng); setBusy(false); setEditing(false);
        }, () => { if (current !== revision.current) return; setBusy(false); setError('No pudimos obtener tu ubicación. Revisa el permiso del navegador o escribe las coordenadas.'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
      }}>{busy ? 'Obteniendo ubicación…' : 'Usar mi ubicación'}</button>}
      {error && <p className="error" role="alert">{error}</p>}
      {place && <button type="button" className="text-button" onClick={() => { edited.current = true; revision.current++; setLatitude(''); setLongitude(''); setLink(''); setResolved(undefined); setError(''); setBusy(false); setEditing(false); onChoose(undefined); }}>Quitar lugar</button>}
      {children}
    </div>
    <CaptureMap captured={[]} place={preview} />
    {mapsHref && <a className="button secondary place-map-cta" href={mapsHref} target="_blank" rel="noreferrer">Ver en Google Maps</a>}
  </section>;
}
