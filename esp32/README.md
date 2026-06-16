/*
 * ============================================================
 * ESP32 - Botón de Pánico + GPS NEO-6M - Sistema C5 Alerta Ciudadana
 * ============================================================
 * 
 * Librerías requeridas (instalar desde Arduino Library Manager):
 *   - PubSubClient  (Nick O'Leary)
 *   - ArduinoJson   (Benoit Blanchon)
 *   - TinyGPS++     (Mikal Hart)
 * 
 * Conexión GPS NEO-6M → ESP32:
 *   GPS TX  → GPIO 16 (RX2 del ESP32)
 *   GPS RX  → GPIO 17 (TX2 del ESP32)  [opcional, solo para configurar]
 *   GPS VCC → 3.3V o 5V
 *   GPS GND → GND
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <MD5Builder.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>

// ============================================================
// CONFIGURACIÓN - MODIFICAR SEGÚN TU RED Y ENTORNO
// ============================================================

// Red WiFi
const char* WIFI_SSID     = "INFINITUM06B5";
const char* WIFI_PASSWORD = "zMU9gWRdMK";

// Broker MQTT
const char* MQTT_SERVER   = "192.168.1.74";
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "alertas";

// ============================================================
// IDENTIFICADOR DEL DISPOSITIVO
// Cambia SOLO este valor entre los dos ESP32:
//   Dispositivo 1: "ESP32-001"
//   Dispositivo 2: "ESP32-002"
// ============================================================
const char* DEVICE_ID = "ESP32-001";

// ============================================================
// COORDENADAS DE RESPALDO (si el GPS no tiene fix)
// Se usan únicamente si el módulo GPS no logra obtener señal
// ============================================================
const float LAT_FALLBACK = 19.432608;
const float LON_FALLBACK = -99.133209;

// ============================================================
// PINES GPIO
// ============================================================
const int PIN_BOTON  = 14;   // GPIO del botón de pánico
const int PIN_LED    = 2;    // LED integrado en la placa
const int GPS_RX_PIN = 16;   // RX2 del ESP32 → TX del NEO-6M
const int GPS_TX_PIN = 17;   // TX2 del ESP32 → RX del NEO-6M (opcional)
const int GPS_BAUD   = 9600; // Velocidad estándar del NEO-6M

// ============================================================
// CONSTANTES DEL SISTEMA
// ============================================================
const unsigned long TIEMPO_ESPERA_CLICS  = 800;   // Ventana de tiempo para acumular clics (ms)
const unsigned long RETRY_INTERVAL_MS    = 5000;  // Reintento MQTT (ms)
const unsigned long LED_BLINK_MS         = 100;   // Parpadeo LED (ms)
const unsigned long GPS_TIMEOUT_MS       = 15000; // Espera fix GPS al presionar botón (ms) - aumentado a 15s
const unsigned long GPS_STATUS_INTERVAL  = 10000; // Reportar estado GPS en Serial cada 10s

// ============================================================
// OBJETOS GLOBALES
// ============================================================
WiFiClient   espClient;
PubSubClient mqttClient(espClient);
TinyGPSPlus  gps;
HardwareSerial gpsSerial(2); // UART2 del ESP32

// Buffer JSON
StaticJsonDocument<300> doc;
char buffer[300];

// ============================================================
// VARIABLES DE CONTROL DE BOTÓN
// ============================================================
int  contadorPulsaciones   = 0;
unsigned long ultimoTiempoBoton    = 0;
bool evaluandoClics        = false;
bool ultimoEstadoBoton     = HIGH;
unsigned long ultimoTiempoDebounce = 0;
const unsigned long DEBOUNCE_DELAY = 50;

unsigned long ultimoReintento   = 0;
unsigned long ultimoStatusGPS   = 0; // Para reportar estado GPS periódicamente
bool gpsFixAnterior             = false; // Para detectar cuando se gana el fix

// ============================================================
// FUNCIONES GPS
// ============================================================

/**
 * Alimenta el parser de TinyGPS++ con los datos que lleguen
 * del módulo GPS por Serial2.
 */
void alimentarGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

/**
 * Obtiene las coordenadas GPS actuales.
 * Espera hasta GPS_TIMEOUT_MS para conseguir un fix válido.
 * Si no hay fix, devuelve las coordenadas de respaldo.
 *
 * @param latOut  Puntero donde se guardará la latitud
 * @param lonOut  Puntero donde se guardará la longitud
 * @param esReal  Puntero bool: true si son coordenadas GPS reales
 */
void obtenerCoordenadas(float* latOut, float* lonOut, bool* esReal) {
  unsigned long inicio = millis();

  Serial.print("[GPS] Esperando fix");

  // Intentar obtener coordenadas frescas en el tiempo límite
  while (millis() - inicio < GPS_TIMEOUT_MS) {
    alimentarGPS();

    if (gps.location.isValid() && gps.location.isUpdated()) {
      *latOut = gps.location.lat();
      *lonOut = gps.location.lng();
      *esReal = true;
      Serial.printf("\n[GPS] ✓ Fix obtenido: %.6f, %.6f (precisión HDOP: %.1f)\n",
                    *latOut, *lonOut, gps.hdop.value() / 100.0);
      return;
    }
    delay(50);
    Serial.print(".");
  }

  // Si hay fix previo (aunque no se haya actualizado ahora), úsalo
  if (gps.location.isValid()) {
    *latOut = gps.location.lat();
    *lonOut = gps.location.lng();
    *esReal = true;
    Serial.printf("\n[GPS] ✓ Fix previo usado: %.6f, %.6f\n", *latOut, *lonOut);
    return;
  }

  // Sin fix disponible: usar coordenadas de respaldo
  *latOut = LAT_FALLBACK;
  *lonOut = LON_FALLBACK;
  *esReal = false;
  Serial.println("\n[GPS] ✗ Sin fix. Usando coordenadas de respaldo.");
}

// ============================================================
// FUNCIONES DE CONEXIÓN
// ============================================================

void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("[WiFi] Conectando a '%s'", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.printf("[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
}

bool conectarMqtt() {
  if (mqttClient.connected()) return true;

  unsigned long ahora = millis();
  if (ahora - ultimoReintento < RETRY_INTERVAL_MS) return false;
  ultimoReintento = ahora;

  Serial.printf("[MQTT] Conectando a %s:%d...\n", MQTT_SERVER, MQTT_PORT);

  String clientId = String("ESP32-") + String(DEVICE_ID);
  bool conectado = mqttClient.connect(clientId.c_str());

  if (conectado) {
    Serial.println("[MQTT] Conectado al broker!");
    for (int i = 0; i < 3; i++) {
      digitalWrite(PIN_LED, HIGH);
      delay(LED_BLINK_MS);
      digitalWrite(PIN_LED, LOW);
      delay(LED_BLINK_MS);
    }
  } else {
    Serial.printf("[MQTT] Fallo. Código: %d. Reintentando...\n", mqttClient.state());
  }

  return conectado;
}

// ============================================================
// FUNCIÓN PRINCIPAL: PUBLICAR ALERTA
// ============================================================

String generarHashAlerta(int clics, unsigned long timestamp) {
  String inputStr = String(DEVICE_ID) + "_" + String(timestamp) + "_" + String(clics);
  MD5Builder md5;
  md5.begin();
  md5.add(inputStr.c_str());
  md5.calculate();
  return md5.toString().substring(0, 12);
}

void publicarAlerta(int clics) {
  // 1. Obtener coordenadas GPS reales (o fallback)
  float lat, lon;
  bool gpsReal;
  obtenerCoordenadas(&lat, &lon, &gpsReal);

  // 2. Construir el JSON
  doc.clear();

  String prioridadAsignada;
  if (clics == 1)      prioridadAsignada = "crítica";
  else if (clics == 2) prioridadAsignada = "alta";
  else                 prioridadAsignada = "baja";

  unsigned long timestamp_ms = millis();
  String alert_id = generarHashAlerta(clics, timestamp_ms);

  doc["alert_id"]      = alert_id;
  doc["ID_dispositivo"] = DEVICE_ID;
  doc["prioridad"]     = prioridadAsignada;

  JsonObject coords = doc.createNestedObject("coordenadas");
  coords["lat"]  = serialized(String(lat, 6));   // 6 decimales de precisión
  coords["lon"]  = serialized(String(lon, 6));
  coords["gps_real"] = gpsReal;                  // indica si la fuente es GPS real

  doc["timestamp_ms"] = timestamp_ms;

  // 3. Publicar
  size_t n = serializeJson(doc, buffer, sizeof(buffer));
  bool publicado = mqttClient.publish(MQTT_TOPIC, buffer, n);

  if (publicado) {
    Serial.printf("[MQTT] ✓ Alerta '%s' publicada (ID: %s, %d clic(s), GPS: %s)\n",
                  prioridadAsignada.c_str(), alert_id.c_str(), clics,
                  gpsReal ? "REAL" : "FALLBACK");
    // Feedback visual: destello largo al enviar exitosamente
    digitalWrite(PIN_LED, HIGH);
    delay(500);
    digitalWrite(PIN_LED, LOW);
  } else {
    Serial.println("[MQTT] ✗ Error al publicar la alerta.");
  }
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n============================================");
  Serial.printf( "  Sistema C5 - Botón de Pánico + GPS\n");
  Serial.printf( "  Dispositivo: %s\n", DEVICE_ID);
  Serial.println("============================================");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  pinMode(PIN_BOTON, INPUT_PULLUP);

  // Inicializar GPS por UART2
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GPS] Módulo NEO-6M en GPIO RX=%d, TX=%d a %d bps\n",
                GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
  Serial.println("[GPS] Esperando señal satelital... (puede tomar 1-3 min en exterior)");

  conectarWifi();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);

  Serial.println("[Sistema] Listo. Presiona el botón para enviar una alerta.");
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
void loop() {
  // Alimentar el parser GPS continuamente (no bloquea)
  alimentarGPS();

  // ---- ESTADO GPS: reportar cada 10 seg y cuando cambia ----
  bool gpsFixActual = gps.location.isValid();
  unsigned long ahoraMs = millis();

  if (gpsFixActual && !gpsFixAnterior) {
    Serial.println("\n[GPS] FIX OBTENIDO! Ya puedes presionar el boton con coordenadas reales.");
    Serial.printf("[GPS] Satelites: %d | Lat: %.6f | Lon: %.6f\n",
                  gps.satellites.value(),
                  gps.location.lat(),
                  gps.location.lng());
    gpsFixAnterior = true;
  }

  if (!gpsFixActual && gpsFixAnterior) {
    Serial.println("[GPS] Fix perdido. Reacquiriendo satelites...");
    gpsFixAnterior = false;
  }

  if (ahoraMs - ultimoStatusGPS > GPS_STATUS_INTERVAL) {
    ultimoStatusGPS = ahoraMs;
    if (gpsFixActual) {
      Serial.printf("[GPS] Fix activo | Sat: %d | %.6f, %.6f\n",
                    gps.satellites.value(),
                    gps.location.lat(),
                    gps.location.lng());
    } else {
      Serial.printf("[GPS] Buscando satelites... (chars: %lu, frases OK: %lu)\n",
                    gps.charsProcessed(),
                    gps.sentencesWithFix());
      if (gps.charsProcessed() < 10) {
        Serial.println("[GPS] ADVERTENCIA: Sin datos del modulo - verifica cable TX->GPIO16");
      }
    }
  }

  if (WiFi.status() != WL_CONNECTED) conectarWifi();

  if (!mqttClient.connected()) {
    conectarMqtt();
    return;
  }
  mqttClient.loop();

  // ---- LOGICA DE DEBOUNCE Y DETECCION DE CLICS ----
  int lectura = digitalRead(PIN_BOTON);

  if (lectura != ultimoEstadoBoton) {
    ultimoTiempoDebounce = millis();
  }

  if ((millis() - ultimoTiempoDebounce) > DEBOUNCE_DELAY) {
    if (lectura == LOW && evaluandoClics == false) {
      contadorPulsaciones++;
      evaluandoClics = true;
      ultimoTiempoBoton = millis();
      Serial.printf("[Boton] Clic %d | GPS: %s\n",
                    contadorPulsaciones, gpsFixActual ? "REAL" : "SIN FIX (usara respaldo)");
      while (digitalRead(PIN_BOTON) == LOW) { delay(10); }
    } else if (lectura == LOW && evaluandoClics == true) {
      contadorPulsaciones++;
      ultimoTiempoBoton = millis();
      Serial.printf("[Boton] Clic adicional (%d)\n", contadorPulsaciones);
      while (digitalRead(PIN_BOTON) == LOW) { delay(10); }
    }
  }

  ultimoEstadoBoton = lectura;

  if (evaluandoClics && (millis() - ultimoTiempoBoton > TIEMPO_ESPERA_CLICS)) {
    publicarAlerta(contadorPulsaciones);
    contadorPulsaciones = 0;
    evaluandoClics = false;
  }

  delay(10);
}