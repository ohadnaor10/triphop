// Density-based clustering of map locations, in screen pixels rather than kilometres.
//
// Replaces the fixed zoom tiers this map used to render (continent below zoom 3, country
// below 5, city below 8). Tiers decide how to group before looking at the data, so they
// are wrong in both directions at once: every Thai post collapsed into a single bubble
// floating in the Gulf of Thailand, while two towns 20km apart drew as separate
// overlapping bubbles as soon as the zoom crossed a threshold.
//
// The question a map marker actually poses is "are these two things far enough apart to
// draw separately?", which is a question about pixels. Kilometres can't answer it: on a
// Mercator projection 50km near the equator and 50km in northern Norway occupy very
// different widths on screen, so a distance threshold in metres over-merges at one
// latitude and under-merges at the other. Projecting to pixels first makes the threshold
// mean the same thing everywhere on the map.

export type MapLocation = {
  /** One post's presence at one place. A post with three cities contributes three of these. */
  postId: string;
  placeId: string;
  label: string;
  lat: number;
  lng: number;
  /** The poster, carried through so a single-post marker can draw their avatar. */
  authorName: string;
  authorAvatarUrl: string | null;
  authorAvatarColor: string | null;
};

export type MapCluster = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  /** Distinct posts, not locations — a post with two cities inside one cluster counts once. */
  postCount: number;
  locationCount: number;
  /** Set only when this cluster is a single location, so the caller can open that post directly. */
  postId: string | null;
  /** Present alongside postId — a lone marker renders as its author's avatar, not a pin. */
  author: { name: string; avatarUrl: string | null; avatarColor: string | null } | null;
  /** [minLng, minLat, maxLng, maxLat] of the members, for zooming a cluster open. */
  bounds: [number, number, number, number];
};

// Roughly a bubble's diameter plus breathing room: two markers closer than this would
// visually collide, which is precisely when they should become one.
export const DEFAULT_MIN_SEPARATION_PX = 56;

// Mapbox GL uses 512px tiles, so the whole world spans 512 * 2^zoom pixels.
const WORLD_TILE_SIZE = 512;

function projectX(lng: number, worldSize: number): number {
  return ((lng + 180) / 360) * worldSize;
}

// Standard Web Mercator y. Latitudes are clamped just short of the poles, where the
// projection runs to infinity.
function projectY(lat: number, worldSize: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return worldSize * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
}

type WorkingCluster = {
  // Sums rather than a running mean, so merging is exact and order-independent.
  sumX: number;
  sumY: number;
  sumLat: number;
  sumLng: number;
  locationCount: number;
  postIds: Set<string>;
  label: string;
  postId: string | null;
  author: { name: string; avatarUrl: string | null; avatarColor: string | null };
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  alive: boolean;
  /** Bumped on every merge, so heap entries referring to an older shape are recognisably stale. */
  version: number;
};

function centroidX(c: WorkingCluster): number {
  return c.sumX / c.locationCount;
}

function centroidY(c: WorkingCluster): number {
  return c.sumY / c.locationCount;
}

// Square buckets one threshold wide, maintained incrementally as clusters merge. Any two
// centroids closer than the threshold must share a bucket or sit in adjacent ones, so
// scanning the 3x3 neighbourhood finds every candidate — this is an exact index, not an
// approximation.
class SpatialGrid {
  private cells = new Map<string, Set<number>>();

  constructor(private cellSize: number) {}

  private keyFor(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }

  insert(index: number, x: number, y: number) {
    const key = this.keyFor(x, y);
    const cell = this.cells.get(key);
    if (cell) cell.add(index);
    else this.cells.set(key, new Set([index]));
  }

  remove(index: number, x: number, y: number) {
    const key = this.keyFor(x, y);
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(index);
    if (cell.size === 0) this.cells.delete(key);
  }

  neighbours(x: number, y: number): number[] {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(`${cellX + dx}:${cellY + dy}`);
        if (cell) out.push(...cell);
      }
    }
    return out;
  }
}

type Pair = { a: number; b: number; distanceSq: number; versionA: number; versionB: number };

// Min-heap over candidate pairs. Merging is driven by "closest pair first", so the
// ordering has to be global — but recomputing every pair after each merge is what made a
// few thousand markers take seconds. Instead, pairs are pushed once, popped in distance
// order, and skipped if either endpoint has since been merged away (checked via a version
// counter rather than by eagerly deleting entries).
class PairHeap {
  private items: Pair[] = [];

  push(pair: Pair) {
    const items = this.items;
    items.push(pair);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].distanceSq <= items[i].distanceSq) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): Pair | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as Pair;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].distanceSq < items[smallest].distanceSq) smallest = left;
        if (right < items.length && items[right].distanceSq < items[smallest].distanceSq) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function merge(target: WorkingCluster, source: WorkingCluster) {
  target.sumX += source.sumX;
  target.sumY += source.sumY;
  target.sumLat += source.sumLat;
  target.sumLng += source.sumLng;
  // Compared before the counts are combined: the label should come from whichever side
  // brought more locations, so a cluster is named after its dominant place. Comparing
  // afterwards (or comparing per-location weights) leaves the name up to merge order,
  // which is how an 90-post cluster containing all of Bangkok ended up labelled after a
  // village that merely happened to be the merge target.
  if (source.locationCount > target.locationCount) target.label = source.label;
  target.locationCount += source.locationCount;
  for (const id of source.postIds) target.postIds.add(id);
  target.postId = null;
  target.minLng = Math.min(target.minLng, source.minLng);
  target.minLat = Math.min(target.minLat, source.minLat);
  target.maxLng = Math.max(target.maxLng, source.maxLng);
  target.maxLat = Math.max(target.maxLat, source.maxLat);
  target.version += 1;
  source.alive = false;
}

/**
 * Greedy agglomerative clustering: repeatedly merge the closest pair of markers until the
 * two closest remaining are further apart than `minSeparationPx`, then draw what's left.
 *
 * Distance is measured centroid-to-centroid rather than to a cluster's nearest member.
 * That choice matters: nearest-member (single) linkage chains — three points each 50px
 * from the next merge into one cluster spanning 150px — and destinations strung along a
 * coastline or a motorway are exactly the layout that triggers it, producing one absurd
 * cluster swallowing a whole region.
 *
 * Results depend only on zoom, never on where the map is panned, because the projection
 * is to absolute world pixels rather than to viewport-relative ones. Panning therefore
 * reveals a stable layout instead of rearranging markers under the user.
 */
export function clusterLocations(
  locations: MapLocation[],
  zoom: number,
  minSeparationPx: number = DEFAULT_MIN_SEPARATION_PX,
): MapCluster[] {
  if (locations.length === 0) return [];

  const worldSize = WORLD_TILE_SIZE * Math.pow(2, zoom);
  const clusters: WorkingCluster[] = locations.map((location) => ({
    sumX: projectX(location.lng, worldSize),
    sumY: projectY(location.lat, worldSize),
    sumLat: location.lat,
    sumLng: location.lng,
    locationCount: 1,
    postIds: new Set([location.postId]),
    label: location.label,
    postId: location.postId,
    author: {
      name: location.authorName,
      avatarUrl: location.authorAvatarUrl,
      avatarColor: location.authorAvatarColor,
    },
    minLng: location.lng,
    minLat: location.lat,
    maxLng: location.lng,
    maxLat: location.lat,
    alive: true,
    version: 0,
  }));

  const thresholdSq = minSeparationPx * minSeparationPx;
  const grid = new SpatialGrid(minSeparationPx);
  const heap = new PairHeap();

  const pushPairsFor = (index: number) => {
    const cluster = clusters[index];
    const x = centroidX(cluster);
    const y = centroidY(cluster);
    for (const other of grid.neighbours(x, y)) {
      if (other === index || !clusters[other].alive) continue;
      const distanceSq = (x - centroidX(clusters[other])) ** 2 + (y - centroidY(clusters[other])) ** 2;
      if (distanceSq >= thresholdSq) continue;
      heap.push({
        a: index,
        b: other,
        distanceSq,
        versionA: cluster.version,
        versionB: clusters[other].version,
      });
    }
  };

  clusters.forEach((cluster, index) => grid.insert(index, centroidX(cluster), centroidY(cluster)));
  clusters.forEach((_, index) => pushPairsFor(index));

  // Merges the globally closest pair first, so a dense knot collapses before a loose pair
  // on the other side of the map is considered — that ordering is what makes the result
  // independent of input order.
  for (;;) {
    const pair = heap.pop();
    if (!pair) break;
    const a = clusters[pair.a];
    const b = clusters[pair.b];
    // Stale: one endpoint has already been merged into something else, so this distance
    // no longer describes anything. The live replacement was pushed when that merge
    // happened, so nothing is lost by dropping it.
    if (!a.alive || !b.alive) continue;
    if (a.version !== pair.versionA || b.version !== pair.versionB) continue;

    grid.remove(pair.a, centroidX(a), centroidY(a));
    grid.remove(pair.b, centroidX(b), centroidY(b));
    merge(a, b);
    grid.insert(pair.a, centroidX(a), centroidY(a));
    // The merged centroid sits somewhere between the two, so it can now be within reach
    // of clusters neither original was close enough to — hence a fresh neighbour scan.
    pushPairsFor(pair.a);
  }

  return clusters
    .filter((cluster) => cluster.alive)
    .map((cluster) => ({
      key: `${cluster.postId ?? "c"}:${cluster.minLng.toFixed(4)}:${cluster.minLat.toFixed(4)}:${cluster.locationCount}`,
      label: cluster.label,
      lat: cluster.sumLat / cluster.locationCount,
      lng: cluster.sumLng / cluster.locationCount,
      postCount: cluster.postIds.size,
      locationCount: cluster.locationCount,
      postId: cluster.locationCount === 1 ? cluster.postId : null,
      author: cluster.locationCount === 1 ? cluster.author : null,
      bounds: [cluster.minLng, cluster.minLat, cluster.maxLng, cluster.maxLat] as [number, number, number, number],
    }));
}
