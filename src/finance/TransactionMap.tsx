import type { ReactNode } from "react";
import { PlacePicker } from "./PlacePicker";
import { appleMapsURL, capturedAddress, googleMapsURL } from "../../domain/location";
import type { Capture, TransactionPlace } from "../../domain/model";
type CapturedLocation = NonNullable<Capture["location"]>;
function locationTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(value));
}
export function TransactionMap({ captured, merchant, place, onPlaceChange, children }: { children?: ReactNode; captured: CapturedLocation[]; merchant: string; place?: TransactionPlace; onPlaceChange: (place?: TransactionPlace) => void }) {
 return <div className="transaction-map">
  <PlacePicker merchant={merchant} captured={captured} place={place} onChoose={onPlaceChange}>{children}</PlacePicker>
      {captured.length > 0 && (
        <details className="captured-location-list"><summary>Ubicación original del atajo</summary>
          {captured.map((location) => (
            <div
              className="location-entry"
              key={`${location.latitude}:${location.longitude}:${location.observedAt}`}
            >
              <small>
                Capturada por el atajo · {location.accuracy === undefined ? "Precisión no disponible" : `precisión ${Math.round(location.accuracy)} m`} ·{" "}
                {locationTime(location.observedAt)}{location.timestampSource === "event" ? " · hora del evento; muestra sin fecha propia" : ""}
              </small>
              <div className="captured-address">
                {capturedAddress(location) && <p>{capturedAddress(location)}</p>}
                <small>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</small>
                <details><summary>Detalles recibidos del iPhone</summary><dl>
                  {([["Nombre de la ubicación", location.name], ["Dirección completa", location.fullAddress], ["Calle", location.street], ["Número", location.streetNumber], ["Ciudad", location.city], ["Estado / departamento", location.state], ["Código postal", location.postalCode], ["Región", location.region], ["País", location.country], ["Código de país", location.countryCode]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>{location.url && <a href={location.url} target="_blank" rel="noreferrer">Enlace recibido del atajo</a>}</details>
              </div>
              <div className="location-map-links"><a href={appleMapsURL(location.latitude, location.longitude)} target="_blank" rel="noreferrer">Abrir en Apple Maps</a>
              <a
                href={googleMapsURL(location.latitude, location.longitude)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir en Google Maps
              </a></div>
            </div>
          ))}
        </details>
      )}

 </div>;
}
