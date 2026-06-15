// index.js - ms-recepcionAlertas
// Punto de entrada del Microservicio de Recepción de Alertas
// Sistema C5 - Alerta Ciudadana
//
// Responsabilidad: Suscripción MQTT, validación y encolado de mensajes entrantes.

'use strict';

const express = require('express');
const mqtt = require('mqtt');
const redis = require('redis');
const alertasRoutes = require('./routes/alertasRoutes');
const { validarAlerta, normalizarAlerta } = require('./models/alertaModel');

// --- Configuración ---
const app = express();
const PORT = process.env.APP_PORT || 3001;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const MQTT_TOPIC = 'alertas';
const REDIS_QUEUE = 'alertas_queue';

// --- Clientes ---
const mqttClient = mqtt.connect(MQTT_URL);
const redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });

redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// Compartir clientes con las rutas via app.locals
app.locals.mqttClient = mqttClient;
app.locals.redisClient = redisClient;

// --- Middleware ---
app.use(express.json());

// --- Rutas ---
app.use('/api', alertasRoutes);

app.get('/', (req, res) => {
  res.json({ servicio: 'ms-recepcion-alertas', version: '2.0.0', estado: 'activo' });
});

// --- Lógica MQTT ---
mqttClient.on('connect', () => {
  console.log(`[MQTT] Conectado al broker en ${MQTT_URL}`);
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (err) {
      console.error(`[MQTT] Error al suscribirse al topic '${MQTT_TOPIC}':`, err);
    } else {
      console.log(`[MQTT] Suscrito al topic '${MQTT_TOPIC}'`);
    }
  });
});

mqttClient.on('message', async (topic, message) => {
  console.log(`[MQTT] Mensaje recibido en '${topic}'`);
  try {
    const payload = JSON.parse(message.toString());
    const { valida, errores } = validarAlerta(payload);

    if (!valida) {
      console.warn('[MQTT] Alerta inválida descartada:', errores.join(', '));
      return;
    }

    const alertaNormalizada = normalizarAlerta(payload);
    await redisClient.rPush(REDIS_QUEUE, JSON.stringify(alertaNormalizada));
    console.log(`[Redis] Alerta de ${alertaNormalizada.ID_dispositivo} encolada en '${REDIS_QUEUE}'.`);

  } catch (err) {
    console.error('[MQTT] Error al procesar mensaje:', err.message);
  }
});

mqttClient.on('error', (err) => console.error('[MQTT] Error de conexión:', err.message));

// --- Arranque ---
async function main() {
  await redisClient.connect();
  console.log(`[Redis] Conectado a ${REDIS_HOST}:${REDIS_PORT}`);

  app.listen(PORT, () => {
    console.log(`[HTTP] ms-recepcion-alertas escuchando en http://localhost:${PORT}`);
    console.log(`[HTTP] Rutas disponibles: GET /api/health, GET /api/tipos, GET /api/stats`);
  });
}

main().catch((err) => {
  console.error('[ERROR FATAL] No se pudo iniciar el microservicio:', err);
  process.exit(1);
});