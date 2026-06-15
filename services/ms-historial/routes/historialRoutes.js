// routes/historialRoutes.js
// ms-historial - Rutas HTTP del microservicio
// Sistema C5 - Alerta Ciudadana

'use strict';

const express = require('express');
const router = express.Router();
const { consultarAlertas } = require('../models/alertaDbModel');

/**
 * GET /historial
 * Consulta alertas con filtros opcionales por fecha, zona y prioridad.
 * Las lecturas se realizan desde la réplica (consistencia eventual).
 *
 * Query params:
 *   - fecha_inicio  (ISO 8601)
 *   - fecha_fin     (ISO 8601)
 *   - zona          (ciudad, búsqueda parcial)
 *   - prioridad     (crítica | alta | media)
 */
router.get('/historial', async (req, res) => {
  try {
    const filtros = {
      fecha_inicio: req.query.fecha_inicio,
      fecha_fin:    req.query.fecha_fin,
      zona:         req.query.zona,
      prioridad:    req.query.prioridad,
    };

    const alertas = await consultarAlertas(filtros);
    res.json({
      total: alertas.length,
      fuente: 'replica',
      consistencia: 'eventual',
      alertas,
    });

  } catch (err) {
    console.error('[HTTP] Error al consultar historial:', err.message);
    res.status(500).json({ error: 'Error interno al consultar el historial.', detalle: err.message });
  }
});

/**
 * GET /historial/:id
 * Consulta una alerta específica por ID.
 */
router.get('/historial/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'El ID debe ser un número entero.' });
    }

    const alertas = await consultarAlertas({});
    const alerta = alertas.find((a) => a.id === id);
    if (!alerta) {
      return res.status(404).json({ error: `Alerta con id ${id} no encontrada.` });
    }
    res.json(alerta);

  } catch (err) {
    console.error('[HTTP] Error al consultar alerta por ID:', err.message);
    res.status(500).json({ error: 'Error interno.', detalle: err.message });
  }
});

/**
 * GET /health
 * Health check del microservicio.
 */
router.get('/health', (req, res) => {
  res.json({
    servicio: 'ms-historial',
    estado: 'activo',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
