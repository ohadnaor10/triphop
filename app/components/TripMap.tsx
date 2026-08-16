"use client";

import turfBbox from "@turf/bbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { getCountryBoundary } from "../lib/geo";
import { canSplitByZooming, type MapCluster } from "../lib/cluster";
import type { FocusedPlace, MapViewport } from "../lib/mapStore";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const BOUNDARY_SOURCE_ID = "trip-map-focused-boundaries";
const BOUNDARY_FILL_LAYER = `${BOUNDARY_SOURCE_ID}-fill`;
const BOUNDARY_LINE_LAYER = `${BOUNDARY_SOURCE_ID}-line`;
const SPOTLIGHT_SOURCE_ID = "trip-map-destination-spotlight";
const SPOTLIGHT_FILL_LAYER = `${SPOTLIGHT_SOURCE_ID}-fill`;
const SPOTLIGHT_LINE_LAYER = `${SPOTLIGHT_SOURCE_ID}-line`;
const TRIP_LINK_SOURCE_ID = "trip-map-trip-links";
const TRIP_LINK_LAYER = `${TRIP_LINK_SOURCE_ID}-line`;

// How far out the map can be zoomed. Below this the whole globe (and then copies of it)
// fits on screen, where every marker collapses into a handful of meaningless blobs and
// panning stops meaning anything — so the camera simply doesn't go there.
const MIN_ZOOM = 1.5;
// A focused post with a single destination has no extent to fit either — close enough to
// place the city in its surroundings, not so close that all context is lost.
const SINGLE_PLACE_FOCUS_ZOOM = 7;

// Applied to every marker outside the focused trip while one is open — dimmed rather than
// removed, so the rest of the map still reads as real context instead of empty space.
const DIMMED_MARKER_OPACITY = 0.4;

// How far in the camera is allowed to go, and therefore the zoom at which "can this
// cluster ever be broken apart?" is decided.
const MAX_ZOOM = 18;

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
function createAvatarElement(cluster: MapCluster, focused: boolean, dimmed = false): HTMLDivElement {
  // Mapbox's Marker re-evaluates and overwrites `style.opacity` on its root element every
  // render frame (fog/globe/terrain occlusion — see Marker._evaluateOpacity), which fights
  // anything set here directly and always wins. Dimming has to live one layer below that,
  // on a child Mapbox never touches, or it gets silently snapped back to full opacity.
  const outer = document.createElement("div");
  outer.style.cursor = "pointer";

  const wrapper = document.createElement("div");
  const author = cluster.author;
  // A ghost stands for a country, not a spot on it, so it is drawn deliberately unlike a
  // real marker: dashed border, faded, no shadow. The style is the disclaimer — nothing
  // about a solid pin would tell you the location is a guess.
  const ghost = cluster.isGhost;
  wrapper.style.cssText = `width:36px;height:36px;border-radius:9999px;overflow:hidden;cursor:pointer;
    border:2px ${ghost ? "dashed #64748b" : `solid ${focused ? "#f97316" : "#ffffff"}`};
    ${ghost ? "opacity:0.72;" : "box-shadow:0 2px 6px rgba(15,23,42,0.35);"}
    ${dimmed ? `opacity:${DIMMED_MARKER_OPACITY};` : ""}
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

  outer.title = ghost
    ? `Somewhere in ${cluster.label} · no city set`
    : `${author?.name ?? "Traveler"} · ${cluster.label}`;
  outer.appendChild(wrapper);
  return outer;
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
function createBubbleElement(cluster: MapCluster, dimmed = false): HTMLDivElement {
  // See createAvatarElement above: Mapbox overwrites `style.opacity` on whatever element
  // is passed as the marker's root every render frame, so the dimmed look has to sit on a
  // child instead of the outer node.
  const outer = document.createElement("div");
  outer.style.cursor = "pointer";

  const wrapper = document.createElement("div");
  // Area, not diameter, tracks the count — sqrt keeps a 100-post bubble from dwarfing a
  // 10-post one by a factor of ten.
  const size = Math.min(64, 34 + Math.sqrt(cluster.postCount) * 4);
  // Same vague treatment as a ghost avatar: a country's worth of undecided trips is
  // still a guess about where those people will be.
  const ghost = cluster.isGhost;
  wrapper.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;
    background:${ghost ? "rgba(100,116,139,0.85)" : "rgba(249,115,22,0.92)"};
    color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;
    border:2px ${ghost ? "dashed #e2e8f0" : "solid #fff"};box-shadow:0 2px 6px rgba(15,23,42,0.35);cursor:pointer;
    ${dimmed ? `opacity:${DIMMED_MARKER_OPACITY};` : ""}`;
  const count = document.createElement("span");
  count.textContent = String(cluster.postCount);
  count.style.cssText = "font-size:13px;font-weight:800;";
  wrapper.appendChild(count);
  outer.title = ghost
    ? `${cluster.label} · ${cluster.postCount} trips with no city set`
    : `${cluster.label} · ${cluster.postCount} ${cluster.postCount === 1 ? "trip" : "trips"}`;
  outer.appendChild(wrapper);
  return outer;
}

export type TripMapProps = {
  /**
   * False while the map is mounted but hidden (the feed is showing). A hidden container
   * has zero size, so camera work has to wait, and Mapbox needs a resize once it is shown
   * again.
   */
  isVisible: boolean;
  clusters: MapCluster[];
  focusedPostId: string | null;
  /**
   * Every destination of the focused post. While non-empty the map shows only these,
   * hiding all clusters and avatars so the trip is read on its own.
   */
  focusedPlaces: FocusedPlace[];
  /** Every country the focused post names — all shaded behind its pins. */
  focusedCountryCodes: string[];
  /**
   * The subset with no city chosen. These widen the camera, because nothing else on the
   * map represents them; countries that already have pins do not, or a one-city post would
   * be framed to its whole country.
   */
  focusedUnpinnedCountryCodes: string[];
  /**
   * Everything *outside* the searched destinations, as one polygon with a hole per
   * selection, dimmed so the area in question reads at a glance. Null when nothing is
   * selected, or when a selection has no area to cut a hole from (see page.tsx).
   */
  spotlightMask: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  /**
   * Dashed spokes from each multi-stop trip's midpoint to its markers, so the same face
   * appearing in two places reads as one journey. Empty when the zoom is too far out to
   * make them worth drawing, or while a post is focused.
   */
  tripLinks: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  onSelectPost: (postId: string) => void;
  /**
   * A cluster that zooming can never separate — every member on one coordinate, or a
   * knot too tight to resolve even at max zoom. Zooming into one of those is a dead end,
   * so the caller opens a list of its posts instead.
   */
  onOpenClusterList: (cluster: MapCluster) => void;
  /** Fired on moveend (and once the style loads) so the caller can refetch for the new area. */
  onViewportChange: (viewport: MapViewport) => void;
  /**
   * DEBUG ONLY — fires continuously during a gesture, unlike onViewportChange which waits
   * for it to settle. Feeds the live zoom readout under the map; delete along with it.
   */
  onZoomChange?: (zoom: number) => void;
  /** Initial camera, applied once — used to open on the destination the user searched for. */
  initialBounds?: [number, number, number, number] | null;
};

export default function TripMap({
  isVisible,
  clusters,
  spotlightMask,
  tripLinks,
  onOpenClusterList,
  focusedPostId,
  focusedPlaces,
  focusedCountryCodes,
  focusedUnpinnedCountryCodes,
  onSelectPost,
  onViewportChange,
  onZoomChange,
  initialBounds,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Callbacks live in refs so the map/listener effects can stay mounted for the map's
  // whole lifetime: re-running them on every render would tear down and rebuild the
  // Mapbox instance, which is both a visible flicker and a billed map load.
  const onSelectPostRef = useRef(onSelectPost);
  const onOpenClusterListRef = useRef(onOpenClusterList);
  const onViewportChangeRef = useRef(onViewportChange);
  const onZoomChangeRef = useRef(onZoomChange);
  // Lets the visibility effect below re-announce the viewport without duplicating the
  // bounds-reading logic that lives inside the map-init effect.
  const emitViewportRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onSelectPostRef.current = onSelectPost;
    onOpenClusterListRef.current = onOpenClusterList;
    onViewportChangeRef.current = onViewportChange;
    onZoomChangeRef.current = onZoomChange;
  }, [onSelectPost, onOpenClusterList, onViewportChange, onZoomChange]);

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
      maxZoom: MAX_ZOOM,
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
    emitViewportRef.current = emitViewport;

    map.on("load", () => {
      setIsStyleLoaded(true);
      // The first emit is what triggers the initial fetch — without it the map would sit
      // empty until the user happened to move it.
      emitViewport();
    });
    map.on("moveend", emitViewport);
    // DEBUG ONLY: "move" fires throughout a gesture, where "moveend" only fires once it
    // stops — the readout is meant to track the zoom as it changes.
    map.on("move", () => onZoomChangeRef.current?.(map.getZoom()));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setIsStyleLoaded(false);
    };
  }, []);

  // Coming back from the feed. `display: none` collapses the container to zero size, and
  // Mapbox caches the dimensions it was last laid out with, so without a resize the map
  // returns stretched or blank. The viewport is re-announced afterwards so a filter
  // changed while the map was hidden gets picked up — the coverage cache in mapStore
  // makes that a no-op when nothing actually changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded || !isVisible) return;
    map.resize();
    emitViewportRef.current?.();
  }, [isVisible, isStyleLoaded]);

  // Opening camera for a newly-searched destination. Applied once per distinct bounds —
  // after that the user's own pan/zoom is left alone, since re-fitting on every render
  // would fight whatever they just did.
  const appliedBoundsRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded || !isVisible || !initialBounds) return;
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
  }, [initialBounds, isStyleLoaded, isVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    // Always clear the previous render's markers before placing new ones — otherwise a
    // marker that drops out of `clusters` (panned away, filtered out, or merged into a
    // neighbour) would be left stranded on the map.
    markersRef.current.forEach((m) => m.remove());
    const markers: mapboxgl.Marker[] = [];

    // Focus mode: the focused post gets its own labelled pins so its trip reads on its
    // own, drawn on top of everything else rather than in place of it. Keyed on the
    // focused id rather than on its places, because a country-only post has no places at
    // all and still gets labelled pins skipped — for those, the country shading below is
    // what makes the focus visible.
    if (focusedPostId) {
      for (const place of focusedPlaces) {
        markers.push(
          new mapboxgl.Marker({ element: createLabelledPinElement(place), anchor: "bottom" })
            .setLngLat([place.lng, place.lat])
            .addTo(map),
        );
      }
    }

    for (const cluster of clusters) {
      // The focused trip's own spots are already drawn above as labelled pins — skipping
      // any cluster that contains them here is what keeps those spots from also being
      // rendered merged into a bubble with other trips' markers.
      if (focusedPostId && cluster.postIds.includes(focusedPostId)) continue;

      // A cluster of one is a single post — drawn as its author's avatar, and tapping it
      // opens that post rather than zooming into it.
      const isSinglePost = cluster.postId !== null;
      // Dimmed, not hidden, while a trip is focused: DIMMED_MARKER_OPACITY keeps the rest
      // of the map legible as context instead of vanishing every other traveler.
      const dimmed = Boolean(focusedPostId);
      const element = isSinglePost
        ? createAvatarElement(cluster, cluster.postId === focusedPostId, dimmed)
        : createBubbleElement(cluster, dimmed);

      element.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isSinglePost && cluster.postId) {
          onSelectPostRef.current(cluster.postId);
          return;
        }

        // Zooming only helps if the members would actually come apart at maximum zoom.
        // Otherwise the tap is a dead end — the user zooms, the bubble stays whole, and
        // the posts inside it are unreachable. Those open a list instead.
        if (!canSplitByZooming(cluster, MAX_ZOOM)) {
          onOpenClusterListRef.current(cluster);
          return;
        }
        const [minLng, minLat, maxLng, maxLat] = cluster.bounds;
        // Fit the cluster's own extent rather than stepping a fixed amount: a tight knot
        // of towns needs far more zoom than a loose pair of cities, and one fixed step
        // gets both wrong.
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 80, maxZoom: MAX_ZOOM, duration: 700, essential: true },
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
    if (!map || !isStyleLoaded) return;

    // Everything the post covers: its pinned cities and any country it named without one.
    // Framing only the pins left the shaded country off-screen, so a trip that was half
    // decided looked entirely decided.
    const shaded = toBoundaryFeatureCollection(focusedUnpinnedCountryCodes);
    const hasShading = shaded.features.length > 0;
    if (focusedPlaces.length === 0 && !hasShading) return;

    // A lone city has no extent to fit, and no shaded country to widen it — centre instead,
    // or fitBounds would zoom to the maximum on a zero-area box.
    if (focusedPlaces.length === 1 && !hasShading) {
      const [only] = focusedPlaces;
      map.easeTo({ center: [only.lng, only.lat], zoom: SINGLE_PLACE_FOCUS_ZOOM, duration: 700, essential: true });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    for (const place of focusedPlaces) bounds.extend([place.lng, place.lat] as [number, number]);
    if (hasShading) {
      const [minLng, minLat, maxLng, maxLat] = turfBbox(shaded) as [number, number, number, number];
      bounds.extend([minLng, minLat]);
      bounds.extend([maxLng, maxLat]);
    }
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 60, maxZoom: SINGLE_PLACE_FOCUS_ZOOM, duration: 700, essential: true });
  }, [focusedPlaces, focusedUnpinnedCountryCodes, isStyleLoaded]);

  // Everything outside the searched destinations, dimmed. Drawn as a single polygon
  // covering the world with a hole cut for each selection, which is why one fill can dim
  // "everywhere except Thailand and Vietnam" without any per-country layers.
  //
  // The markers are DOM elements Mapbox positions above the canvas, so they are never
  // dimmed by this — only the map underneath is, which is the intent: the trips stay
  // fully legible, the geography they are not about recedes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const data: GeoJSON.FeatureCollection = spotlightMask
      ? { type: "FeatureCollection", features: [spotlightMask] }
      : empty;

    const source = map.getSource(SPOTLIGHT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(SPOTLIGHT_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: SPOTLIGHT_FILL_LAYER,
      type: "fill",
      source: SPOTLIGHT_SOURCE_ID,
      paint: { "fill-color": "#0f172a", "fill-opacity": 0.45 },
    });
    // A hairline on the boundary of the lit area, so the edge reads as deliberate rather
    // than as the scrim having failed to cover something.
    map.addLayer({
      id: SPOTLIGHT_LINE_LAYER,
      type: "line",
      source: SPOTLIGHT_SOURCE_ID,
      paint: { "line-color": "#f97316", "line-width": 1.5, "line-opacity": 0.9 },
    });
  }, [spotlightMask, isStyleLoaded]);

  // Every country the focused post names, tinted behind its pins. Shading used to be
  // suppressed whenever a post had any pins at all, which meant a trip that was specific
  // about one country and vague about another ("Bangkok, then somewhere in Laos") showed
  // only the Bangkok pin — the vague half of it simply vanished while focused.
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
  }, [focusedCountryCodes, focusedPlaces, isStyleLoaded]);

  // Dashed spokes joining one trip's markers. Added after the two fill layers so the lines
  // sit above them, and still below the markers — those are DOM elements Mapbox positions
  // over the canvas, so nothing here can cover a face.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const source = map.getSource(TRIP_LINK_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(tripLinks);
      return;
    }
    map.addSource(TRIP_LINK_SOURCE_ID, { type: "geojson", data: tripLinks });
    map.addLayer({
      id: TRIP_LINK_LAYER,
      type: "line",
      source: TRIP_LINK_SOURCE_ID,
      layout: { "line-cap": "round" },
      // Grey and dashed on purpose: this is a hint about which markers belong together,
      // not a route anyone is travelling, and a solid coloured line would read as one.
      paint: {
        "line-color": "#64748b",
        "line-width": 1.5,
        "line-opacity": 0.75,
        "line-dasharray": [2, 2],
      },
    });
  }, [tripLinks, isStyleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
