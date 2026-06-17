// models/alertaModel.js
// ms-recepcionAlertas - Modelo de validación y esquema de alertas MQTT
// Sistema C5 - Alerta Ciudadana

'use strict';

/**
 * Prioridades válidas reconocidas por el sistema.
 * Deben coincidir con los configurados en el ESP32.
 */
const PRIORIDADES_VALIDAS = [
  'crítica',
  'critica',
  'alta',
  'baja',
  'media'
];

/**
 * Valida que un objeto de alerta tenga todos los campos requeridos
 * y que su estructura sea correcta.
 * @param {Object} alerta - El objeto a validar
 * @returns {{ valida: boolean, errores: string[] }}
 */
function validarAlerta(alerta) {
  const errores = [];

  if (!alerta.ID_dispositivo || typeof alerta.ID_dispositivo !== 'string') {
    errores.push('Campo "ID_dispositivo" es requerido y debe ser un string.');
  }

  if (!alerta.coordenadas || typeof alerta.coordenadas !== 'object') {
    errores.push('Campo "coordenadas" es requerido y debe ser un objeto.');
  } else {
    const { lat, lon } = alerta.coordenadas;
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
      errores.push('Campo "coordenadas.lat" debe ser un número entre -90 y 90.');
    }
    if (typeof lon !== 'number' || lon < -180 || lon > 180) {
      errores.push('Campo "coordenadas.lon" debe ser un número entre -180 y 180.');
    }
  }

  // Aceptar timestamp (ISO 8601) o timestamp_ms (milisegundos Unix)
  if (!alerta.timestamp && !alerta.timestamp_ms) {
    errores.push('Campo "timestamp" (ISO 8601) o "timestamp_ms" (milisegundos) es requerido.');
  } else if (alerta.timestamp && isNaN(Date.parse(alerta.timestamp))) {
    errores.push('Campo "timestamp" debe ser una fecha ISO 8601 válida.');
  } else if (alerta.timestamp_ms && !Number.isInteger(alerta.timestamp_ms)) {
    errores.push('Campo "timestamp_ms" debe ser un número entero (milisegundos Unix).');
  }

  if (!alerta.prioridad || typeof alerta.prioridad !== 'string') {
    errores.push('Campo "prioridad" es requerido y debe ser un string.');
  }

  if (!alerta.tipo_emergencia || typeof alerta.tipo_emergencia !== 'string' || !alerta.tipo_emergencia.trim()) {
    errores.push('Campo "tipo_emergencia" es requerido y debe ser un string no vacío.');
  }

  // alert_id es opcional pero recomendado para deduplicación
  // No validamos como error, solo como dato complementario

  return {
    valida: errores.length === 0,
    errores,
  };
}

/**
 * Normaliza una alerta (recorta strings, convierte tipo a minúsculas, timestamp a ISO 8601).
 * @param {Object} alerta
 * @returns {Object} alerta normalizada
 */
function normalizarAlerta(alerta) {
  // Convertir timestamp_ms a ISO 8601 si es necesario
  let timestamp = alerta.timestamp;
  if (!timestamp && alerta.timestamp_ms) {
    timestamp = new Date(alerta.timestamp_ms).toISOString();
  }

  return {
    ...alerta,
    ID_dispositivo: alerta.ID_dispositivo.trim(),
    prioridad: alerta.prioridad.trim().toLowerCase(),
    tipo_emergencia: alerta.tipo_emergencia.trim().toLowerCase(),
    timestamp: timestamp,
    coordenadas: {
      lat: Number(alerta.coordenadas.lat),
      lon: Number(alerta.coordenadas.lon),
    },
    recibido_en: new Date().toISOString(),
  };
}

module.exports = { validarAlerta, normalizarAlerta, PRIORIDADES_VALIDAS };
