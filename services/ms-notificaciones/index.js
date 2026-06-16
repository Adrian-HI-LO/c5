// index.js - ms-notificaciones
// Punto de entrada del Microservicio de Notificaciones
// Sistema C5 - Alerta Ciudadana
//
// Responsabilidad: Consumir alertas priorizadas, notificar a operadores
//                  vía WebSocket y enviar a ms-historial vía gRPC.

'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');

const notificacionesRoutes = require('./routes/notificacionesRoutes');
const { broadcast, encolarFallida, iniciarReintentosNotificaciones } = require('./models/notificacionModel');
const { registrarAlertaGrpc } = require('./grpc/client');

// --- Configuración ---
const app = express();
const PORT = process.env.APP_PORT || 3004;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const IN_QUEUE = 'priorizadas_queue';
const HISTORIAL_QUEUE = 'historial_queue'; // Cola de respaldo si gRPC falla

// --- Servidores ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Clientes Redis ---
const redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// Compartir instancias con las rutas via app.locals
app.locals.wss = wss;
app.locals.redisClient = redisClient;

// --- Middleware ---
app.use(express.json());

// --- Rutas ---
app.use('/api', notificacionesRoutes);

app.get('/', (req, res) => {
  res.json({ servicio: 'ms-notificaciones', version: '2.0.0', estado: 'activo' });
});

// --- WebSocket: gestión de conexiones de operadores ---
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WebSocket] Nuevo operador conectado desde ${clientIp}. Total: ${wss.clients.size}`);

  ws.on('close', () => {
    console.log(`[WebSocket] Operador desconectado. Total: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error en conexión de operador:', err.message);
  });

  // Enviar confirmación de conexión al operador
  ws.send(JSON.stringify({
    tipo: 'conexion_establecida',
    mensaje: 'Conectado al Centro de Comando C5. Esperando alertas...',
    timestamp: new Date().toISOString(),
  }));
});

// --- Worker: procesamiento continuo de alertas ---
async function procesarAlertas() {
  console.log(`[Worker] Escuchando en cola '${IN_QUEUE}'...`);

  while (true) {
    try {
      // blPop con timeout de 0.5s para máxima responsividad
      const item = await redisClient.blPop(IN_QUEUE, 0.5);
      if (!item) continue;

      const alertaString = item.element;
      const alerta = JSON.parse(alertaString);
      console.log(`[Worker] ⚡ Alerta recibida: ${alerta.ID_dispositivo} | Prioridad: ${alerta.prioridad} | ID: ${alerta.alert_id || 'N/A'}`);

      // 1. Notificar operadores vía WebSocket (PRIORITARIO)
      const notificados = broadcast(wss, alerta);
      if (notificados > 0) {
        console.log(`[Worker] ✓ Alerta enviada a ${notificados} operador(es) vía WebSocket.`);
      } else {
        console.warn(`[Worker] ⚠ Sin operadores conectados. Encolando para reintentos.`);
        await encolarFallida(redisClient, alertaString);
      }

      // 2. Persistir en ms-historial vía gRPC (no bloquea si falla)
      try {
        await registrarAlertaGrpc(alerta);
      } catch (grpcErr) {
        console.warn(`[Worker] ⚠ gRPC falló (${grpcErr.message}). Usando cola Redis como fallback.`);
        await redisClient.rPush(HISTORIAL_QUEUE, alertaString);
      }

    } catch (err) {
      console.error('[Worker] Error al procesar alerta:', err.message);
      // Reintento muy rápido en caso de error
      await new Promise((res) => setTimeout(res, 50));
    }
  }
}

// --- Arranque ---
async function main() {
  await redisClient.connect();
  console.log(`[Redis] Conectado a ${REDIS_HOST}:${REDIS_PORT}`);

  server.listen(PORT, () => {
    console.log(`[HTTP] ms-notificaciones escuchando en http://localhost:${PORT}`);
    console.log(`[WebSocket] Servidor WS escuchando en ws://localhost:${PORT}`);
    console.log(`[HTTP] Rutas: GET /api/health, GET /api/operadores, GET /api/stats`);
  });

  // Iniciar reintentos de notificaciones fallidas
  iniciarReintentosNotificaciones(wss, redisClient, 5000);

  // Iniciar worker principal
  procesarAlertas().catch((err) => {
    console.error('[ERROR FATAL] Fallo en worker de notificaciones:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[ERROR FATAL] No se pudo iniciar el microservicio:', err);
  process.exit(1);
});