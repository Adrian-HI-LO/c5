// index.js - ms-geolocalizacion
// Punto de entrada del Microservicio de Geolocalización
// Sistema C5 - Alerta Ciudadana
//
// Responsabilidad: Consumir alertas de Redis, enriquecer con datos geográficos
//                  y reencolarlas para el siguiente microservicio.

'use strict';

const express = require('express');
const redis = require('redis');
const geoRoutes = require('./routes/geoRoutes');
const { enriquecerConGeo } = require('./models/geoModel');

// --- Configuración ---
const app = express();
const PORT = process.env.APP_PORT || 3002;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const IN_QUEUE = 'alertas_queue';
const OUT_QUEUE = 'geolocalizadas_queue';

// --- Clientes ---
const redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });

redisClient.on('error', (err) => console.error('[Redis] Error:', err));
app.locals.redisClient = redisClient;

// --- Middleware ---
app.use(express.json());

// --- Rutas ---
app.use('/api', geoRoutes);

app.get('/', (req, res) => {
  res.json({ servicio: 'ms-geolocalizacion', version: '2.0.0', estado: 'activo' });
});

// --- Worker: procesamiento continuo de alertas ---
async function procesarAlertas() {
  console.log(`[Worker] Escuchando en cola '${IN_QUEUE}'...`);

  while (true) {
    try {
      // blPop con timeout corto para mejor responsividad (1 segundo)
      const item = await redisClient.blPop(IN_QUEUE, 1);
      if (!item) continue;

      const alerta = JSON.parse(item.element);
      console.log(`[Worker] Alerta recibida: ${alerta.ID_dispositivo} (ID: ${alerta.alert_id || 'N/A'})`);

      // Enriquecer con geolocalización (modelo)
      const alertaEnriquecida = await enriquecerConGeo(alerta);

      // Encolar para el siguiente microservicio
      await redisClient.rPush(OUT_QUEUE, JSON.stringify(alertaEnriquecida));
      console.log(`[Worker] ✓ Alerta ${alerta.ID_dispositivo} encolada en '${OUT_QUEUE}'.`);

    } catch (err) {
      console.error('[Worker] Error al procesar alerta:', err.message);
      // Reintento rápido: 100ms en lugar de 1s
      await new Promise((res) => setTimeout(res, 100));
    }
  }
}

// --- Arranque ---
async function main() {
  await redisClient.connect();
  console.log(`[Redis] Conectado a ${REDIS_HOST}:${REDIS_PORT}`);

  app.listen(PORT, () => {
    console.log(`[HTTP] ms-geolocalizacion escuchando en http://localhost:${PORT}`);
  });

  procesarAlertas().catch((err) => {
    console.error('[ERROR FATAL] Fallo en el worker de geolocalización:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[ERROR FATAL] No se pudo iniciar el microservicio:', err);
  process.exit(1);
});