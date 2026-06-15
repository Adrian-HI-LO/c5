# ADR-002: Modelo de Consistencia PostgreSQL - Eventual vs. Fuerte

**Fecha**: 2024-06-09  
**Estado**: Aceptada  
**Autores**: Equipo C5  

---

## Contexto

El sistema requiere persistencia de alertas con alta disponibilidad. Se implementa replicación maestro-réplica en PostgreSQL. Se debe decidir qué modelo de consistencia aplicar para las lecturas del historial:

- **Consistencia fuerte**: Todas las lecturas van al maestro → siempre datos actualizados.
- **Consistencia eventual**: Lecturas en la réplica → datos ligeramente desactualizados, mayor disponibilidad.

El caso de uso del historial de alertas en este sistema es **consulta y auditoría** (no toma de decisiones críticas en tiempo real). El flujo de tiempo real ya está manejado por WebSocket; el historial es para revisión posterior.

---

## Decisión

Se adopta **consistencia eventual** para las lecturas del historial.

- **Escrituras (INSERT)** → PostgreSQL Maestro (`:5432`)
- **Lecturas (SELECT)** → PostgreSQL Réplica (`:5433`, streaming replication)

---

## Alternativas Consideradas

### Alternativa 1: Consistencia Fuerte (todas las operaciones al maestro)
- **Ventajas**: Siempre datos actualizados; sin lag de replicación.
- **Desventajas**: Mayor carga en el maestro; si el maestro cae, el sistema queda en solo-lectura; no aprovecha la réplica.
- **Razón de descarte**: El historial es consulta posterior, no requiere datos en tiempo real. Sobrecargar el maestro con lecturas es innecesario.

### Alternativa 2 (elegida): Consistencia Eventual (escritura maestro, lectura réplica)
- **Ventajas**:
  - Desacoplamiento de carga: escrituras en maestro, lecturas en réplica.
  - Mayor disponibilidad de lectura: si el maestro cae, aún se puede consultar historial en la réplica.
  - Escalable: se pueden agregar más réplicas sin cambiar el código.
- **Desventajas**: Lag de replicación (generalmente < 100ms con streaming replication). Una consulta inmediatamente posterior a un INSERT puede no ver el dato en réplica.
- **Mitigación**: El historial es para auditoría posterior; un lag de milisegundos es aceptable.

### Alternativa 3: Réplica síncrona (`synchronous_commit = on`)
- **Ventajas**: Consistencia inmediata entre maestro y réplica.
- **Desventajas**: Penalización de rendimiento; cada escritura espera confirmación de la réplica; si la réplica está lenta o caída, el maestro también se detiene.
- **Razón de descarte**: Demasiado acoplamiento; reduce la disponibilidad, que es uno de los objetivos del sistema.

---

## Configuración Implementada

### PostgreSQL Maestro
```sql
-- postgresql.conf (vía command en docker-compose.yml)
wal_level = replica
max_wal_senders = 5
max_replication_slots = 5
hot_standby = on
```

### PostgreSQL Réplica
```bash
# Se inicializa con pg_basebackup desde el maestro
pg_basebackup --pgdata=/var/lib/postgresql/data -R --slot=replication_slot_1
```

El flag `-R` genera automáticamente `standby.signal` y `postgresql.auto.conf` con `primary_conninfo`.

---

## Consecuencias

### Positivas
- Lecturas escalables sin afectar al maestro.
- Alta disponibilidad de consultas incluso durante escrituras intensivas.
- Arquitectura documentada y demostrable.

### Negativas
- Lag de replicación (acceptable para auditoría).
- Necesidad de gestionar dos pools de conexión en `alertaDbModel.js`.

---

## Documentación en Código

El modelo de base de datos (`models/alertaDbModel.js`) documenta explícitamente:
```javascript
// Escrituras (INSERT) → postgres-master
const masterPool = new Pool({ host: process.env.DB_HOST_MASTER, ... });

// Lecturas (SELECT) → postgres-replica (consistencia eventual)
const replicaPool = new Pool({ host: process.env.DB_HOST_REPLICA, ... });
```
