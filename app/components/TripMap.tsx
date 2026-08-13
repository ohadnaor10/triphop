"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { getCountryBoundary } from "../lib/geo";
import type { MapCluster } from "../lib/cluster";
import type { FocusedPlace, MapViewport } from "../lib/mapStore";

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
// A focused post with a single destination has no extent to fit either — close enough to
// place the city in its surroundings, not so close that all context is lost.
const SINGLE_PLACE_FOCUS_ZOOM = 11;

// Focusing a post used to also shade its countries with a translucent polygon. Kept, but
// off: at the zoom focusing lands on, a country-sized fill just tints the whole viewport
// and competes with the pins it is supposed to support. Flip to true to bring it back —
// toBoundaryFeatureCollection and the effect below are maintained for that.
const SHOW_FOCUSED_COUNTRY_SHADING = false;

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

function toBoundaryFeatureCollection(countryCodes: string[]): GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
> {
  const features = countryCodes
    .map((code) => getCountryBoundary(code))
    .filter((f): f is BoundaryFeature => Boolean(f));
  return { type: "FeatureCollection", features };
}

// Initials, matching app/components/Avatar.tsx's fallback so a photo and its stand-in read
// as the same piece of UI.
function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Tailwind gradient classes can't style a detached DOM node built outside React's tree, so
// the four the app assigns are mapped to their literal CSS. Anything unrecognised falls
// back to the default gradient rather than rendering an invisible circle.
const AVATAR_GRADIENTS: Record<string, string> = {
  "bg-gradient-to-br from-orange-400 to-pink-500": "linear-gradient(to bottom right, #fb923c, #ec4899)",
  "bg-gradient-to-br from-sky-400 to-indigo-500": "linear-gradient(to bottom right, #38bdf8, #6366f1)",
  "bg-gradient-to-br from-emerald-400 to-teal-500": "linear-gradient(to bottom right, #34d399, #14b8a6)",
  "bg-gradient-to-br from-fuchsia-400 to-purple-500": "linear-gradient(to bottom right, #e879f9, #a855f7)",
};

// A lone post draws as its author's face rather than an anonymous pin. On a map whose
// purpose is finding travel partners, *who* is going somewhere is the information; a wall
// of identical pins carries none of it.
//
// No inline `position` on the wrapper: Mapbox adds its own `.mapboxgl-marker` class
// (position: absolute) and positions it purely via a CSS transform on top of that. An
// inline `position: relative` would out-specificity the class, pull the marker into normal
// document flow, and turn the transform into an offset from the wrong origin — markers
// land nowhere near their real lng/lat and stack against each other.
function createAvatarElement(cluster: MapCluster, focused: boolean): HTMLDivElement {
  const wrapper = document.createElement("div");
  const author = cluster.author;
  wrapper.style.cssText = `width:36px;height:36px;border-radius:9999px;overflow:hidden;cursor:pointer;
    border:2px solid ${focused ? "#f97316" : "#ffffff"};box-shadow:0 2px 6px rgba(15,23,42,0.35);
    display:flex;align-items:center;justify-content:center;background:#e2e8f0;`;

  if (author?.avatarUrl) {
    const img = document.createElement("img");
    img.src = author.avatarUrl;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    wrapper.appendChild(img);
  } else {
    wrapper.style.background =
      AVATAR_GRADIENTS[author?.avatarColor ?? ""] ?? "linear-gradient(to bottom right, #fb923c, #ec4899)";
    const initials = document.createElement("span");
    initials.textContent = initialsOf(author?.name ?? "?");
    initials.style.cssText = "font-size:12px;font-weight:700;color:#fff;line-height:1;";
    wrapper.appendChild(initials);
  }

  wrapper.title = `${author?.name ?? "Traveler"} · ${cluster.label}`;
  return wrapper;
}

// A focused post's own destinations, each labelled: a three-city trip should be readable
// off the map itself rather than by cross-referencing the card above it. Not interactive —
// the card is the only thing to tap in focus mode.
function createLabelledPinElement(place: FocusedPlace): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;";
  wrapper.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 3px rgba(15,23,42,0.35))">
    <path d="M12 22s-7-6.1-7-11.5A7 7 0 0 1 19 10.5C19 15.9 12 22 12 22z" fill="#f97316" stroke="#ea580c" stroke-width="1"/>
    <circle cx="12" cy="10.3" r="2.6" fill="white"/>
  </svg>`;
  const label = document.createElement("span");
  label.textContent = place.label;
  label.style.cssText = `background:#fff;color:#0f172a;font-size:11px;font-weight:700;padding:2px 6px;
    border-radius:9999px;box-shadow:0 1px 3px rgba(15,23,42,0.3);white-space:nowrap;`;
  wrapper.appendChild(label);
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
  /**
   * Every destination of the focused post. While non-empty the map shows only these,
   * hiding all clusters and avatars so the trip is read on its own.
   */
  focusedPlaces: FocusedPlace[];
  /** Country codes of the focused post — only used when SHOW_FOCUSED_COUNTRY_SHADING is on. */
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
  focusedPlaces,
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

    // Focus mode: the focused post's own destinations replace everything else, so its
    // trip reads on its own instead of having to be picked out of a crowd of other
    // people's markers. The card's X clears focusedPostId, which brings the rest back.
    if (focusedPlaces.length > 0) {
      for (const place of focusedPlaces) {
        markers.push(
          new mapboxgl.Marker({ element: createLabelledPinElement(place), anchor: "bottom" })
            .setLngLat([place.lng, place.lat])
            .addTo(map),
        );
      }
      markersRef.current = markers;
      return () => {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
      };
    }

    for (const cluster of clusters) {
      // A cluster of one is a single post — drawn as its author's avatar, and tapping it
      // opens that post rather than zooming into it.
      const isSinglePost = cluster.postId !== null;
      const element = isSinglePost
        ? createAvatarElement(cluster, cluster.postId === focusedPostId)
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
        new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(map),
      );
    }

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [clusters, focusedPlaces, focusedPostId, isStyleLoaded]);

  // Frames the focused post: all of its destinations at once, since a trip's cities are
  // routinely spread far enough apart that the one that was tapped says nothing about
  // where the rest are.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded || focusedPlaces.length === 0) return;

    const [first] = focusedPlaces;
    if (focusedPlaces.length === 1) {
      map.easeTo({ center: [first.lng, first.lat], zoom: SINGLE_PLACE_FOCUS_ZOOM, duration: 700, essential: true });
      return;
    }
    const bounds = focusedPlaces.reduce(
      (acc, place) => acc.extend([place.lng, place.lat] as [number, number]),
      new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
    );
    map.fitBounds(bounds, { padding: 70, maxZoom: SINGLE_PLACE_FOCUS_ZOOM, duration: 700, essential: true });
  }, [focusedPlaces, isStyleLoaded]);

  // Dormant — see SHOW_FOCUSED_COUNTRY_SHADING. Left wired up rather than deleted so the
  // shading can be switched back on without having to rebuild it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded || !SHOW_FOCUSED_COUNTRY_SHADING) return;

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
