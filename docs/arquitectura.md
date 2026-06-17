# Arquitectura del Sistema C5 - Alerta Ciudadana

## Resumen

El Sistema C5 es una infraestructura distribuida de alerta ciudadana compuesta por **5 microservicios independientes** que procesan alertas desde dispositivos físicos (ESP32) hasta operadores en tiempo real.

---

## Diagrama de Flujo del Sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DISPOSITIVO FÍSICO                                   │
│                                                                             │
│   [ESP32 + Botón de Pánico]                                                 │
│        │ Presión botón → JSON alerta                                        │
│        │ WiFi + MQTT                                                        │
└────────┼────────────────────────────────────────────────────────────────────┘
         │
         ▼ MQTT (topic: "alertas")
┌─────────────────────────────────────────────────────────────────────────────┐
│   BROKER MQTT - Eclipse Mosquitto :1883                                     │
│   (docker: mqtt-broker)                                                     │
│   Shared subscription: $share/recepcion_alertas/alertas                    │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ MQTT subscribe
┌─────────────────────────────────────────────────────────────────────────────┐
│   NGINX - Balanceador de Carga :8080                                        │
│   ┌──────────────────────────────────────────────────────┐                  │
│   │  ms-recepcion-alertas-1 │ -2 │ -3  (least_conn)     │                  │
│   │  Valida JSON, encola en Redis                        │                  │
│   │  routes/alertasRoutes.js │ models/alertaModel.js    │                  │
│   └──────────────────────────────────────────────────────┘                  │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ Redis Queue: "alertas_queue"
┌─────────────────────────────────────────────────────────────────────────────┐
│   REDIS :6379 (pub/sub + colas de tareas)                                  │
│   Colas: alertas_queue → geolocalizadas_queue → priorizadas_queue          │
│          historial_queue │ failed_notifications_queue                       │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ blPop "alertas_queue"
┌─────────────────────────────────────────────────────────────────────────────┐
│   ms-geolocalizacion :3002                                                  │
│   Geocoding inverso (OpenStreetMap)                                         │
│   routes/geoRoutes.js │ models/geoModel.js                                 │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ blPop "geolocalizadas_queue"
┌─────────────────────────────────────────────────────────────────────────────┐
│   ms-prioridad :3003                                                        │
│   Clasificación: crítica | alta | media                                     │
│   Asignación automática de unidades de respuesta                             │
│   routes/prioridadRoutes.js │ models/prioridadModel.js                     │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ blPop "priorizadas_queue"
┌─────────────────────────────────────────────────────────────────────────────┐
│   ms-notificaciones :3004  (WebSocket + HTTP)                               │
│   Broadcast a operadores vía WebSocket                                      │
│   routes/notificacionesRoutes.js │ models/notificacionModel.js             │
│   grpc/client.js → llama a ms-historial                                    │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         │  ┌─── WebSocket ws://localhost:3004 ───► [Operador/Dashboard]
         │  │
         ▼  ▼ gRPC (principal) / Redis fallback
┌─────────────────────────────────────────────────────────────────────────────┐
│   ms-historial :3005 (HTTP) / :50051 (gRPC)                                │
│   Persiste en PostgreSQL Maestro                                            │
│   Lee desde PostgreSQL Réplica                                              │
│   routes/historialRoutes.js │ models/alertaDbModel.js                      │
│   grpc/server.js                                                            │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ▼ Replicación streaming
┌─────────────────────────────────────────────────────────────────────────────┐
│   PostgreSQL Maestro :5432  ──streaming──►  PostgreSQL Réplica :5433       │
│   Escrituras (INSERT)                       Lecturas (SELECT historial)     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Microservicios

### 1. ms-recepcionAlertas (3 instancias)

| Atributo | Valor |
|---|---|
| Puerto interno | 3001 |
| Protocolo entrada | MQTT (topic: `alertas`) |
| Protocolo salida | Redis Queue (`alertas_queue`) |
| Balanceo | Nginx `least_conn` (3 instancias) |

**Estructura de archivos:**
```
ms-recepcionAlertas/
├── index.js                   # Setup + MQTT + arranque
├── routes/alertasRoutes.js    # GET /health, /tipos, /stats
├── models/alertaModel.js      # Validación y normalización
├── package.json
└── Dockerfile
```

### 2. ms-geolocalizacion

| Atributo | Valor |
|---|---|
| Puerto | 3002 |
| Cola entrada | `alertas_queue` |
| Cola salida | `geolocalizadas_queue` |
| API externa | OpenStreetMap (Nominatim) |

### 3. ms-prioridad

| Atributo | Valor |
|---|---|
| Puerto | 3003 |
| Cola entrada | `geolocalizadas_queue` |
| Cola salida | `priorizadas_queue` |
| Reglas | `critica`, `alta`, `media` |

### 4. ms-notificaciones

| Atributo | Valor |
|---|---|
| Puerto HTTP | 3004 |
| Puerto WebSocket | 3004 (mismo server HTTP) |
| Cola entrada | `priorizadas_queue` |
| Salida principal | WebSocket → operadores |
| Salida secundaria | gRPC → ms-historial |
| Fallback | Redis Queue `historial_queue` |

### 5. ms-historial

| Atributo | Valor |
|---|---|
| Puerto HTTP | 3005 |
| Puerto gRPC | 50051 |
| Entrada principal | gRPC desde ms-notificaciones |
| Entrada fallback | Redis Queue `historial_queue` |
| DB escritura | PostgreSQL Maestro :5432 |
| DB lectura | PostgreSQL Réplica :5433 |

---

## Infraestructura

| Servicio | Imagen | Puerto | Propósito |
|---|---|---|---|
| mqtt-broker | eclipse-mosquitto:2 | 1883, 9001 | Broker MQTT |
| redis | redis:7-alpine | 6379 | Colas de mensajes |
| postgres-master | postgres:14-alpine | 5432 | DB escritura |
| postgres-replica | postgres:14-alpine | 5433 | DB lectura |
| nginx-balancer | nginx:1.21-alpine | 8080 | Balanceo de carga |

---

## Comunicación entre Servicios

```
┌─────────────────────────────────────────────────────┐
│               PROTOCOLOS DE COMUNICACIÓN            │
│                                                     │
│  ESP32 ──── MQTT ────► ms-recepcion                 │
│  ms-recepcion ──── Redis ────► ms-geo               │
│  ms-geo ──── Redis ────► ms-prioridad               │
│  ms-prioridad ──── Redis ────► ms-notificaciones    │
│  ms-notificaciones ──── WebSocket ────► Operadores  │
│  ms-notificaciones ──── gRPC ────► ms-historial     │
│  ms-notificaciones ──── Redis (fallback) ──► ms-historial │
└─────────────────────────────────────────────────────┘
```

> **Requisito cumplido**: Al menos un servicio usa **gRPC** con contrato `.proto` documentado (ms-notificaciones → ms-historial).

> **REST documentado**: OpenAPI disponible en `docs/openapi.yaml`.

---

## Tolerancia a Fallos

1. **Cola de notificaciones fallidas**: Si no hay operadores WebSocket conectados, la alerta se encola en `failed_notifications_queue` y se reintenta cada 5 segundos.
2. **Fallback gRPC → Redis**: Si el servidor gRPC de ms-historial no está disponible, ms-notificaciones encola en `historial_queue` para que ms-historial la consuma al recuperarse.
3. **3 instancias de recepción**: El broker MQTT reparte las alertas con *shared subscriptions* entre 3 instancias de `ms-recepcionAlertas`; Nginx se mantiene para tráfico HTTP.
4. **Geolocalización con timeout**: Si OpenStreetMap tarda demasiado, el sistema sigue con la alerta sin bloquear el envío en tiempo real.
5. **Replicación PostgreSQL**: El maestro replica en streaming a la réplica; si la réplica cae, las lecturas fallan sin afectar las escrituras.

---

## ADRs (Architecture Decision Records)

- [ADR-001: Comunicación gRPC](./adr/ADR-001-comunicacion-grpc.md)
- [ADR-002: Consistencia PostgreSQL](./adr/ADR-002-consistencia-postgresql.md)
- [ADR-003: Redis como Bus de Mensajes](./adr/ADR-003-redis-colas.md)
