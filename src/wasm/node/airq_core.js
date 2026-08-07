/* @ts-self-types="./airq_core.d.ts" */

/**
 * @param {number} aqi
 * @returns {string}
 */
function wasm_aqi_category(aqi) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_aqi_category(aqi);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_aqi_category = wasm_aqi_category;

/**
 * Initial bearing from the first point to the second, in degrees clockwise from north.
 *
 * Exported because the source pass needs it and `directional_cluster` already uses it: which
 * side of town a factory is on and which side the anomalous sensors are on have to be measured
 * the same way, or comparing them is meaningless.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function wasm_bearing(lat1, lon1, lat2, lon2) {
    const ret = wasm.wasm_bearing(lat1, lon1, lat2, lon2);
    return ret;
}
exports.wasm_bearing = wasm_bearing;

/**
 * Which neighbour is making the air bad — the conditional probability function.
 *
 * Given a month of hourly PM2.5 alongside the wind that blew during each of those hours, and
 * a list of nearby sources, this scores each source by *the fraction of hours with wind from
 * its direction that landed in the worst quarter of readings*. A works that only matters on a
 * northerly scores high; a motorway that is always there scores flat.
 *
 * The reportable number is not the score, though — it is `avg_pm25_in_sector` against
 * `avg_pm25_other`: "when the wind is off the port you breathe 31 µg/m³, otherwise 12".
 *
 * Input JSON:
 * ```json
 * { "lat": 48.78, "lon": 9.18, "percentile": 0.75,
 *   "sources": [{ "name": "Cement works", "lat": 48.9, "lon": 9.3,
 *                 "source_type": "factory", "distance_km": 14.2 }],
 *   "pm25": [12.0, 31.0, ...], "wind_dirs": [210.0, ...], "wind_speeds": [8.0, ...] }
 * ```
 * The three arrays are parallel and hourly; hours with wind under 5 km/h are ignored, because
 * calm air carries nothing from anywhere.
 * @param {string} json
 * @returns {string}
 */
function wasm_calculate_cpf(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_calculate_cpf(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_calculate_cpf = wasm_calculate_cpf;

/**
 * Classify what a PM10/PM2.5 ratio is telling you — dust, combustion, mixed traffic.
 *
 * Returns the full `SourceClassification`: category, label, confidence, a reason with the
 * numbers in it, the typical sources, and advice. Cheap enough to run on every station page,
 * and it turns two numbers into the sentence a reader actually wanted.
 * @param {number} pm25
 * @param {number} pm10
 * @returns {string}
 */
function wasm_classify_source(pm25, pm10) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_classify_source(pm25, pm10);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_classify_source = wasm_classify_source;

/**
 * @param {string} json
 * @returns {string}
 */
function wasm_comfort_score(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_comfort_score(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_comfort_score = wasm_comfort_score;

/**
 * Is this a real event, or one sensor having a bad day?
 *
 * The question every air map gets wrong. A single device reading high is noise; seven devices
 * reading high *on the same side of town* is something arriving, and the difference is the
 * whole value of having a network rather than a sensor.
 *
 * Input JSON:
 * ```json
 * { "lat": 48.78, "lon": 9.18, "k": 2.0,
 *   "readings": [{ "sensor_id": 1, "lat": 48.8, "lon": 9.2, "pm25": 31.0, "pm10": 44.0 }],
 *   "baseline": { "pm25": 8.0, "pm25_var": 9.0, "pm10": 14.0, "pm10_var": 20.0 } }
 * ```
 *
 * `baseline` is supplied rather than accumulated, which is what lets this run without a
 * database: hand it the median and variance of the readings themselves and the comparison
 * becomes spatial — this sensor against its neighbours right now — instead of temporal.
 *
 * Returns the whole `EventAnalysis`: concordance and event type, the direction the anomaly
 * sits in with its angular spread, medians, the PM ratio and its source classification,
 * a confidence, and a composed summary sentence.
 * @param {string} json
 * @returns {string}
 */
function wasm_detect_event(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_detect_event(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_detect_event = wasm_detect_event;

/**
 * Feature names from matrix macro (single source of truth).
 * @returns {string}
 */
function wasm_feature_names() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_feature_names();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_feature_names = wasm_feature_names;

/**
 * @param {number} kp
 * @returns {string}
 */
function wasm_geomagnetic(kp) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_geomagnetic(kp);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_geomagnetic = wasm_geomagnetic;

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function wasm_haversine(lat1, lon1, lat2, lon2) {
    const ret = wasm.wasm_haversine(lat1, lon1, lat2, lon2);
    return ret;
}
exports.wasm_haversine = wasm_haversine;

/**
 * List all countries. Returns JSON array of strings.
 * @returns {string}
 */
function wasm_list_countries() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_list_countries();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_list_countries = wasm_list_countries;

/**
 * Get major cities for a country. Returns JSON array.
 * @param {string} country
 * @param {number} limit
 * @returns {string}
 */
function wasm_major_cities(country, limit) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(country, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_major_cities(ptr0, len0, limit);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_major_cities = wasm_major_cities;

/**
 * Latest row as SignalComfort JSON.
 * @param {string} json
 * @returns {string}
 */
function wasm_matrix_latest(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_matrix_latest(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_matrix_latest = wasm_matrix_latest;

/**
 * ML feature vector (35 dimensions).
 * @param {string} json
 * @returns {string}
 */
function wasm_matrix_ml_vector(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_matrix_ml_vector(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_matrix_ml_vector = wasm_matrix_ml_vector;

/**
 * Push a row into matrix JSON, return updated matrix JSON.
 * row_json: `[80, 70, 90, ...]` (11 scores)
 * @param {string} matrix_json
 * @param {number} ts
 * @param {string} row_json
 * @returns {string}
 */
function wasm_matrix_push(matrix_json, ts, row_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(matrix_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(row_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_matrix_push(ptr0, len0, ts, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.wasm_matrix_push = wasm_matrix_push;

/**
 * Sub-matrix for last N hours.
 * @param {string} json
 * @param {number} hours
 * @returns {string}
 */
function wasm_matrix_slice(json, hours) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_matrix_slice(ptr0, len0, hours);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_matrix_slice = wasm_matrix_slice;

/**
 * Per-column summary statistics.
 * @param {string} json
 * @returns {string}
 */
function wasm_matrix_summary(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_matrix_summary(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_matrix_summary = wasm_matrix_summary;

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
 * @param {string} json
 * @returns {string}
 */
function wasm_merge(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_merge(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_merge = wasm_merge;

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {number}
 */
function wasm_moon_phase(year, month, day) {
    const ret = wasm.wasm_moon_phase(year, month, day);
    return ret;
}
exports.wasm_moon_phase = wasm_moon_phase;

/**
 * @param {number} pm25
 * @returns {number}
 */
function wasm_normalize_air(pm25) {
    const ret = wasm.wasm_normalize_air(pm25);
    return ret >>> 0;
}
exports.wasm_normalize_air = wasm_normalize_air;

/**
 * @param {number} hours
 * @returns {number}
 */
function wasm_normalize_daylight(hours) {
    const ret = wasm.wasm_normalize_daylight(hours);
    return ret >>> 0;
}
exports.wasm_normalize_daylight = wasm_normalize_daylight;

/**
 * @param {number} magnitude
 * @returns {number}
 */
function wasm_normalize_earthquake(magnitude) {
    const ret = wasm.wasm_normalize_earthquake(magnitude);
    return ret >>> 0;
}
exports.wasm_normalize_earthquake = wasm_normalize_earthquake;

/**
 * @param {number} distance_km
 * @returns {number}
 */
function wasm_normalize_fire(distance_km) {
    const ret = wasm.wasm_normalize_fire(distance_km);
    return ret >>> 0;
}
exports.wasm_normalize_fire = wasm_normalize_fire;

/**
 * @param {number} kp
 * @returns {number}
 */
function wasm_normalize_geomagnetic(kp) {
    const ret = wasm.wasm_normalize_geomagnetic(kp);
    return ret >>> 0;
}
exports.wasm_normalize_geomagnetic = wasm_normalize_geomagnetic;

/**
 * @param {number} humidity_pct
 * @returns {number}
 */
function wasm_normalize_humidity(humidity_pct) {
    const ret = wasm.wasm_normalize_humidity(humidity_pct);
    return ret >>> 0;
}
exports.wasm_normalize_humidity = wasm_normalize_humidity;

/**
 * @param {number} wave_height_m
 * @returns {number}
 */
function wasm_normalize_marine(wave_height_m) {
    const ret = wasm.wasm_normalize_marine(wave_height_m);
    return ret >>> 0;
}
exports.wasm_normalize_marine = wasm_normalize_marine;

/**
 * @param {number} phase
 * @returns {number}
 */
function wasm_normalize_moon(phase) {
    const ret = wasm.wasm_normalize_moon(phase);
    return ret >>> 0;
}
exports.wasm_normalize_moon = wasm_normalize_moon;

/**
 * @param {number} db
 * @returns {number}
 */
function wasm_normalize_noise(db) {
    const ret = wasm.wasm_normalize_noise(db);
    return ret >>> 0;
}
exports.wasm_normalize_noise = wasm_normalize_noise;

/**
 * @param {number} max_pollen
 * @returns {number}
 */
function wasm_normalize_pollen(max_pollen) {
    const ret = wasm.wasm_normalize_pollen(max_pollen);
    return ret >>> 0;
}
exports.wasm_normalize_pollen = wasm_normalize_pollen;

/**
 * @param {number} current_hpa
 * @param {number} change_3h
 * @returns {number}
 */
function wasm_normalize_pressure(current_hpa, change_3h) {
    const ret = wasm.wasm_normalize_pressure(current_hpa, change_3h);
    return ret >>> 0;
}
exports.wasm_normalize_pressure = wasm_normalize_pressure;

/**
 * @param {number} temp_c
 * @returns {number}
 */
function wasm_normalize_temperature(temp_c) {
    const ret = wasm.wasm_normalize_temperature(temp_c);
    return ret >>> 0;
}
exports.wasm_normalize_temperature = wasm_normalize_temperature;

/**
 * @param {number} uv
 * @returns {number}
 */
function wasm_normalize_uv(uv) {
    const ret = wasm.wasm_normalize_uv(uv);
    return ret >>> 0;
}
exports.wasm_normalize_uv = wasm_normalize_uv;

/**
 * @param {number} speed_kmh
 * @returns {number}
 */
function wasm_normalize_wind(speed_kmh) {
    const ret = wasm.wasm_normalize_wind(speed_kmh);
    return ret >>> 0;
}
exports.wasm_normalize_wind = wasm_normalize_wind;

/**
 * @param {string} json
 * @returns {number}
 */
function wasm_overall_aqi(json) {
    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wasm_overall_aqi(ptr0, len0);
    return ret >>> 0;
}
exports.wasm_overall_aqi = wasm_overall_aqi;

/**
 * @param {number} value
 * @returns {number}
 */
function wasm_pm10_aqi(value) {
    const ret = wasm.wasm_pm10_aqi(value);
    return ret >>> 0;
}
exports.wasm_pm10_aqi = wasm_pm10_aqi;

/**
 * @param {number} value
 * @returns {number}
 */
function wasm_pm25_aqi(value) {
    const ret = wasm.wasm_pm25_aqi(value);
    return ret >>> 0;
}
exports.wasm_pm25_aqi = wasm_pm25_aqi;

/**
 * @param {string} json
 * @returns {string}
 */
function wasm_pollen_status(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_pollen_status(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_pollen_status = wasm_pollen_status;

/**
 * @param {string} pollutant
 * @param {number} value
 * @returns {string}
 */
function wasm_pollutant_status(pollutant, value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(pollutant, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_pollutant_status(ptr0, len0, value);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_pollutant_status = wasm_pollutant_status;

/**
 * @param {number} score
 * @returns {string}
 */
function wasm_progress_bar(score) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_progress_bar(score);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_progress_bar = wasm_progress_bar;

/**
 * Search cities by name prefix. Returns JSON array of {name, country, lat, lon}.
 * Max 10 results.
 * @param {string} query
 * @returns {string}
 */
function wasm_search_cities(query) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_search_cities(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_search_cities = wasm_search_cities;

/**
 * Input JSON: `{"air":22,"temperature":85,"uv":70,"sea":90,...}`
 * Returns JSON: `{"total":75,"air":22,...}`
 * @param {string} json
 * @returns {string}
 */
function wasm_signal_comfort(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_signal_comfort(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_signal_comfort = wasm_signal_comfort;

/**
 * Signal column names from macro.
 * @returns {string}
 */
function wasm_signal_names() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_signal_names();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_signal_names = wasm_signal_names;

/**
 * 35-dim ML vector from SignalComfort JSON.
 * @param {string} json
 * @returns {string}
 */
function wasm_signal_vector(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasm_signal_vector(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.wasm_signal_vector = wasm_signal_vector;

/**
 * Signal weights from macro.
 * @returns {string}
 */
function wasm_signal_weights() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_signal_weights();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_signal_weights = wasm_signal_weights;

/**
 * @param {number} degrees
 * @returns {string}
 */
function wasm_wind_direction(degrees) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wasm_wind_direction(degrees);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wasm_wind_direction = wasm_wind_direction;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./airq_core_bg.js": import0,
    };
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/airq_core_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
