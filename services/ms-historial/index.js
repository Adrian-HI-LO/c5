// index.js - ms-historial
// Punto de entrada del Microservicio de Historial de Incidentes
// Sistema C5 - Alerta Ciudadana
//
// Responsabilidad: Persistencia de alertas vía Redis (backup) y gRPC (principal).
//                  Servidor gRPC para recibir alertas desde ms-notificaciones.
//                  API REST para consultas con filtros desde la réplica.

'use strict';

const express = require('express');
const redis = require('redis');
const historialRoutes = require('./routes/historialRoutes');
const { initDb, insertarAlerta } = require('./models/alertaDbModel');
const { startGrpcServer } = require('./grpc/server');

// --- Configuración ---
const app = express();
const PORT = process.env.APP_PORT || 3005;
const GRPC_PORT = process.env.GRPC_PORT || 50051;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// La cola de Redis actúa como respaldo/fallback al gRPC
const IN_QUEUE = 'historial_queue';

// --- Clientes Redis ---
const redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// --- Middleware ---
app.use(express.json());

// --- Rutas ---
app.use('/api', historialRoutes);

app.get('/', (req, res) => {
  res.json({ servicio: 'ms-historial', version: '2.0.0', estado: 'activo' });
});

// --- Worker Redis: canal de respaldo al gRPC ---
// Consume la cola 'historial_queue' para garantizar que ninguna alerta
// se pierda si el cliente gRPC falla (tolerancia a fallos).
async function procesarAlertasRedis() {
  console.log(`[Redis Worker] Escuchando cola de respaldo '${IN_QUEUE}'...`);

  while (true) {
    try {
      const item = await redisClient.blPop(IN_QUEUE, 0);
      if (!item) continue;

      const alerta = JSON.parse(item.element);
      console.log(`[Redis Worker] Alerta recibida desde cola: ${alerta.ID_dispositivo}`);
      await insertarAlerta(alerta);
      console.log(`[Redis Worker] Alerta ${alerta.ID_dispositivo} guardada vía Redis (fallback).`);

    } catch (err) {
      console.error('[Redis Worker] Error al procesar alerta:', err.message);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}

// --- Arranque ---
async function main() {
  // 1. Inicializar base de datos (crear tabla si no existe)
  await initDb();

  // 2. Conectar Redis
  await redisClient.connect();
  console.log(`[Redis] Conectado a ${REDIS_HOST}:${REDIS_PORT}`);

  // 3. Iniciar servidor gRPC (canal principal de recepción)
  startGrpcServer(GRPC_PORT);

  // 4. Iniciar servidor HTTP
  app.listen(PORT, () => {
    console.log(`[HTTP] ms-historial escuchando en http://localhost:${PORT}`);
    console.log(`[HTTP] Rutas: GET /api/historial, GET /api/historial/:id, GET /api/health`);
  });

  // 5. Iniciar worker Redis (canal de respaldo)
  procesarAlertasRedis().catch((err) => {
    console.error('[ERROR FATAL] Fallo en worker Redis:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[ERROR FATAL] No se pudo iniciar el microservicio:', err);
  process.exit(1);
});