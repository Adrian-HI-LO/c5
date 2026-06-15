# ADR-001: Comunicación gRPC entre ms-notificaciones y ms-historial

**Fecha**: 2024-06-09  
**Estado**: Aceptada  
**Autores**: Equipo C5  

---

## Contexto

El sistema requiere que **al menos un par de microservicios se comunique mediante gRPC** con contrato `.proto` documentado (requisito funcional de la asignación). Se necesita elegir qué par de servicios beneficia más de gRPC frente a otras alternativas como REST o Redis pub/sub.

El flujo final del pipeline de alertas es:  
`ms-notificaciones` → **persiste** → `ms-historial`

Este es el único punto del sistema donde:
1. Se requiere **confirmación de recepción** (saber si la alerta fue guardada)
2. La operación es **síncrona por naturaleza** (necesito saber el ID de DB asignado)
3. El contrato es **bien definido y estable** (campos fijos de una alerta)

---

## Decisión

Se implementa **gRPC** como protocolo de comunicación de `ms-notificaciones` (cliente) a `ms-historial` (servidor), definiendo el contrato en `proto/historial.proto`.

---

## Alternativas Consideradas

### Alternativa 1: REST (HTTP/JSON)
- **Ventajas**: Simple, universalmente conocido, fácil de debuggear con curl.
- **Desventajas**: Sin contrato tipado, más overhead HTTP, sin streaming nativo.
- **Razón de descarte**: No cumple el requisito de gRPC; además REST en este caso es más lento que gRPC para llamadas frecuentes.

### Alternativa 2: Redis Pub/Sub adicional
- **Ventajas**: Consistente con el resto del pipeline.
- **Desventajas**: Sin confirmación de recepción; si ms-historial está caído al momento del pub, el mensaje se pierde (fire-and-forget sin garantías).
- **Razón de descarte**: No ofrece confirmación de escritura en DB. Igualmente se usa como **fallback** cuando gRPC falla (tolerancia a fallos).

### Alternativa 3 (elegida): gRPC
- **Ventajas**: 
  - Contrato tipado con `.proto` (documentación automática)
  - Confirmación explícita (`AlertaResponse.exito`, `id_alerta`)
  - ~7x más rápido que REST para payloads pequeños (Protobuf binario)
  - Soporta streaming si se necesita en el futuro
- **Desventajas**: Mayor complejidad inicial; requiere proto-loader y gRPC libs.

---

## Consecuencias

### Positivas
- El sistema tiene un **contrato explícito** verificable entre servicios.
- `ms-notificaciones` recibe el `id_alerta` de DB para logging.
- Si gRPC falla, el fallback a Redis garantiza que ninguna alerta se pierda.
- El `.proto` sirve como documentación viva del contrato.

### Negativas
- Se debe mantener sincronizado el archivo `historial.proto` en ambos servicios.
- Debugging más complejo que REST (requiere herramientas como `grpcurl`).

---

## Implementación

- **Proto**: `services/ms-historial/proto/historial.proto` (fuente de verdad)
- **Copia cliente**: `services/ms-notificaciones/proto/historial.proto`
- **Servidor**: `services/ms-historial/grpc/server.js`
- **Cliente**: `services/ms-notificaciones/grpc/client.js`
- **Puerto**: `50051` (configurable via `GRPC_PORT` en `.env`)
