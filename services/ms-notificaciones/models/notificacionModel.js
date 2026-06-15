// models/notificacionModel.js
// ms-notificaciones - Modelo de lógica de notificaciones WebSocket
// Sistema C5 - Alerta Ciudadana

'use strict';

/**
 * Envía una alerta a todos los operadores WebSocket conectados.
 * @param {WebSocket.Server} wss - Servidor WebSocket
 * @param {Object} alerta - Alerta a transmitir
 * @returns {number} Número de operadores notificados
 */
function broadcast(wss, alerta) {
  const { WebSocket } = require('ws');
  let notificados = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(alerta));
      notificados++;
    }
  });

  return notificados;
}

/**
 * Encola una alerta en la cola de notificaciones fallidas para reintento.
 * @param {Object} redisClient - Cliente Redis conectado
 * @param {string} alertaString - JSON serializado de la alerta
 */
async function encolarFallida(redisClient, alertaString) {
  await redisClient.rPush('failed_notifications_queue', alertaString);
}

/**
 * Reintenta enviar notificaciones fallidas a operadores reconectados.
 * Se ejecuta periódicamente.
 * @param {WebSocket.Server} wss
 * @param {Object} redisClient
 * @param {number} intervalMs - Intervalo de reintento en ms (default: 5000)
 */
function iniciarReintentosNotificaciones(wss, redisClient, intervalMs = 5000) {
  setInterval(async () => {
    if (wss.clients.size === 0) return;

    try {
      const len = await redisClient.lLen('failed_notifications_queue');
      if (len <= 0) return;

      console.log(`[Reintentos] ${len} notificaciones pendientes. Reenviando...`);

      // Procesar todas las pendientes en este ciclo
      for (let i = 0; i < len; i++) {
        const alertaString = await redisClient.lPop('failed_notifications_queue');
        if (!alertaString) break;
        const alerta = JSON.parse(alertaString);
        const enviados = broadcast(wss, alerta);
        console.log(`[Reintentos] Alerta ${alerta.ID_dispositivo} reenviada a ${enviados} operadores.`);
      }
    } catch (err) {
      console.error('[Reintentos] Error al procesar cola fallida:', err.message);
    }
  }, intervalMs);
}

module.exports = { broadcast, encolarFallida, iniciarReintentosNotificaciones };
