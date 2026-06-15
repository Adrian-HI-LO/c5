// routes/geoRoutes.js
// ms-geolocalizacion - Rutas HTTP del microservicio
// Sistema C5 - Alerta Ciudadana

'use strict';

const express = require('express');
const router = express.Router();

/**
 * GET /health
 * Health check del servicio de geolocalización.
 */
router.get('/health', (req, res) => {
  const { redisClient } = req.app.locals;
  res.json({
    servicio: 'ms-geolocalizacion',
    estado: 'activo',
    redis_conectado: redisClient ? redisClient.isReady : false,
    timestamp: new Date().toISOString(),
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
      redisClient.lLen('alertas_queue'),
      redisClient.lLen('geolocalizadas_queue'),
    ]);
    res.json({
      servicio: 'ms-geolocalizacion',
      cola_entrada_pendientes: cola_entrada,
      cola_salida_procesadas: cola_salida,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar stats', detalle: err.message });
  }
});

module.exports = router;
