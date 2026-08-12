-- country_region and country_bbox (0012_search_geo_lookup.sql) have row level security
-- enabled but no policy, so every SELECT against them returns zero rows — silently, with
-- no error, which is exactly how this went unnoticed.
--
-- Both are read by SECURITY INVOKER functions running as the caller, so the effect is
-- production-wide and not limited to the map:
--   * search_posts() (0013) uses country_region for region-containment matching and
--     country_bbox for cross-border bbox overlap — so searching a broad region
--     ("Europe") or a natural feature ("Alps") has been matching nothing at all;
--   * search_posts_map() (0016) uses both for its continent and country tiers, which
--     returned no bubbles at low zoom for the same reason.
--
-- Neither table holds anything remotely private: they are static, generated reference
-- data derived from world-countries and this repo's own bundled boundary polygons, and
-- the app is expected to work for signed-out visitors. Public read is the correct policy;
-- writes stay closed, since both are only ever populated by migrations.
create policy "country regions are publicly readable" on country_region for select using (true);
create policy "country bboxes are publicly readable" on country_bbox for select using (true);
