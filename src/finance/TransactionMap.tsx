import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
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

function mapsURL(latitude: number, longitude: number, placeId?: string) {
  const query = encodeURIComponent(`${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""}`;
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
  const center = place ??
    captured[0] ?? { latitude: 4.711, longitude: -74.0721 };

  useEffect(() => {
    if (!mapsKey || !mapNode.current || !searchNode.current) return;
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
  }, []);

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
                Capturada por el atajo · precisión{" "}
                {Math.round(location.accuracy)} m ·{" "}
                {locationTime(location.observedAt)}
              </small>
              <a
                href={mapsURL(location.latitude, location.longitude)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir en Google Maps
              </a>
            </div>
          ))}
        </div>
      )}
      {mapsKey ? (
        <>
          <div ref={searchNode} className="place-search" />
          <div
            ref={mapNode}
            className="google-map"
            aria-label="Mapa de la ubicación del movimiento"
          />
          <small>
            Toca un negocio visible en el mapa o búscalo por nombre. La
            ubicación capturada es una pista y puede corresponder al momento en
            que llegó el SMS.
          </small>
        </>
      ) : (
        <p className="small-note">
          La ubicación está guardada. Activa Google Maps para buscar y asociar
          un negocio desde este mapa.
        </p>
      )}
      {place && (
        <div className="selected-place">
          <div>
            <strong>{place.name}</strong>
            {place.address && <small>{place.address}</small>}
          </div>
          <div>
            <a
              href={mapsURL(place.latitude, place.longitude, place.id)}
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
