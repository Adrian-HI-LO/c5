// routes/prioridadRoutes.js
// ms-prioridad - Rutas HTTP del microservicio
// Sistema C5 - Alerta Ciudadana

'use strict';

const express = require('express');
const router = express.Router();
const { REGLAS_PRIORIDAD, REGLAS_UNIDADES, NIVELES } = require('../models/prioridadModel');

/**
 * GET /health
 * Health check del microservicio de prioridad.
 */
router.get('/health', (req, res) => {
  const { redisClient } = req.app.locals;
  res.json({
    servicio: 'ms-prioridad',
    estado: 'activo',
    redis_conectado: redisClient ? redisClient.isReady : false,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /reglas
 * Expone las reglas de negocio de clasificación de prioridad.
 * Útil para documentación y auditoría del sistema.
 */
router.get('/reglas', (req, res) => {
  res.json({
    servicio: 'ms-prioridad',
    niveles_disponibles: NIVELES,
    reglas: REGLAS_PRIORIDAD,
    reglas_unidades_respuesta: REGLAS_UNIDADES,
    descripcion: 'Reglas de negocio para clasificación automática de alertas por prioridad.',
  });
});

/**
 * GET /stats
 * Muestra el estado de las colas de entrada y salida en Redis.
 */
router.get('/stats', async (req, res) => {
  try {
    const { redisClient } = req.app.locals;
    const [cola_entrada, cola_salida] = await Promise.all([
      redisClient.lLen('geolocalizadas_queue'),
      redisClient.lLen('priorizadas_queue'),
    ]);
    res.json({
      servicio: 'ms-prioridad',
      cola_entrada_pendientes: cola_entrada,
      cola_salida_procesadas: cola_salida,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar stats', detalle: err.message });
  }
});

module.exports = router;
