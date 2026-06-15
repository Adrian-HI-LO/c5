// index.js - ms-prioridad
// Punto de entrada del Microservicio de Asignación de Prioridad
// Sistema C5 - Alerta Ciudadana
//
// Responsabilidad: Clasificar alertas en niveles crítico/alto/medio
//                  según reglas de negocio configurables.

'use strict';

const express = require('express');
const redis = require('redis');
const prioridadRoutes = require('./routes/prioridadRoutes');
const { priorizarAlerta } = require('./models/prioridadModel');

// --- Configuración ---
const app = express();
const PORT = process.env.APP_PORT || 3003;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const IN_QUEUE = 'geolocalizadas_queue';
const OUT_QUEUE = 'priorizadas_queue';

// --- Clientes ---
const redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });

redisClient.on('error', (err) => console.error('[Redis] Error:', err));
app.locals.redisClient = redisClient;

// --- Middleware ---
app.use(express.json());

// --- Rutas ---
app.use('/api', prioridadRoutes);

app.get('/', (req, res) => {
  res.json({ servicio: 'ms-prioridad', version: '2.0.0', estado: 'activo' });
});

// --- Worker: procesamiento continuo de alertas ---
async function procesarAlertas() {
  console.log(`[Worker] Escuchando en cola '${IN_QUEUE}'...`);

  while (true) {
    try {
      const item = await redisClient.blPop(IN_QUEUE, 0);
      if (!item) continue;

      const alerta = JSON.parse(item.element);
      console.log(`[Worker] Alerta recibida para priorización: ${alerta.ID_dispositivo}`);

      // Priorizar (modelo de negocio)
      const alertaPriorizada = priorizarAlerta(alerta);
      console.log(`[Worker] Prioridad '${alertaPriorizada.prioridad}' asignada a ${alerta.ID_dispositivo}`);

      // Encolar para el siguiente microservicio
      await redisClient.rPush(OUT_QUEUE, JSON.stringify(alertaPriorizada));
      console.log(`[Worker] Alerta encolada en '${OUT_QUEUE}'.`);

    } catch (err) {
      console.error('[Worker] Error al procesar alerta:', err.message);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}

// --- Arranque ---
async function main() {
  await redisClient.connect();
  console.log(`[Redis] Conectado a ${REDIS_HOST}:${REDIS_PORT}`);

  app.listen(PORT, () => {
    console.log(`[HTTP] ms-prioridad escuchando en http://localhost:${PORT}`);
  });

  procesarAlertas().catch((err) => {
    console.error('[ERROR FATAL] Fallo en el worker de prioridad:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[ERROR FATAL] No se pudo iniciar el microservicio:', err);
  process.exit(1);
});