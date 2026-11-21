import data from "@/data/countries.json";

type CountryInfo = { ko: string; en: string; schengen?: boolean; zone?: string };
const table = data.countries as Record<string, CountryInfo>;

export function countryName(iso: string): string {
  return table[iso]?.ko ?? iso;
}
export function countryEn(iso: string): string {
  return table[iso]?.en ?? iso;
}
export function isSchengen(iso: string): boolean {
  return !!table[iso]?.schengen;
}
export function zoneOf(iso: string): string | undefined {
  return table[iso]?.zone;
}
