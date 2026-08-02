"use client";

import turfBbox from "@turf/bbox";
import turfCircle from "@turf/circle";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { getCountryBoundary } from "../lib/geo";

export type DestinationPoint = {
  name: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  tier: "country" | "local" | "region";
  countryCode?: string;
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const FIT_MAX_ZOOM = 11;
const COUNTRY_SOURCE_ID = "trip-country-boundaries";
const COUNTRY_FILL_LAYER = `${COUNTRY_SOURCE_ID}-fill`;
const COUNTRY_LINE_LAYER = `${COUNTRY_SOURCE_ID}-line`;

type NamedFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }>;

// Local/natural-feature entries (cities, "French Alps", "Patagonia", ...) have no real
// admin polygon available — approximate with a smooth circular buffer around the
// geocoded point instead of a 4-corner bbox rectangle. Radius is derived from the
// geocoded bbox when we have one (bigger footprint -> bigger circle), else a sensible
// city-scale default.
function localRadiusKm(point: DestinationPoint): number {
  if (!point.bbox) return 15;
  const [minLng, minLat, maxLng, maxLat] = point.bbox;
  const kmPerDegreeLat = 111;
  const kmPerDegreeLng = 111 * Math.cos((point.lat * Math.PI) / 180);
  const spanKm = Math.max((maxLat - minLat) * kmPerDegreeLat, (maxLng - minLng) * kmPerDegreeLng);
  return Math.max(8, Math.min(spanKm / 2, 250));
}

// Real (simplified) administrative boundary polygon from world-atlas when we have one
// for this country; otherwise fall back to a circle so we still render *something*
// closer to a real footprint than a rectangle. Broad regions ("East Asia/SE Asia", ...)
// have no boundary data at all — they're this app's own multi-country groupings, not a
// real admin area — so they always get a large area circle instead of a pin.
function toCountryFeature(point: DestinationPoint): NamedFeature {
  const boundary = point.countryCode ? getCountryBoundary(point.countryCode) : undefined;
  if (boundary) {
    return { ...boundary, properties: { name: point.name } } as NamedFeature;
  }
  const radiusKm = point.tier === "region" ? 900 : localRadiusKm(point) * 4;
  const circle = turfCircle([point.lng, point.lat], radiusKm, {
    steps: 64,
    units: "kilometers",
  });
  return { ...circle, properties: { name: point.name } } as NamedFeature;
}

function toFeatureCollection(features: NamedFeature[]): GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { name: string }
> {
  return { type: "FeatureCollection", features };
}

// Local-tier destinations (cities, "French Alps", "Patagonia", ...) aren't a country/
// continent with a real admin boundary, so they get a simple pin instead of an
// approximated polygon.
function createLocalPinElement(name: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cursor = "pointer";
  wrapper.title = name;
  wrapper.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 3px rgba(15,23,42,0.35))">
    <path d="M12 22s-7-6.1-7-11.5A7 7 0 0 1 19 10.5C19 15.9 12 22 12 22z" fill="#2563eb" stroke="#1d4ed8" stroke-width="1"/>
    <circle cx="12" cy="10.3" r="2.6" fill="white"/>
  </svg>`;
  return wrapper;
}

function attachTooltipHandlers(map: mapboxgl.Map, fillLayerId: string) {
  map.on("mouseenter", fillLayerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", fillLayerId, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", fillLayerId, (e) => {
    const name = e.features?.[0]?.properties?.name;
    if (!name) return;
    new mapboxgl.Popup({ offset: 12 }).setLngLat(e.lngLat).setText(String(name)).addTo(map);
  });
}

export default function TripDestinationsMap({ points }: { points: DestinationPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const center: [number, number] = points[0] ? [points[0].lng, points[0].lat] : [0, 20];
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center,
      zoom: 4,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function render() {
      const countryPoints = points.filter((p) => p.tier === "country" || p.tier === "region");
      const localPoints = points.filter((p) => p.tier === "local");
      const countryFeatures = countryPoints.map(toCountryFeature);
      const countryData = toFeatureCollection(countryFeatures);

      const countrySource = map!.getSource(COUNTRY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (countrySource) {
        countrySource.setData(countryData);
      } else {
        map!.addSource(COUNTRY_SOURCE_ID, { type: "geojson", data: countryData });
        map!.addLayer({
          id: COUNTRY_FILL_LAYER,
          type: "fill",
          source: COUNTRY_SOURCE_ID,
          paint: { "fill-color": "#3B82F6", "fill-opacity": 0.15 },
        });
        map!.addLayer({
          id: COUNTRY_LINE_LAYER,
          type: "line",
          source: COUNTRY_SOURCE_ID,
          paint: { "line-color": "#2563EB", "line-width": 2 },
        });
        attachTooltipHandlers(map!, COUNTRY_FILL_LAYER);
      }

      // Local (non-country/continent) destinations get pins instead of an approximated
      // polygon — clear the old markers first so a point dropping out of `points`
      // doesn't leave a stranded pin behind.
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = localPoints.map((point) => {
        const el = createLocalPinElement(point.name);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          new mapboxgl.Popup({ offset: 12 }).setLngLat([point.lng, point.lat]).setText(point.name).addTo(map!);
        });
        return new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([point.lng, point.lat]).addTo(map!);
      });

      if (points.length === 0) return;
      // Camera framing: real polygon geometry for countries, plain lng/lat for local pins.
      const bounds = new mapboxgl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]);
      localPoints.forEach((p) => bounds.extend([p.lng, p.lat]));
      if (countryFeatures.length > 0) {
        const [minLng, minLat, maxLng, maxLat] = turfBbox(toFeatureCollection(countryFeatures));
        bounds.extend([minLng, minLat]);
        bounds.extend([maxLng, maxLat]);
      }
      map!.fitBounds(bounds, { padding: 50, maxZoom: FIT_MAX_ZOOM });
    }

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once("load", render);
    }
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
