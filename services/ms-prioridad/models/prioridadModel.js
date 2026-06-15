// models/prioridadModel.js
// ms-prioridad - Modelo de clasificación de prioridad de alertas
// Sistema C5 - Alerta Ciudadana

'use strict';

/**
 * Niveles de prioridad en orden de urgencia (mayor a menor).
 */
const NIVELES = ['crítica', 'alta', 'media', 'baja'];

/**
 * Normaliza y asigna el nivel de prioridad.
 * @param {string} prioridadRecibida
 * @returns {'crítica' | 'alta' | 'media' | 'baja'}
 */
function asignarPrioridad(prioridadRecibida) {
  let prio = (prioridadRecibida || '').toLowerCase().trim();
  
  if (prio === 'critica' || prio === 'crítica') return 'crítica';
  if (prio === 'alta') return 'alta';
  if (prio === 'media') return 'media';
  if (prio === 'baja') return 'baja';

  // Default: baja para tipos desconocidos
  console.warn(`[Prioridad] Prioridad desconocida: '${prio}'. Se asigna prioridad 'baja'.`);
  return 'baja';
}

/**
 * Enriquece una alerta con su nivel de prioridad validado.
 * @param {Object} alerta
 * @returns {Object} alerta con campo \`prioridad\` agregado
 */
function priorizarAlerta(alerta) {
  const prioridad = asignarPrioridad(alerta.prioridad);
  return { ...alerta, prioridad };
}

module.exports = { asignarPrioridad, priorizarAlerta, NIVELES };
