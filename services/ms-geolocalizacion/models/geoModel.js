// models/geoModel.js
// ms-geolocalizacion - Modelo de procesamiento geográfico
// Sistema C5 - Alerta Ciudadana

'use strict';

const NodeGeocoder = require('node-geocoder');

const geocoder = NodeGeocoder({ provider: 'openstreetmap' });
const GEO_TIMEOUT_MS = Number(process.env.GEO_TIMEOUT_MS || 750);
const GEO_CACHE_TTL_MS = Number(process.env.GEO_CACHE_TTL_MS || 15 * 60 * 1000);
const geoCache = new Map();

function cacheKey(lat, lon) {
  return `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
}

function getCachedGeo(lat, lon) {
  const key = cacheKey(lat, lon);
  const cached = geoCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.ts > GEO_CACHE_TTL_MS) {
    geoCache.delete(key);
    return null;
  }

  return {
    value: cached.value,
  };
}

function setCachedGeo(lat, lon, value) {
  geoCache.set(cacheKey(lat, lon), {
    ts: Date.now(),
    value,
  });
}

/**
 * Enriquece una alerta con datos de geolocalización inversa.
 * Realiza geocoding de las coordenadas lat/lon a dirección física.
 * @param {Object} alerta - Alerta con campo `coordenadas: { lat, lon }`
 * @returns {Object} alerta con campo `geolocalizacion` agregado
 */
async function enriquecerConGeo(alerta) {
  const { lat, lon } = alerta.coordenadas;

  const cached = getCachedGeo(lat, lon);
  if (cached) {
    alerta.geolocalizacion = cached.value;
    console.log(`[Geo] Cache hit para ${alerta.ID_dispositivo} → ${cached.value?.direccion || 'sin dirección'}`);
    return alerta;
  }

  try {
    const resultados = await Promise.race([
      geocoder.reverse({ lat, lon }),
      new Promise((resolve) => {
        setTimeout(() => resolve('timeout'), GEO_TIMEOUT_MS);
      }),
    ]);

    if (resultados === 'timeout') {
      console.warn(`[Geo] Timeout de ${GEO_TIMEOUT_MS}ms para (${lat}, ${lon}). Se continúa sin geocodificación.`);
      alerta.geolocalizacion = null;
      setCachedGeo(lat, lon, null);
      return alerta;
    }

    if (resultados && resultados.length > 0) {
      const r = resultados[0];
      const geolocalizacion = {
        direccion: r.formattedAddress || null,
        pais: r.country || null,
        ciudad: r.city || r.administrativeLevels?.level2long || null,
        estado: r.administrativeLevels?.level1long || null,
        codigoPostal: r.zipcode || null,
      };
      alerta.geolocalizacion = geolocalizacion;
      setCachedGeo(lat, lon, geolocalizacion);
      console.log(`[Geo] Alerta ${alerta.ID_dispositivo} → ${alerta.geolocalizacion.direccion}`);
    } else {
      console.warn(`[Geo] Sin resultados para (${lat}, ${lon}). Se asigna null.`);
      alerta.geolocalizacion = null;
      setCachedGeo(lat, lon, null);
    }
  } catch (err) {
    console.error(`[Geo] Error en geocoding para (${lat}, ${lon}):`, err.message);
    alerta.geolocalizacion = null;
    setCachedGeo(lat, lon, null);
  }

  return alerta;
}

module.exports = { enriquecerConGeo };
