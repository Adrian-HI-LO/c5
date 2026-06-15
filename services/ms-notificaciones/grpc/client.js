// grpc/client.js
// ms-notificaciones - Cliente gRPC para comunicarse con ms-historial
// Sistema C5 - Alerta Ciudadana
//
// Este cliente implementa la comunicación obligatoria gRPC entre
// ms-notificaciones y ms-historial para persistir alertas.

'use strict';

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// El .proto se comparte lógicamente; aquí se usa una copia local o se referencia por red.
// En producción se usaría un registro de schemas; aquí cargamos el archivo directamente.
const PROTO_PATH = path.join(__dirname, '..', 'proto', 'historial.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const historialProto = grpc.loadPackageDefinition(packageDef).historial;

// Dirección del servidor gRPC de ms-historial
const GRPC_HOST = process.env.GRPC_HISTORIAL_HOST || 'localhost';
const GRPC_PORT = process.env.GRPC_HISTORIAL_PORT || 50051;
const GRPC_ADDRESS = `${GRPC_HOST}:${GRPC_PORT}`;

// Crear el stub (cliente) gRPC
const client = new historialProto.AlertaService(
  GRPC_ADDRESS,
  grpc.credentials.createInsecure()
);

console.log(`[gRPC Client] Conectando a ms-historial en ${GRPC_ADDRESS}`);

/**
 * Envía una alerta a ms-historial vía gRPC para su persistencia.
 * @param {Object} alerta - Alerta completa procesada
 * @returns {Promise<Object>} Respuesta del servidor gRPC
 */
function registrarAlertaGrpc(alerta) {
  return new Promise((resolve, reject) => {
    const request = {
      id_dispositivo:  alerta.ID_dispositivo || '',
      coordenadas: {
        lat: alerta.coordenadas?.lat || 0,
        lon: alerta.coordenadas?.lon || 0,
      },
      timestamp:       alerta.timestamp || '',
      tipo_emergencia: alerta.tipo_emergencia || '',
      geolocalizacion: alerta.geolocalizacion
        ? {
            direccion:    alerta.geolocalizacion.direccion    || '',
            pais:         alerta.geolocalizacion.pais         || '',
            ciudad:       alerta.geolocalizacion.ciudad       || '',
            estado:       alerta.geolocalizacion.estado       || '',
            codigoPostal: alerta.geolocalizacion.codigoPostal || '',
          }
        : null,
      prioridad: alerta.prioridad || 'media',
    };

    client.RegistrarAlerta(request, (err, response) => {
      if (err) {
        console.error('[gRPC Client] Error al registrar alerta:', err.message);
        reject(err);
      } else {
        console.log(`[gRPC Client] Alerta registrada en historial. id_db=${response.id_alerta}`);
        resolve(response);
      }
    });
  });
}

module.exports = { registrarAlertaGrpc };
