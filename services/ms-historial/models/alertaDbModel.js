// models/alertaDbModel.js
// ms-historial - Modelo de persistencia en PostgreSQL
// Sistema C5 - Alerta Ciudadana
//
// Implementa el patrón maestro/réplica:
//   - Escrituras (INSERT) → postgres-master
//   - Lecturas (SELECT)   → postgres-replica (consistencia eventual)

'use strict';

const { Pool } = require('pg');

// --- Pools de conexión ---
const masterPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST_MASTER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT_MASTER, 10) || 5432,
  max: 10,
  idleTimeoutMillis: 30000,
});

const replicaPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST_REPLICA,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT_REPLICA, 10) || 5432,
  max: 10,
  idleTimeoutMillis: 30000,
});

masterPool.on('error', (err) => console.error('[DB Master] Error inesperado:', err.message));
replicaPool.on('error', (err) => console.error('[DB Replica] Error inesperado:', err.message));

// --- Inicialización del esquema ---

/**
 * Crea la tabla `alertas` si no existe.
 * Se ejecuta al arrancar el microservicio contra el maestro.
 */
async function initDb() {
  const client = await masterPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS alertas (
        id               SERIAL PRIMARY KEY,
        id_dispositivo   VARCHAR(255)             NOT NULL,
        lat              DOUBLE PRECISION         NOT NULL,
        lon              DOUBLE PRECISION         NOT NULL,
        timestamp        TIMESTAMP WITH TIME ZONE NOT NULL,
        tipo_emergencia  VARCHAR(100),
        direccion        TEXT,
        pais             VARCHAR(100),
        ciudad           VARCHAR(100),
        estado_geo       VARCHAR(100),
        prioridad        VARCHAR(50),
        fecha_creacion   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("[DB] Tabla 'alertas' verificada/creada en maestro.");
  } finally {
    client.release();
  }
}

// --- Operaciones ---

/**
 * Inserta una alerta en la base de datos maestra.
 * @param {Object} alerta - Alerta completa procesada
 * @returns {Object} Fila insertada con el id generado
 */
async function insertarAlerta(alerta) {
  const {
    ID_dispositivo,
    coordenadas,
    timestamp,
    tipo_emergencia,
    geolocalizacion,
    prioridad,
  } = alerta;

  const sql = `
    INSERT INTO alertas
      (id_dispositivo, lat, lon, timestamp, tipo_emergencia, direccion, pais, ciudad, estado_geo, prioridad)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `;

  const values = [
    ID_dispositivo,
    coordenadas.lat,
    coordenadas.lon,
    timestamp,
    tipo_emergencia || 'otro',
    geolocalizacion?.direccion  ?? null,
    geolocalizacion?.pais       ?? null,
    geolocalizacion?.ciudad     ?? null,
    geolocalizacion?.estado     ?? null,
    prioridad,
  ];

  const { rows } = await masterPool.query(sql, values);
  return rows[0];
}

/**
 * Consulta alertas desde la réplica con filtros opcionales.
 * Modelo de consistencia: eventual (standby streaming).
 * @param {{ fecha_inicio?, fecha_fin?, zona?, prioridad? }} filtros
 * @returns {Array} Filas encontradas
 */
async function consultarAlertas(filtros = {}) {
  const { fecha_inicio, fecha_fin, zona, prioridad } = filtros;

  let sql = 'SELECT * FROM alertas';
  const conditions = [];
  const values = [];
  let idx = 1;

  if (fecha_inicio) { conditions.push(`timestamp >= $${idx++}`); values.push(fecha_inicio); }
  if (fecha_fin)    { conditions.push(`timestamp <= $${idx++}`); values.push(fecha_fin); }
  if (prioridad)    { conditions.push(`prioridad = $${idx++}`);  values.push(prioridad); }
  if (zona)         { conditions.push(`ciudad ILIKE $${idx++}`); values.push(`%${zona}%`); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY timestamp DESC';

  const { rows } = await replicaPool.query(sql, values);
  return rows;
}

module.exports = { initDb, insertarAlerta, consultarAlertas };
