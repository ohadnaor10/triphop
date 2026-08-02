import { getCountryByCode, type GeoCountry } from "../lib/geo";

// Hand-picked list of well-traveled countries shown in the destination picker's
// horizontal scroll before the user has typed a search query.
const POPULAR_DESTINATION_CODES = [
  "FR",
  "IT",
  "ES",
  "JP",
  "TH",
  "US",
  "GB",
  "GR",
  "PT",
  "MX",
  "ID",
  "TR",
  "AE",
  "AU",
  "VN",
  "MA",
  "EG",
  "IN",
  "DE",
  "NL",
  "IS",
  "HR",
  "PE",
  "KR",
  "CH",
  "NZ",
];

export function getPopularDestinations(): GeoCountry[] {
  return POPULAR_DESTINATION_CODES.map((code) => getCountryByCode(code)).filter(
    (c): c is GeoCountry => c !== undefined,
  );
}
