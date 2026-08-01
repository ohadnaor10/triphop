"use client";

import turfBbox from "@turf/bbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { getCountryBoundary } from "../lib/geo";

export type FeedMapPoint = {
  name: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  countryCode: string;
};

export type FeedMapPost = {
  id: string;
  /** Only real, specific (city-level) destinations — first entry is the primary pin. */
  points: FeedMapPoint[];
  countryCodes: string[];
  destinationLabel: string;
  dateLabel: string;
  userLabel: string;
  whatsapp: string;
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const BOUNDARY_SOURCE_ID = "trip-map-focused-boundaries";
const BOUNDARY_FILL_LAYER = `${BOUNDARY_SOURCE_ID}-fill`;
const BOUNDARY_LINE_LAYER = `${BOUNDARY_SOURCE_ID}-line`;

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

function toBoundaryFeatureCollection(countryCodes: string[]): GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
> {
  const features = countryCodes
    .map((code) => getCountryBoundary(code))
    .filter((f): f is BoundaryFeature => Boolean(f));
  return { type: "FeatureCollection", features };
}

function computeFocusBounds(post: FeedMapPost): mapboxgl.LngLatBounds | null {
  if (post.points.length === 0) return null;
  const [first, ...rest] = post.points;
  const bounds = new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
  rest.forEach((p) => bounds.extend([p.lng, p.lat]));
  for (const code of post.countryCodes) {
    const boundary = getCountryBoundary(code);
    if (!boundary) continue;
    const [minLng, minLat, maxLng, maxLat] = turfBbox(boundary);
    bounds.extend([minLng, minLat]);
    bounds.extend([maxLng, maxLat]);
  }
  return bounds;
}

function createPinElement(opts: { badge?: number; variant: "primary" | "secondary"; focused: boolean }): HTMLDivElement {
  const wrapper = document.createElement("div");
  // No inline `position` here: Mapbox adds its own `.mapboxgl-marker` class to this
  // element (position: absolute) and positions it purely via a CSS `transform:
  // translate(...)` on top of that. An inline `position: relative` would out-specificity
  // the class, pull the marker back into normal document flow, and turn the transform's
  // translate into an offset from the wrong starting point — pins land nowhere near their
  // real lng/lat, and multiple markers stack against each other as they push each other
  // down the flow. `position: absolute` (from the class) is also a valid containing block
  // for the badge below, so nothing here needs to set position itself.
  wrapper.style.cursor = "pointer";

  // The primary pin is larger only while its post is unfocused (acting as the
  // badge-counted overview marker). Once clicked/focused, it shrinks to match the
  // other pins in the post instead of staying oversized among its now-visible siblings.
  const size = opts.variant === "primary" && !opts.focused ? 32 : 24;
  // Orange marks the unfocused, badge-counted overview pin for a post. Once a post is
  // focused (a pin in it was clicked), every one of its pins — including the primary —
  // turns blue like the rest, so no destination is singled out as still-orange.
  const isOrange = opts.variant === "primary" && !opts.focused;
  const fill = isOrange ? "#f97316" : "#2563eb";
  const stroke = isOrange ? "#ea580c" : "#1d4ed8";

  wrapper.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 3px rgba(15,23,42,0.35))">
    <path d="M12 22s-7-6.1-7-11.5A7 7 0 0 1 19 10.5C19 15.9 12 22 12 22z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
    <circle cx="12" cy="10.3" r="2.6" fill="white"/>
  </svg>`;

  if (opts.badge && opts.badge > 0) {
    const badge = document.createElement("div");
    badge.textContent = `+${opts.badge}`;
    badge.style.cssText =
      "position:absolute;top:-4px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:9999px;" +
      "background:#0f172a;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;" +
      "justify-content:center;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,0.3);";
    wrapper.appendChild(badge);
  }

  return wrapper;
}

type TripMapProps = {
  posts: FeedMapPost[];
  focusedPostId: string | null;
  onSelectPost: (id: string) => void;
};

export default function TripMap({ posts, focusedPostId, onSelectPost }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const prevCameraRef = useRef<{ center: mapboxgl.LngLat; zoom: number } | null>(null);
  const onSelectPostRef = useRef(onSelectPost);
  useEffect(() => {
    onSelectPostRef.current = onSelectPost;
  }, [onSelectPost]);

  // Style-loaded is tracked as state (not a one-off `map.once("load", ...)` per effect)
  // so every downstream effect re-runs exactly once the map is actually ready, always
  // with its latest posts/focusedPostId closure — no stale-closure or duplicate-listener
  // risk that could leave "ghost" markers behind from an earlier, outdated render.
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
    map.on("load", () => setIsStyleLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setIsStyleLoaded(false);
    };
  }, []);

  // Markers: one primary pin per post (badge-counted), plus every secondary
  // destination pin for whichever post is currently focused.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    // Always clear every marker from the previous render before placing new ones —
    // otherwise a post that drops out of `posts` (filtered, or focus changed) would
    // leave its old pin stranded on the map.
    markersRef.current.forEach((m) => m.remove());
    const markers: mapboxgl.Marker[] = [];

    for (const post of posts) {
      const [primary, ...secondary] = post.points;
      if (!primary) continue;
      const isFocused = post.id === focusedPostId;

      const primaryEl = createPinElement({
        variant: "primary",
        badge: isFocused ? undefined : secondary.length,
        focused: isFocused,
      });
      primaryEl.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectPostRef.current(post.id);
      });
      markers.push(
        new mapboxgl.Marker({ element: primaryEl, anchor: "bottom" })
          .setLngLat([primary.lng, primary.lat])
          .addTo(map),
      );

      if (isFocused) {
        for (const point of secondary) {
          const el = createPinElement({ variant: "secondary", focused: true });
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            onSelectPostRef.current(post.id);
          });
          markers.push(
            new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([point.lng, point.lat]).addTo(map),
          );
        }
      }
    }

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [posts, focusedPostId, isStyleLoaded]);

  // Country boundary highlights + camera fit/reset for the focused post.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const focusedPost = posts.find((p) => p.id === focusedPostId) ?? null;
    const boundaryData = toBoundaryFeatureCollection(focusedPost?.countryCodes ?? []);

    const source = map.getSource(BOUNDARY_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(boundaryData);
    } else {
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
    }

    if (focusedPost) {
      if (!prevCameraRef.current) {
        prevCameraRef.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      const bounds = computeFocusBounds(focusedPost);
      if (bounds) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 900, essential: true });
      }
    } else if (prevCameraRef.current) {
      map.flyTo({ center: prevCameraRef.current.center, zoom: prevCameraRef.current.zoom, duration: 900, essential: true });
      prevCameraRef.current = null;
    }
  }, [focusedPostId, posts, isStyleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
