// models/prioridadModel.js
// ms-prioridad - Modelo de clasificación de prioridad de alertas
// Sistema C5 - Alerta Ciudadana

'use strict';

/**
 * Niveles de prioridad en orden de urgencia (mayor a menor).
 * Requerimiento funcional: crítica | alta | media.
 */
const NIVELES = ['crítica', 'alta', 'media'];

const REGLAS_POR_DEFECTO = {
  critica: ['panico', 'disparo', 'secuestro', 'incendio', 'emergencia medica', 'emergencia médica'],
  alta: ['asalto', 'robo', 'accidente grave', 'violencia'],
  media: ['actividad sospechosa', 'vandalismo', 'otro'],
};

const REGLAS_UNIDADES = {
  critica: {
    default: ['UP-C5-01', 'UT-C5-01'],
    incendio: ['UB-BOM-01', 'UP-C5-01'],
    'emergencia medica': ['UM-MED-01', 'UP-C5-01'],
    'emergencia médica': ['UM-MED-01', 'UP-C5-01'],
  },
  alta: {
    default: ['UP-C5-02'],
    robo: ['UP-C5-02', 'UP-C5-03'],
    asalto: ['UP-C5-02', 'UP-C5-03'],
  },
  media: {
    default: ['UP-C5-04'],
  },
};

function normalizarTexto(valor) {
  return (valor || '')
    .toString()
    .trim()
    .toLowerCase();
}

function cargarReglasDesdeEnv() {
  const raw = process.env.PRIORIDAD_REGLAS_JSON;
  if (!raw) return REGLAS_POR_DEFECTO;

  try {
    const parsed = JSON.parse(raw);
    return {
      critica: Array.isArray(parsed.critica) ? parsed.critica.map(normalizarTexto) : REGLAS_POR_DEFECTO.critica,
      alta: Array.isArray(parsed.alta) ? parsed.alta.map(normalizarTexto) : REGLAS_POR_DEFECTO.alta,
      media: Array.isArray(parsed.media) ? parsed.media.map(normalizarTexto) : REGLAS_POR_DEFECTO.media,
    };
  } catch (err) {
    console.warn('[Prioridad] PRIORIDAD_REGLAS_JSON inválido. Se usan reglas por defecto.');
    return REGLAS_POR_DEFECTO;
  }
}

const REGLAS_PRIORIDAD = cargarReglasDesdeEnv();

function prioridadPorTipoEmergencia(tipoEmergencia) {
  const tipo = normalizarTexto(tipoEmergencia);
  if (!tipo) return null;

  if (REGLAS_PRIORIDAD.critica.includes(tipo)) return 'crítica';
  if (REGLAS_PRIORIDAD.alta.includes(tipo)) return 'alta';
  if (REGLAS_PRIORIDAD.media.includes(tipo)) return 'media';
  return null;
}

function asignarUnidades(alerta, prioridad) {
  const nivel = prioridad === 'crítica' ? 'critica' : prioridad;
  const tipo = normalizarTexto(alerta.tipo_emergencia);
  const reglasNivel = REGLAS_UNIDADES[nivel] || REGLAS_UNIDADES.media;

  const unidades = reglasNivel[tipo] || reglasNivel.default || REGLAS_UNIDADES.media.default;
  const zona = alerta.geolocalizacion?.ciudad || alerta.geolocalizacion?.estado || 'zona_no_identificada';

  return {
    zona,
    unidades,
    estrategia: 'despacho_automatico_v1',
    asignado_en: new Date().toISOString(),
  };
}

/**
 * Normaliza y asigna el nivel de prioridad desde un valor recibido.
 * @param {string} prioridadRecibida
 * @returns {'crítica' | 'alta' | 'media'}
 */
function asignarPrioridad(prioridadRecibida) {
  let prio = normalizarTexto(prioridadRecibida);
  
  if (prio === 'critica' || prio === 'crítica') return 'crítica';
  if (prio === 'alta') return 'alta';
  if (prio === 'media') return 'media';
  if (prio === 'baja') return 'media';

  // Default: media para valores desconocidos
  if (prio) {
    console.warn(`[Prioridad] Prioridad desconocida: '${prio}'. Se asigna prioridad 'media'.`);
  }
  return 'media';
}

/**
 * Enriquece una alerta con su nivel de prioridad validado.
 * @param {Object} alerta
 * @returns {Object} alerta con campo \`prioridad\` agregado
 */
function priorizarAlerta(alerta) {
  const prioridadRegla = prioridadPorTipoEmergencia(alerta.tipo_emergencia);
  const prioridad = prioridadRegla || asignarPrioridad(alerta.prioridad);
  const unidad_respuesta = asignarUnidades(alerta, prioridad);

  return {
    ...alerta,
    prioridad,
    prioridad_fuente: prioridadRegla ? 'regla_tipo_emergencia' : 'prioridad_dispositivo',
    unidad_respuesta,
  };
}

module.exports = {
  asignarPrioridad,
  priorizarAlerta,
  prioridadPorTipoEmergencia,
  REGLAS_PRIORIDAD,
  REGLAS_UNIDADES,
  NIVELES,
};
