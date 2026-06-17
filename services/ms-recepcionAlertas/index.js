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
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'alertas';
const MQTT_SHARED_GROUP = process.env.MQTT_SHARED_GROUP || 'recepcion_alertas';
const MQTT_SUBSCRIPTION = process.env.MQTT_SHARED_SUBSCRIPTION === 'false'
  ? MQTT_TOPIC
  : `$share/${MQTT_SHARED_GROUP}/${MQTT_TOPIC}`;
const REDIS_QUEUE = 'alertas_queue';
const DEDUP_KEY = 'alertas_dedup_ids'; // SET de Redis para deduplicación
const DEDUP_TTL = 3600; // 1 hora - tiempo de vida para evitar duplicados

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
  mqttClient.subscribe(MQTT_SUBSCRIPTION, (err) => {
    if (err) {
      console.error(`[MQTT] Error al suscribirse al topic '${MQTT_SUBSCRIPTION}':`, err);
    } else {
      console.log(`[MQTT] Suscrito al topic '${MQTT_SUBSCRIPTION}'`);
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

    // Deduplicación: generar ID único si no existe
    const alertId = payload.alert_id || `${payload.ID_dispositivo}-${payload.timestamp_ms || payload.timestamp}`;
    
    // Verificar si ya procesamos esta alerta
    const yaExiste = await redisClient.sIsMember(DEDUP_KEY, alertId);
    if (yaExiste) {
      console.warn(`[MQTT] Alerta duplicada descartada: ${alertId}`);
      return;
    }

    const alertaNormalizada = normalizarAlerta(payload);
    alertaNormalizada.alert_id = alertId; // Preservar ID para la cadena

    // Marcar como procesada en el SET de deduplicación
    await redisClient.sAdd(DEDUP_KEY, alertId);
    await redisClient.expire(DEDUP_KEY, DEDUP_TTL);

    // Encolar la alerta
    await redisClient.rPush(REDIS_QUEUE, JSON.stringify(alertaNormalizada));
    console.log(`[Redis] Alerta ${alertId} de ${alertaNormalizada.ID_dispositivo} encolada en '${REDIS_QUEUE}'.`);

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