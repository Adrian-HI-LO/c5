# ADR-003: Redis como Bus de Mensajes entre Microservicios

**Fecha**: 2024-06-09  
**Estado**: Aceptada  
**Autores**: Equipo C5  

---

## Contexto

Los 5 microservicios del pipeline de alertas necesitan comunicarse de forma **asíncrona y desacoplada**. El stack tecnológico obligatorio especifica el uso de Redis para caché/colas. Se debe definir exactamente cómo se usa Redis: como pub/sub, como cola de listas (FIFO), o ambos.

**Requisito clave**: si `ms-notificaciones` cae, las alertas NO deben perderse. Deben encolarse y entregarse cuando el servicio se recupere.

---

## Decisión

Se usa Redis como **bus de mensajes basado en listas FIFO** (`RPUSH` / `BLPOP`) entre los microservicios del pipeline:

```
alertas_queue → geolocalizadas_queue → priorizadas_queue
```

Adicionalmente, Redis maneja:
- `failed_notifications_queue`: alertas cuya notificación WebSocket falló por ausencia de operadores.
- `historial_queue`: fallback cuando gRPC de ms-historial no está disponible.

---

## Alternativas Consideradas

### Alternativa 1: Redis Pub/Sub
- **Ventajas**: Menor latencia; múltiples suscriptores simultáneos.
- **Desventajas**: **Fire-and-forget**: si ningún suscriptor está activo al momento del publish, el mensaje se pierde. No hay persistencia del mensaje.
- **Razón de descarte**: Viola el requisito de tolerancia a fallos. Si ms-geolocalizacion se reinicia, pierde todos los mensajes publicados durante ese tiempo.

### Alternativa 2: Apache Kafka
- **Ventajas**: Persistencia duradera, offset management, particionado, ideal para miles de mensajes/seg.
- **Desventajas**: Overhead operacional enorme; requiere Zookeeper (o KRaft); complejidad innecesaria para el volumen de este sistema.
- **Razón de descarte**: Over-engineering. El stack obligatorio especifica Redis.

### Alternativa 3: RabbitMQ
- **Ventajas**: ACK explícito, routing flexible (exchanges), dead letter queues.
- **Desventajas**: Componente adicional no incluido en el stack.
- **Razón de descarte**: No forma parte del stack tecnológico obligatorio.

### Alternativa 4 (elegida): Redis Listas FIFO (`RPUSH` / `BLPOP`)
- **Ventajas**:
  - **Persistencia**: los mensajes permanecen en la lista hasta ser consumidos.
  - **Garantía de entrega**: `BLPOP` es atómico; solo un consumidor recibe el mensaje (no duplicación).
  - **Bloqueo eficiente**: `BLPOP` con timeout 0 espera sin polling activo.
  - **Simple**: usa Redis que ya está en el stack para caché.
  - **Tolerancia a fallos**: si un microservicio cae y se reinicia, retoma desde donde quedó.
- **Desventajas**: No soporta múltiples consumidores del mismo mensaje (sin pub/sub). Para escalar se necesitaría Redis Streams.

---

## Estructura de Colas

| Cola | Productor | Consumidor | Propósito |
|---|---|---|---|
| `alertas_queue` | ms-recepcionAlertas | ms-geolocalizacion | Alertas validadas desde MQTT |
| `geolocalizadas_queue` | ms-geolocalizacion | ms-prioridad | Alertas con dirección física |
| `priorizadas_queue` | ms-prioridad | ms-notificaciones | Alertas con nivel asignado |
| `historial_queue` | ms-notificaciones | ms-historial | Fallback gRPC → Redis |
| `failed_notifications_queue` | ms-notificaciones | ms-notificaciones | Re-envío a operadores |

---

## Consecuencias

### Positivas
- Desacoplamiento total entre microservicios: cada uno solo conoce el nombre de su cola.
- Tolerancia a fallos: si un servicio intermedio reinicia, las colas mantienen los mensajes.
- Monitoreo sencillo: `redis-cli llen [nombre_cola]` muestra el estado del pipeline.

### Negativas
- Sin ACK explícito: si el consumidor extrae el mensaje y crashea antes de procesarlo, el mensaje se pierde. Mitigación futura: usar Redis Streams con consumer groups.
- Un solo consumidor por cola (no escalable horizontalmente sin cambios).

---

## Migración Futura

Si el volumen de alertas crece significativamente, se puede migrar a **Redis Streams** (`XADD` / `XREADGROUP`) que agrega:
- Consumer groups (múltiples instancias consumen en paralelo)
- ACK explícito (`XACK`)
- Retención configurable de mensajes

El cambio sería transparente para los microservicios excepto por la API de Redis.
