// models/geoModel.js
// ms-geolocalizacion - Modelo de procesamiento geográfico
// Sistema C5 - Alerta Ciudadana

'use strict';

const NodeGeocoder = require('node-geocoder');

const geocoder = NodeGeocoder({ provider: 'openstreetmap' });

/**
 * Enriquece una alerta con datos de geolocalización inversa.
 * Realiza geocoding de las coordenadas lat/lon a dirección física.
 * @param {Object} alerta - Alerta con campo `coordenadas: { lat, lon }`
 * @returns {Object} alerta con campo `geolocalizacion` agregado
 */
async function enriquecerConGeo(alerta) {
  const { lat, lon } = alerta.coordenadas;

  try {
    const resultados = await geocoder.reverse({ lat, lon });

    if (resultados && resultados.length > 0) {
      const r = resultados[0];
      alerta.geolocalizacion = {
        direccion: r.formattedAddress || null,
        pais: r.country || null,
        ciudad: r.city || r.administrativeLevels?.level2long || null,
        estado: r.administrativeLevels?.level1long || null,
        codigoPostal: r.zipcode || null,
      };
      console.log(`[Geo] Alerta ${alerta.ID_dispositivo} → ${alerta.geolocalizacion.direccion}`);
    } else {
      console.warn(`[Geo] Sin resultados para (${lat}, ${lon}). Se asigna null.`);
      alerta.geolocalizacion = null;
    }
  } catch (err) {
    console.error(`[Geo] Error en geocoding para (${lat}, ${lon}):`, err.message);
    alerta.geolocalizacion = null;
  }

  return alerta;
}

module.exports = { enriquecerConGeo };
