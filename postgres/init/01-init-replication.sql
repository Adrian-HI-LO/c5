-- Script de inicialización PostgreSQL Maestro
-- Sistema C5 - Alerta Ciudadana
-- Este script se ejecuta AUTOMÁTICAMENTE al iniciar el contenedor postgres-master

-- Crear usuario de replicación
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicatorpass';
  END IF;
END
$$;

-- Crear slot de replicación
SELECT pg_create_physical_replication_slot('replication_slot_1')
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_replication_slots WHERE slot_name = 'replication_slot_1'
  );

-- Configurar pg_hba para permitir replicación
-- Nota: Docker Postgres ya genera pg_hba.conf, aquí solo aseguramos la tabla
