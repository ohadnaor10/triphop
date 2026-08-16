// Shared between TripMap (the main feed/search map) and TripDestinationsMap (the
// per-post "Show Trip Map" view) so neither camera can zoom out looser than this. Below
// it the whole globe (and then copies of it) fits on screen, where every marker collapses
// into a handful of meaningless blobs and panning stops meaning anything.
export const MIN_ZOOM = 1.5;
