/**
 * The Open-Meteo URLs a crew plan reads, built in one place so the worker and the CLI's warm-up
 * (`pnpm tsx cli/main.ts warm-crew`) produce byte-identical cache keys. Pure: no `cloudflare:workers`.
 */

/** 0.05° ≈ 5 km: finer than CAMS (≈ 11 km over Europe) and Open-Meteo's weather grid, so no detail is lost. */
export const cell = (deg: number) => Math.round(deg * 20) / 20;

export function forecastUrls(lat: number, lon: number, tz: string): { air: string; weather: string } {
  const q = `latitude=${cell(lat)}&longitude=${cell(lon)}&past_days=1&forecast_days=3&timezone=${encodeURIComponent(tz || "auto")}`;
  return {
    air: `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5,pm10`,
    weather: `https://api.open-meteo.com/v1/forecast?${q}&hourly=temperature_2m,relative_humidity_2m,winddirection_10m,windspeed_10m`,
  };
}
