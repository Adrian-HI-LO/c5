// grpc/server.js
// ms-historial - Servidor gRPC
// Sistema C5 - Alerta Ciudadana
//
// Expone el servicio AlertaService definido en proto/historial.proto.
// Recibe llamadas gRPC desde ms-notificaciones para persistir alertas.

'use strict';

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { insertarAlerta } = require('../models/alertaDbModel');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'historial.proto');

// Cargar la definición del proto
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const historialProto = grpc.loadPackageDefinition(packageDef).historial;

// --- Implementación del servicio ---

/**
 * RegistrarAlerta: recibe una alerta desde ms-notificaciones vía gRPC
 * y la persiste en la base de datos maestra.
 */
async function registrarAlerta(call, callback) {
  const req = call.request;
  console.log(`[gRPC] RegistrarAlerta llamado para dispositivo: ${req.id_dispositivo}`);

  try {
    // Adaptar el formato gRPC al formato del modelo de DB
    const alerta = {
      ID_dispositivo: req.id_dispositivo,
      coordenadas: {
        lat: req.coordenadas?.lat || 0,
        lon: req.coordenadas?.lon || 0,
      },
      timestamp: req.timestamp,
      tipo_emergencia: req.tipo_emergencia,
      geolocalizacion: req.geolocalizacion
        ? {
            direccion:    req.geolocalizacion.direccion,
            pais:         req.geolocalizacion.pais,
            ciudad:       req.geolocalizacion.ciudad,
            estado:       req.geolocalizacion.estado,
            codigoPostal: req.geolocalizacion.codigoPostal,
          }
        : null,
      prioridad: req.prioridad,
    };

    const resultado = await insertarAlerta(alerta);
    console.log(`[gRPC] Alerta ${req.id_dispositivo} guardada con id: ${resultado.id}`);

    callback(null, {
      exito: true,
      id_alerta: resultado.id,
      mensaje: `Alerta registrada correctamente con id ${resultado.id}`,
    });

  } catch (err) {
    console.error('[gRPC] Error al guardar alerta:', err.message);
    callback({
      code: grpc.status.INTERNAL,
      message: `Error al guardar alerta: ${err.message}`,
    });
  }
}

/**
 * HealthCheck: retorna el estado del servidor gRPC.
 */
function healthCheck(call, callback) {
  callback(null, {
    estado: 'activo',
    timestamp: new Date().toISOString(),
  });
}

// --- Arranque del servidor gRPC ---

function startGrpcServer(port) {
  const server = new grpc.Server();

  server.addService(historialProto.AlertaService.service, {
    RegistrarAlerta: registrarAlerta,
    HealthCheck: healthCheck,
  });

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, boundPort) => {
      if (err) {
        console.error('[gRPC] Error al iniciar servidor:', err.message);
        process.exit(1);
      }
      console.log(`[gRPC] Servidor AlertaService escuchando en puerto ${boundPort}`);
    }
  );

  return server;
}

module.exports = { startGrpcServer };
