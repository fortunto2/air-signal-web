/* tslint:disable */
/* eslint-disable */

export function wasm_aqi_category(aqi: number): string;

/**
 * Classify what a PM10/PM2.5 ratio is telling you — dust, combustion, mixed traffic.
 *
 * Returns `{"category","label","confidence"}`. Cheap enough to run on every station page,
 * and it turns two numbers into the sentence a reader actually wanted.
 */
export function wasm_classify_source(pm25: number, pm10: number): string;

export function wasm_comfort_score(json: string): string;

/**
 * Feature names from matrix macro (single source of truth).
 */
export function wasm_feature_names(): string;

export function wasm_geomagnetic(kp: number): string;

export function wasm_haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;

/**
 * Latest row as SignalComfort JSON.
 */
export function wasm_matrix_latest(json: string): string;

/**
 * ML feature vector (35 dimensions).
 */
export function wasm_matrix_ml_vector(json: string): string;

/**
 * Push a row into matrix JSON, return updated matrix JSON.
 * row_json: `[80, 70, 90, ...]` (11 scores)
 */
export function wasm_matrix_push(matrix_json: string, ts: number, row_json: string): string;

/**
 * Sub-matrix for last N hours.
 */
export function wasm_matrix_slice(json: string, hours: number): string;

/**
 * Per-column summary statistics.
 */
export function wasm_matrix_summary(json: string): string;

/**
 * Merge a model forecast with a sensor median, weighting the model down as it diverges.
 *
 * This is the calculation behind the claim no other air map makes: a cheap sensor indoors or
 * next to a road reads several times high, and the merge says by how much instead of plotting
 * it at face value. Moscow, 2026-03: model 130 µg/m³ against a sensor median of 6.7 with ten
 * sensors agreeing → divergence > 10, model weight < 0.05, merged 6.2.
 *
 * Input JSON — every field optional except `sensor_count`:
 * `{"model_pm25":130,"model_pm10":160,"sensor_pm25":6.7,"sensor_pm10":10,"sensor_count":10}`
 *
 * Returns the serialized `MergedReading`: final `pm25`/`pm10`, both inputs, `model_weight`,
 * `divergence` and a `source` string ("sensors+model" | "sensors" | "model-only" | "no-data").
 */
export function wasm_merge(json: string): string;

export function wasm_moon_phase(year: number, month: number, day: number): number;

export function wasm_normalize_air(pm25: number): number;

export function wasm_normalize_daylight(hours: number): number;

export function wasm_normalize_earthquake(magnitude: number): number;

export function wasm_normalize_fire(distance_km: number): number;

export function wasm_normalize_geomagnetic(kp: number): number;

export function wasm_normalize_humidity(humidity_pct: number): number;

export function wasm_normalize_marine(wave_height_m: number): number;

export function wasm_normalize_moon(phase: number): number;

export function wasm_normalize_noise(db: number): number;

export function wasm_normalize_pollen(max_pollen: number): number;

export function wasm_normalize_pressure(current_hpa: number, change_3h: number): number;

export function wasm_normalize_temperature(temp_c: number): number;

export function wasm_normalize_uv(uv: number): number;

export function wasm_normalize_wind(speed_kmh: number): number;

export function wasm_overall_aqi(json: string): number;

export function wasm_pm10_aqi(value: number): number;

export function wasm_pm25_aqi(value: number): number;

export function wasm_pollen_status(json: string): string;

export function wasm_pollutant_status(pollutant: string, value: number): string;

export function wasm_progress_bar(score: number): string;

/**
 * Input JSON: `{"air":22,"temperature":85,"uv":70,"sea":90,...}`
 * Returns JSON: `{"total":75,"air":22,...}`
 */
export function wasm_signal_comfort(json: string): string;

/**
 * Signal column names from macro.
 */
export function wasm_signal_names(): string;

/**
 * 35-dim ML vector from SignalComfort JSON.
 */
export function wasm_signal_vector(json: string): string;

/**
 * Signal weights from macro.
 */
export function wasm_signal_weights(): string;

export function wasm_wind_direction(degrees: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasm_aqi_category: (a: number) => [number, number];
    readonly wasm_classify_source: (a: number, b: number) => [number, number];
    readonly wasm_comfort_score: (a: number, b: number) => [number, number];
    readonly wasm_feature_names: () => [number, number];
    readonly wasm_geomagnetic: (a: number) => [number, number];
    readonly wasm_matrix_latest: (a: number, b: number) => [number, number];
    readonly wasm_matrix_ml_vector: (a: number, b: number) => [number, number];
    readonly wasm_matrix_push: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasm_matrix_slice: (a: number, b: number, c: number) => [number, number];
    readonly wasm_matrix_summary: (a: number, b: number) => [number, number];
    readonly wasm_merge: (a: number, b: number) => [number, number];
    readonly wasm_moon_phase: (a: number, b: number, c: number) => number;
    readonly wasm_normalize_daylight: (a: number) => number;
    readonly wasm_normalize_earthquake: (a: number) => number;
    readonly wasm_normalize_fire: (a: number) => number;
    readonly wasm_normalize_geomagnetic: (a: number) => number;
    readonly wasm_normalize_humidity: (a: number) => number;
    readonly wasm_normalize_marine: (a: number) => number;
    readonly wasm_normalize_moon: (a: number) => number;
    readonly wasm_normalize_noise: (a: number) => number;
    readonly wasm_normalize_pollen: (a: number) => number;
    readonly wasm_normalize_temperature: (a: number) => number;
    readonly wasm_normalize_uv: (a: number) => number;
    readonly wasm_normalize_wind: (a: number) => number;
    readonly wasm_overall_aqi: (a: number, b: number) => number;
    readonly wasm_pollen_status: (a: number, b: number) => [number, number];
    readonly wasm_pollutant_status: (a: number, b: number, c: number) => [number, number];
    readonly wasm_progress_bar: (a: number) => [number, number];
    readonly wasm_signal_comfort: (a: number, b: number) => [number, number];
    readonly wasm_signal_vector: (a: number, b: number) => [number, number];
    readonly wasm_signal_weights: () => [number, number];
    readonly wasm_wind_direction: (a: number) => [number, number];
    readonly wasm_normalize_air: (a: number) => number;
    readonly wasm_haversine: (a: number, b: number, c: number, d: number) => number;
    readonly wasm_normalize_pressure: (a: number, b: number) => number;
    readonly wasm_signal_names: () => [number, number];
    readonly wasm_pm10_aqi: (a: number) => number;
    readonly wasm_pm25_aqi: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
