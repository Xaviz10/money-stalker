import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { CaptureMap } from "./CaptureMap";
import { appleMapsURL, capturedAddress, googleMapsURL } from "../../domain/location";
import type { Capture, TransactionPlace } from "../../domain/model";

type CapturedLocation = NonNullable<Capture["location"]>;

const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
let mapsPromise: Promise<
  [google.maps.MapsLibrary, google.maps.PlacesLibrary]
> | null = null;

function loadMaps() {
  if (!mapsKey) return Promise.reject(new Error("Google Maps no configurado"));
  if (!mapsPromise) {
    setOptions({ key: mapsKey, v: "weekly" });
    mapsPromise = Promise.all([importLibrary("maps"), importLibrary("places")]);
  }
  return mapsPromise;
}

function locationTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

export function TransactionMap({
  captured,
  place,
  onPlaceChange,
}: {
  captured: CapturedLocation[];
  place?: TransactionPlace;
  onPlaceChange: (place?: TransactionPlace) => void;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const searchNode = useRef<HTMLDivElement>(null);
  const selectedCircle = useRef<google.maps.Circle | undefined>(undefined);
  const [error, setError] = useState("");
  const [googleOpen, setGoogleOpen] = useState(false);
  const center = place ??
    captured[0] ?? { latitude: 4.711, longitude: -74.0721 };

  useEffect(() => {
    if (!googleOpen || !mapsKey || !mapNode.current || !searchNode.current) return;
    let disposed = false;
    const listeners: google.maps.MapsEventListener[] = [];
    const circles: google.maps.Circle[] = [];
    void loadMaps()
      .then(([{ Map, Circle }, { Place, PlaceAutocompleteElement }]) => {
        if (disposed || !mapNode.current || !searchNode.current) return;
        const map = new Map(mapNode.current, {
          center: { lat: center.latitude, lng: center.longitude },
          zoom: 17,
          clickableIcons: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
        });
        const draw = (
          latitude: number,
          longitude: number,
          selected = false,
        ) => {
          const circle = new Circle({
            map,
            center: { lat: latitude, lng: longitude },
            radius: selected ? 12 : 18,
            fillColor: selected ? "#18794e" : "#235ac5",
            fillOpacity: selected ? 0.35 : 0.18,
            strokeColor: selected ? "#18794e" : "#235ac5",
            strokeOpacity: 0.9,
            strokeWeight: 2,
          });
          circles.push(circle);
          if (selected) selectedCircle.current = circle;
          return circle;
        };
        for (const location of captured)
          draw(location.latitude, location.longitude);
        if (place) draw(place.latitude, place.longitude, true);

        const choose = async (selectedPlace: google.maps.places.Place) => {
          await selectedPlace.fetchFields({
            fields: ["id", "displayName", "formattedAddress", "location"],
          });
          if (!selectedPlace.id || !selectedPlace.location) return;
          const next = {
            id: selectedPlace.id,
            name: selectedPlace.displayName || "Lugar seleccionado",
            address: selectedPlace.formattedAddress || "",
            latitude: selectedPlace.location.lat(),
            longitude: selectedPlace.location.lng(),
          };
          selectedCircle.current?.setMap(null);
          draw(next.latitude, next.longitude, true);
          map.panTo({ lat: next.latitude, lng: next.longitude });
          map.setZoom(18);
          onPlaceChange(next);
        };

        const autocomplete = new PlaceAutocompleteElement();
        autocomplete.setAttribute(
          "aria-label",
          "Buscar negocio en Google Maps",
        );
        autocomplete.setAttribute("placeholder", "Buscar negocio o lugar");
        searchNode.current.replaceChildren(autocomplete);
        autocomplete.addEventListener("gmp-select", (event) => {
          const selection =
            event as google.maps.places.PlacePredictionSelectEvent;
          void choose(selection.placePrediction.toPlace()).catch(() =>
            setError("No pudimos cargar ese negocio. Intenta nuevamente."),
          );
        });
        listeners.push(
          map.addListener("bounds_changed", () => {
            const bounds = map.getBounds();
            if (bounds) autocomplete.locationBias = bounds.toJSON();
          }),
          map.addListener(
            "click",
            (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
              if (!("placeId" in event) || !event.placeId) return;
              event.stop();
              void choose(new Place({ id: event.placeId })).catch(() =>
                setError("No pudimos cargar ese negocio. Intenta nuevamente."),
              );
            },
          ),
        );
      })
      .catch(() => setError("No pudimos cargar Google Maps."));
    return () => {
      disposed = true;
      for (const listener of listeners) listener.remove();
      for (const circle of circles) circle.setMap(null);
      searchNode.current?.replaceChildren();
    };
  }, [googleOpen]);

  return (
    <div className="transaction-map">
      {captured.length > 0 && (
        <div className="captured-location-list">
          {captured.map((location) => (
            <div
              className="location-entry"
              key={`${location.latitude}:${location.longitude}:${location.observedAt}`}
            >
              <small>
                Capturada por el atajo · {location.accuracy === undefined ? "Precisión no disponible" : `precisión ${Math.round(location.accuracy)} m`} ·{" "}
                {locationTime(location.observedAt)}
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
        </div>
      )}
      <CaptureMap captured={captured} place={place} />
      {mapsKey && <details className="google-place-picker" onToggle={event => setGoogleOpen(event.currentTarget.open)}>
        <summary>Buscar y confirmar un negocio (Google)</summary>
        {googleOpen && <>
          <div ref={searchNode} className="place-search" />
          <div ref={mapNode} className="google-map" aria-label="Mapa para confirmar un negocio en Google" />
          <small>Elige tú el negocio; la dirección del teléfono no modifica el comercio automáticamente.</small>
        </>}
      </details>}
      {place && (
        <div className="selected-place">
          <div>
            <strong>{place.name}</strong>
            {place.address && <small>{place.address}</small>}
          </div>
          <div>
            <a
              href={googleMapsURL(place.latitude, place.longitude, place.id)}
              target="_blank"
              rel="noreferrer"
            >
              Ver en Maps
            </a>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                selectedCircle.current?.setMap(null);
                selectedCircle.current = undefined;
                onPlaceChange(undefined);
              }}
            >
              Quitar lugar
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
