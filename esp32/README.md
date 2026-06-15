# ESP32 - Botón de Pánico · Sistema C5 Alerta Ciudadana

Este documento describe el hardware, las conexiones eléctricas y los pasos para programar el ESP32 que actúa como dispositivo de alerta ciudadana.

---

## Componentes Necesarios

| Componente | Cantidad | Descripción |
|---|---|---|
| ESP32 DevKit | 1 | Cualquier variante (WROOM-32, WROVER, etc.) |
| Botón pulsador | 1 | Momentáneo, contacto normalmente abierto (NO) |
| LED (opcional) | 1 | Para indicador visual de estado |
| Resistencia 220Ω | 1 | Para el LED (si es externo) |
| Protoboard | 1 | Para el montaje |
| Cables jumper | varios | Para las conexiones |
| Cable USB | 1 | Para programar el ESP32 |

---

## Diagrama de Conexiones

```
ESP32                    Componentes
─────────────────────────────────────────────────────
GPIO 14  ──────────────── [Botón] ──── GND
           (INPUT_PULLUP)
                                                     
GPIO 2   ──── [220Ω] ──── [LED+] ──── LED- ──── GND
         (LED integrado en la mayoría de placas)
                          
3.3V / 5V ─────────────── VIN (alimentación placa)
GND       ─────────────── GND
```

### Botón de Pánico - Detalle

```
GPIO 14 ─────┬──── [Botón pulsador] ──── GND
             │
          (Pull-Up interno activado en el firmware)
          Sin resistencia externa necesaria.
```

**Nota**: El firmware usa `INPUT_PULLUP`, por lo que el botón conecta `GPIO14` a `GND` al presionar (lógica inversa). Esto ya está manejado con `FALLING` en la interrupción.

---

## Instalación del Entorno Arduino

### Paso 1: Instalar Arduino IDE

Descarga Arduino IDE 2.x desde: https://www.arduino.cc/en/software

### Paso 2: Agregar soporte para ESP32

1. Abrir Arduino IDE → **Archivo → Preferencias**
2. En "URLs adicionales para el Gestor de Placas", agregar:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Ir a **Herramientas → Placa → Gestor de Placas**
4. Buscar `esp32` e instalar **"esp32 by Espressif Systems"** (versión 2.x o superior)

### Paso 3: Seleccionar la placa

- **Herramientas → Placa → ESP32 Arduino → ESP32 Dev Module**

### Paso 4: Instalar librerías necesarias

Ir a **Herramientas → Administrar Librerías** e instalar:

| Librería | Autor | Para qué sirve |
|---|---|---|
| **PubSubClient** | Nick O'Leary | Cliente MQTT |
| **ArduinoJson** | Benoit Blanchon | Serialización JSON |

---

## Configuración del Firmware

Abrir el archivo `main/main.ino` y modificar las siguientes constantes al inicio:

```cpp
// ── Tu red WiFi ──────────────────────────────────────
const char* WIFI_SSID     = "NOMBRE_DE_TU_RED";
const char* WIFI_PASSWORD = "TU_CONTRASEÑA";

// ── IP del servidor donde corre Docker ───────────────
// Usa: ipconfig (Windows) o ip addr (Linux) para encontrarla
const char* MQTT_SERVER   = "192.168.1.100";   // ← CAMBIAR

// ── Identificador único del dispositivo ──────────────
const char* DEVICE_ID     = "ESP32-001";        // ← CAMBIAR por dispositivo

// ── Tipo de emergencia de este dispositivo ───────────
const char* TIPO_EMERGENCIA = "panico";

// ── Coordenadas fijas del dispositivo (si sin GPS) ───
const float LAT_DISPOSITIVO = 19.432608;
const float LON_DISPOSITIVO = -99.133209;
```

### Cómo encontrar la IP de tu máquina con Docker

**Windows (PowerShell):**
```powershell
ipconfig
# Busca "Adaptador de Ethernet" o "Adaptador Wi-Fi" → Dirección IPv4
```

**Linux/macOS:**
```bash
ip addr show | grep "inet "
# o
hostname -I
```

---

## Programar el ESP32

1. Conectar el ESP32 via USB a tu computadora
2. En Arduino IDE → **Herramientas → Puerto** → seleccionar el puerto COM del ESP32
   - Windows: `COM3`, `COM4`, etc.
   - Linux: `/dev/ttyUSB0` o `/dev/ttyACM0`
3. Configurar velocidad de upload si es necesario: **Herramientas → Upload Speed → 115200**
4. Clic en **→ Subir** (flecha derecha) o `Ctrl+U`

---

## Verificar el Funcionamiento

### 1. Monitor Serie

Abrir **Herramientas → Monitor Serie** (baudios: `115200`).

Al arrancar verás:
```
============================================
  Sistema C5 - Botón de Pánico ESP32
============================================
  Dispositivo ID : ESP32-001
  Tipo emergencia: panico
  Coordenadas    : (19.432608, -99.133209)
============================================

[WiFi] Conectando a 'MI_RED'...
[WiFi] Conectado! IP: 192.168.1.150
[MQTT] Conectando a 192.168.1.100:1883...
[MQTT] Conectado al broker!
[Sistema] Listo. Presiona el botón para enviar una alerta.
```

### 2. Al presionar el botón

```
[BOTÓN] ¡Botón de pánico presionado!
[MQTT] ✓ Alerta publicada en topic 'alertas':
{"ID_dispositivo":"ESP32-001","timestamp":"2024-01-01T00:01:23.456Z","tipo_emergencia":"panico","coordenadas":{"lat":19.432608,"lon":-99.133209}}
```

### 3. Verificar en el sistema C5

El sistema procesará automáticamente la alerta y:
1. `ms-recepcion-alertas` → la valida y encola en Redis
2. `ms-geolocalizacion` → obtiene la dirección de las coordenadas
3. `ms-prioridad` → asigna nivel `crítica` (tipo `panico`)
4. `ms-notificaciones` → envía a operadores vía WebSocket
5. `ms-historial` → guarda en PostgreSQL vía gRPC

Para confirmar, conectarse como operador:
```
ws://localhost:3004
```

---

## Solución de Problemas

| Problema | Posible causa | Solución |
|---|---|---|
| No se conecta al WiFi | Credenciales incorrectas | Verificar SSID y contraseña |
| `MQTT` código -2 | IP del broker incorrecta | Usar `ping` para verificar la IP |
| `MQTT` código -4 | Firewall bloqueando puerto 1883 | Abrir puerto 1883 en el firewall |
| LED no parpadea | Pin incorrecto | Cambiar `PIN_LED` al pin correcto de tu placa |
| Alerta se envía doble | Rebote del botón | Ajustar `DEBOUNCE_MS` |
| Puerto COM no aparece | Driver CH340/CP2102 faltante | Instalar el driver del chip USB del ESP32 |

### Driver USB para ESP32

- **CH340** (placas económicas): https://www.wch-ic.com/downloads/CH341SER_EXE.html
- **CP2102** (Silicon Labs): https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

---

## Estructura del Mensaje MQTT

El ESP32 publica en el topic `alertas` el siguiente JSON:

```json
{
  "ID_dispositivo": "ESP32-001",
  "timestamp": "2024-01-01T00:01:23.456Z",
  "tipo_emergencia": "panico",
  "coordenadas": {
    "lat": 19.432608,
    "lon": -99.133209
  }
}
```

Este formato es validado por `ms-recepcionAlertas/models/alertaModel.js`.

---

## Expansión con GPS Real (Opcional)

Para usar un módulo GPS real (ej: **NEO-6M**):

**Conexión NEO-6M → ESP32:**
```
NEO-6M TX  → ESP32 GPIO 16 (RX2)
NEO-6M RX  → ESP32 GPIO 17 (TX2)
NEO-6M VCC → 3.3V
NEO-6M GND → GND
```

**Código adicional (reemplazar valores fijos):**
```cpp
#include <TinyGPS++.h>
#include <HardwareSerial.h>

HardwareSerial gpsSerial(2);
TinyGPSPlus gps;

void setup() {
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
}

// En publicarAlerta():
while (gpsSerial.available() > 0) {
  gps.encode(gpsSerial.read());
}
float lat = gps.location.lat();
float lon = gps.location.lng();
```
