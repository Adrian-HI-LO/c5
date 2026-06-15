// routes/notificacionesRoutes.js
// ms-notificaciones - Rutas HTTP del microservicio
// Sistema C5 - Alerta Ciudadana

'use strict';

const express = require('express');
const router = express.Router();

/**
 * GET /health
 * Health check del microservicio de notificaciones.
 */
router.get('/health', (req, res) => {
  const { wss, redisClient } = req.app.locals;
  res.json({
    servicio: 'ms-notificaciones',
    estado: 'activo',
    operadores_conectados: wss ? wss.clients.size : 0,
    redis_conectado: redisClient ? redisClient.isReady : false,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /operadores
 * Retorna el número de operadores WebSocket conectados actualmente.
 */
router.get('/operadores', (req, res) => {
  const { wss } = req.app.locals;
  res.json({
    servicio: 'ms-notificaciones',
    operadores_conectados: wss ? wss.clients.size : 0,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /stats
 * Estadísticas del servicio: colas pendientes y operadores activos.
 */
router.get('/stats', async (req, res) => {
  try {
    const { wss, redisClient } = req.app.locals;
    const [priorizadas, fallidas, historial] = await Promise.all([
      redisClient.lLen('priorizadas_queue'),
      redisClient.lLen('failed_notifications_queue'),
      redisClient.lLen('historial_queue'),
    ]);

    res.json({
      servicio: 'ms-notificaciones',
      operadores_conectados: wss ? wss.clients.size : 0,
      cola_priorizadas_pendientes: priorizadas,
      cola_fallidas_pendientes: fallidas,
      cola_historial_pendientes: historial,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar stats', detalle: err.message });
  }
});

module.exports = router;
