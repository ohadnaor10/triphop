"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { getCountryBoundary } from "../lib/geo";
import type { MapCluster } from "../lib/cluster";
import type { MapViewport } from "../lib/mapStore";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const BOUNDARY_SOURCE_ID = "trip-map-focused-boundaries";
const BOUNDARY_FILL_LAYER = `${BOUNDARY_SOURCE_ID}-fill`;
const BOUNDARY_LINE_LAYER = `${BOUNDARY_SOURCE_ID}-line`;

// How far out the map can be zoomed. Below this the whole globe (and then copies of it)
// fits on screen, where every marker collapses into a handful of meaningless blobs and
// panning stops meaning anything — so the camera simply doesn't go there.
const MIN_ZOOM = 2;
// Fallback for tapping a cluster whose members share one exact coordinate: its bounds are
// a single point, so there is nothing to fit the camera to.
const COINCIDENT_CLUSTER_ZOOM = 13;

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
function createBubbleElement(cluster: MapCluster): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cursor = "pointer";
  // Area, not diameter, tracks the count — sqrt keeps a 100-post bubble from dwarfing a
  // 10-post one by a factor of ten.
  const size = Math.min(64, 34 + Math.sqrt(cluster.postCount) * 4);
  wrapper.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:rgba(249,115,22,0.92);
    color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;
    border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,0.35);cursor:pointer;`;
  const count = document.createElement("span");
  count.textContent = String(cluster.postCount);
  count.style.cssText = "font-size:13px;font-weight:800;";
  wrapper.appendChild(count);
  wrapper.title = `${cluster.label} · ${cluster.postCount} ${cluster.postCount === 1 ? "trip" : "trips"}`;
  return wrapper;
}

export type TripMapProps = {
  clusters: MapCluster[];
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
  clusters,
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
      zoom: MIN_ZOOM,
      minZoom: MIN_ZOOM,
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
    // marker that drops out of `clusters` (panned away, filtered out, or merged into a
    // neighbour) would be left stranded on the map.
    markersRef.current.forEach((m) => m.remove());
    const markers: mapboxgl.Marker[] = [];

    for (const cluster of clusters) {
      // A cluster of one is just a post — draw it as a pin and open it on tap.
      const isSinglePost = cluster.postId !== null;
      const element = isSinglePost
        ? createPinElement(cluster.postId === focusedPostId)
        : createBubbleElement(cluster);

      element.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isSinglePost && cluster.postId) {
          onSelectPostRef.current(cluster.postId);
          return;
        }

        const [minLng, minLat, maxLng, maxLat] = cluster.bounds;
        // Zoom to the cluster's own extent rather than to a fixed step, so one tap opens
        // exactly this group and no more — a tight knot of towns needs far more zoom than
        // a loose pair of cities, and a fixed step gets both wrong.
        if (minLng === maxLng && minLat === maxLat) {
          // Every member sits on the same coordinate, so no amount of zoom separates them
          // and fitBounds has nothing to fit.
          map.easeTo({ center: [cluster.lng, cluster.lat], zoom: COINCIDENT_CLUSTER_ZOOM, duration: 700, essential: true });
          return;
        }
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 80, maxZoom: 15, duration: 700, essential: true },
        );
      });

      markers.push(
        new mapboxgl.Marker({ element, anchor: isSinglePost ? "bottom" : "center" })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(map),
      );
    }

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [clusters, focusedPostId, isStyleLoaded]);

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
