"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { getCountryBoundary } from "../lib/geo";
import type { MapPoint, MapTier, MapViewport } from "../lib/mapStore";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const BOUNDARY_SOURCE_ID = "trip-map-focused-boundaries";
const BOUNDARY_FILL_LAYER = `${BOUNDARY_SOURCE_ID}-fill`;
const BOUNDARY_LINE_LAYER = `${BOUNDARY_SOURCE_ID}-line`;

// Where tapping an aggregate bubble takes the camera: just past the zoom at which the
// server switches to the next tier (see supabase/migrations/0016_search_posts_map.sql),
// so one tap always visibly breaks the bubble apart rather than redrawing the same one.
const NEXT_TIER_ZOOM: Record<Exclude<MapTier, "post">, number> = {
  region: 3.2,
  country: 5.2,
  place: 8.2,
};

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

function toBoundaryFeatureCollection(countryCodes: string[]): GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
> {
  const features = countryCodes
    .map((code) => getCountryBoundary(code))
    .filter((f): f is BoundaryFeature => Boolean(f));
  return { type: "FeatureCollection", features };
}

function createPinElement(focused: boolean): HTMLDivElement {
  const wrapper = document.createElement("div");
  // No inline `position` here: Mapbox adds its own `.mapboxgl-marker` class to this
  // element (position: absolute) and positions it purely via a CSS `transform:
  // translate(...)` on top of that. An inline `position: relative` would out-specificity
  // the class, pull the marker back into normal document flow, and turn the transform's
  // translate into an offset from the wrong starting point — pins land nowhere near their
  // real lng/lat, and multiple markers stack against each other as they push each other
  // down the flow.
  wrapper.style.cursor = "pointer";
  const fill = focused ? "#2563eb" : "#f97316";
  const stroke = focused ? "#1d4ed8" : "#ea580c";
  wrapper.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 3px rgba(15,23,42,0.35))">
    <path d="M12 22s-7-6.1-7-11.5A7 7 0 0 1 19 10.5C19 15.9 12 22 12 22z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
    <circle cx="12" cy="10.3" r="2.6" fill="white"/>
  </svg>`;
  return wrapper;
}

// Aggregate tiers render as a count bubble rather than a pin: at continent/country/city
// zoom the exact coordinate is meaningless, and the number is the actual information.
function createBubbleElement(point: MapPoint): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cursor = "pointer";
  // Area, not diameter, tracks the count — sqrt keeps a 100-post bubble from dwarfing a
  // 10-post one by a factor of ten.
  const size = Math.min(64, 34 + Math.sqrt(point.postCount) * 4);
  wrapper.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:rgba(249,115,22,0.92);
    color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;
    border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,0.35);cursor:pointer;`;
  const count = document.createElement("span");
  count.textContent = String(point.postCount);
  count.style.cssText = "font-size:13px;font-weight:800;";
  wrapper.appendChild(count);
  wrapper.title = `${point.label} · ${point.postCount} ${point.postCount === 1 ? "trip" : "trips"}`;
  return wrapper;
}

export type TripMapProps = {
  points: MapPoint[];
  focusedPostId: string | null;
  /** Country codes of the focused post, highlighted as boundary polygons. */
  focusedCountryCodes: string[];
  onSelectPost: (postId: string) => void;
  /** Fired on moveend (and once the style loads) so the caller can refetch for the new area. */
  onViewportChange: (viewport: MapViewport) => void;
  /** Initial camera, applied once — used to open on the destination the user searched for. */
  initialBounds?: [number, number, number, number] | null;
};

export default function TripMap({
  points,
  focusedPostId,
  focusedCountryCodes,
  onSelectPost,
  onViewportChange,
  initialBounds,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Callbacks live in refs so the map/listener effects can stay mounted for the map's
  // whole lifetime: re-running them on every render would tear down and rebuild the
  // Mapbox instance, which is both a visible flicker and a billed map load.
  const onSelectPostRef = useRef(onSelectPost);
  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onSelectPostRef.current = onSelectPost;
    onViewportChangeRef.current = onViewportChange;
  }, [onSelectPost, onViewportChange]);

  // Style-loaded is tracked as state (not a one-off `map.once("load", ...)` per effect)
  // so every downstream effect re-runs exactly once the map is actually ready, always
  // with its latest props — no stale-closure or duplicate-listener risk that could leave
  // "ghost" markers behind from an earlier render.
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [10, 20],
      zoom: 1.5,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const emitViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      onViewportChangeRef.current({
        minLng: bounds.getWest(),
        minLat: bounds.getSouth(),
        maxLng: bounds.getEast(),
        maxLat: bounds.getNorth(),
        zoom: map.getZoom(),
      });
    };

    map.on("load", () => {
      setIsStyleLoaded(true);
      // The first emit is what triggers the initial fetch — without it the map would sit
      // empty until the user happened to move it.
      emitViewport();
    });
    map.on("moveend", emitViewport);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setIsStyleLoaded(false);
    };
  }, []);

  // Opening camera for a newly-searched destination. Applied once per distinct bounds —
  // after that the user's own pan/zoom is left alone, since re-fitting on every render
  // would fight whatever they just did.
  const appliedBoundsRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded || !initialBounds) return;
    const key = initialBounds.join(",");
    if (appliedBoundsRef.current === key) return;
    appliedBoundsRef.current = key;
    const [minLng, minLat, maxLng, maxLat] = initialBounds;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 40, maxZoom: 9, duration: 800, essential: true },
    );
  }, [initialBounds, isStyleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    // Always clear the previous render's markers before placing new ones — otherwise a
    // point that drops out of `points` (panned away, filtered out, or collapsed into a
    // different tier) would leave its marker stranded on the map.
    markersRef.current.forEach((m) => m.remove());
    const markers: mapboxgl.Marker[] = [];

    for (const point of points) {
      const isPostPin = point.tier === "post" && point.postId;
      const element = isPostPin
        ? createPinElement(point.postId === focusedPostId)
        : createBubbleElement(point);

      element.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isPostPin && point.postId) {
          onSelectPostRef.current(point.postId);
          return;
        }
        // Tapping an aggregate drills in one tier rather than opening anything — the
        // bubble is a "there are N trips here", and the way to see them is to zoom.
        map.easeTo({
          center: [point.lng, point.lat],
          zoom: NEXT_TIER_ZOOM[point.tier as Exclude<MapTier, "post">],
          duration: 700,
          essential: true,
        });
      });

      markers.push(
        new mapboxgl.Marker({ element, anchor: isPostPin ? "bottom" : "center" })
          .setLngLat([point.lng, point.lat])
          .addTo(map),
      );
    }

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [points, focusedPostId, isStyleLoaded]);

  // Country boundary highlight for the focused post. No camera move: the user tapped a
  // pin they could already see, and moving the camera would change the viewport and
  // trigger a refetch of the very points they're looking at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const boundaryData = toBoundaryFeatureCollection(focusedCountryCodes);
    const source = map.getSource(BOUNDARY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(boundaryData);
      return;
    }
    map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: boundaryData });
    map.addLayer({
      id: BOUNDARY_FILL_LAYER,
      type: "fill",
      source: BOUNDARY_SOURCE_ID,
      paint: { "fill-color": "#3B82F6", "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: BOUNDARY_LINE_LAYER,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      paint: { "line-color": "#2563EB", "line-width": 2 },
    });
  }, [focusedCountryCodes, isStyleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
