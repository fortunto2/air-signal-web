/**
 * The Turkish towns with their own page (`/tr/<slug>`), as data: name, district, coordinates and
 * the zone. A plan for one of them needs no geocoder call, which matters on a day Open-Meteo refuses
 * our egress IP (it serves the geocoder too). Coordinates are the town centres from Open-Meteo's
 * geocoder (GeoNames), checked 3 Nov 2026; Kaş from GeoNames directly.
 *
 * Pure (no `cloudflare:workers`), so tests and the CLI can import it.
 */

export interface TrPlace {
  slug: string;
  name: string;
  /** İlçe (district) and il (province), for display. */
  district: string;
  province: string;
  lat: number;
  lon: number;
  /** What the crops and the work are there, one plain line for the page. */
  work: string;
}

export const TR_TZ = "Europe/Istanbul";

export const TR_PLACES: TrPlace[] = [
  { slug: "antalya", name: "Antalya", district: "Muratpaşa", province: "Antalya", lat: 36.9081, lon: 30.6956, work: "İnşaat, otel bakımı, liman ve kent çevresindeki seralar" },
  { slug: "alanya", name: "Alanya", district: "Alanya", province: "Antalya", lat: 36.5438, lon: 31.9998, work: "Muz ve avokado bahçeleri, seralar, inşaat" },
  { slug: "gazipasa", name: "Gazipaşa", district: "Gazipaşa", province: "Antalya", lat: 36.2694, lon: 32.3179, work: "Muz seraları, açık tarla, havalimanı çevresinde inşaat" },
  { slug: "kumluca", name: "Kumluca", district: "Kumluca", province: "Antalya", lat: 36.3703, lon: 30.2869, work: "Örtü altı sebze: domates, biber, patlıcan seraları" },
  { slug: "demre", name: "Demre", district: "Demre", province: "Antalya", lat: 36.2444, lon: 29.985, work: "Domates ve biber seraları" },
  { slug: "finike", name: "Finike", district: "Finike", province: "Antalya", lat: 36.295, lon: 30.1406, work: "Portakal bahçeleri ve seralar" },
  { slug: "kas", name: "Kaş", district: "Kaş", province: "Antalya", lat: 36.2018, lon: 29.6377, work: "Seralar, turizm inşaatı ve bakım" },
  { slug: "serik", name: "Serik", district: "Serik", province: "Antalya", lat: 36.9175, lon: 31.1046, work: "Açık tarla, seralar, Belek'te otel inşaatı" },
  { slug: "manavgat", name: "Manavgat", district: "Manavgat", province: "Antalya", lat: 36.7867, lon: 31.4409, work: "Seralar, açık tarla, orman kenarında çalışma" },
  { slug: "kemer", name: "Kemer", district: "Kemer", province: "Antalya", lat: 36.5978, lon: 30.5606, work: "Otel inşaatı ve bakım, narenciye bahçeleri" },
];

/** Lower-case, Turkish letters folded to ASCII: "Gazipaşa", "gazipasa" and "GAZİPAŞA" all match. */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/i̇/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim();
}

/** A typed name ("Gazipaşa", "gazipasa", "Alanya, Turkey") → the town, or undefined. */
export function trPlaceByName(raw: string): TrPlace | undefined {
  const [name, hint] = raw.split(",").map((x) => fold(x));
  if (!name) return undefined;
  if (hint && !["tr", "turkey", "turkiye", "antalya"].includes(hint)) return undefined;
  return TR_PLACES.find((p) => p.slug === name || fold(p.name) === name);
}

export const trPlaceBySlug = (slug: string) => TR_PLACES.find((p) => p.slug === slug);

/** The nearest listed town within `maxKm`, for a bare coordinate when the geocoder cannot be asked. */
export function nearestTrPlace(lat: number, lon: number, maxKm = 40): TrPlace | undefined {
  const d = (p: TrPlace) => {
    const x = (p.lon - lon) * Math.cos(((p.lat + lat) / 2) * (Math.PI / 180));
    const y = p.lat - lat;
    return Math.sqrt(x * x + y * y) * 111.2;
  };
  const best = [...TR_PLACES].sort((a, b) => d(a) - d(b))[0];
  return best && d(best) <= maxKm ? best : undefined;
}
