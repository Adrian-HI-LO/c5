// routes/alertasRoutes.js
// ms-recepcionAlertas - Rutas HTTP del microservicio
// Sistema C5 - Alerta Ciudadana

'use strict';

const express = require('express');
const router = express.Router();
const { PRIORIDADES_VALIDAS } = require('../models/alertaModel');

/**
 * GET /health
 * Health check del servicio. Retorna estado del MQTT y Redis.
 */
router.get('/health', (req, res) => {
  const { mqttClient, redisClient } = req.app.locals;
  res.json({
    servicio: 'ms-recepcion-alertas',
    estado: 'activo',
    mqtt_conectado: mqttClient ? mqttClient.connected : false,
    redis_conectado: redisClient ? redisClient.isReady : false,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /prioridades
 * Retorna las prioridades válidas aceptadas por el sistema.
 */
router.get('/prioridades', (req, res) => {
  res.json({
    prioridades_validas: PRIORIDADES_VALIDAS,
  });
});

/**
 * GET /stats
 * Estadísticas básicas del servicio (alertas encoladas en Redis).
 */
router.get('/stats', async (req, res) => {
  try {
    const { redisClient } = req.app.locals;
    const cola_alertas = await redisClient.lLen('alertas_queue');
    res.json({
      servicio: 'ms-recepcion-alertas',
      cola_alertas_pendientes: cola_alertas,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar stats', detalle: err.message });
  }
});

module.exports = router;
