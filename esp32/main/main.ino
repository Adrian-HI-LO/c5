/*
 * ============================================================
 * ESP32 - Botón de Pánico - Sistema C5 Alerta Ciudadana (CORREGIDO)
 * ============================================================
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
const char* WIFI_SSID     = "Nothing_11";       
const char* WIFI_PASSWORD = "12345678";    

// Broker MQTT
const char* MQTT_SERVER   = "10.213.95.28";       
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "alertas";

// Identificador único del dispositivo
const char* DEVICE_ID     = "ESP32-001";

// Coordenadas de respaldo si el GPS aún no tiene fix
const float LAT_FALLBACK = 19.432608;
const float LON_FALLBACK = -99.133209;

// GPS NEO-6M
const int GPS_RX_PIN = 16;   // RX2 del ESP32 ← TX del NEO-6M
const int GPS_TX_PIN = 17;   // TX2 del ESP32 → RX del NEO-6M (opcional)
const int GPS_BAUD   = 9600;

// ============================================================
// PINES GPIO
// ============================================================
const int PIN_BOTON = 14;   // GPIO del botón de pánico
const int PIN_LED   = 2;    // LED integrado en la placa

// ============================================================
// CONSTANTES DEL SISTEMA
// ============================================================
const unsigned long TIEMPO_ESPERA_CLICS = 350; // Ventana de tiempo para acumular clics (ms)
const unsigned long RETRY_INTERVAL_MS   = 2000; // Reintento MQTT/WiFi (ms)
const unsigned long LED_BLINK_MS        = 100;  // Parpadeo LED (ms)
const uint8_t MAX_ALERTAS_PENDIENTES    = 5;
const unsigned long GPS_STATUS_INTERVAL_MS = 10000;
const unsigned long GPS_FIX_MAX_AGE_MS = 5000;

// ============================================================
// VARIABLES GLOBALES
// ============================================================
WiFiClient   espClient;
PubSubClient mqttClient(espClient);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Variables para el JSON (¡Añadidas para que compile!)
StaticJsonDocument<320> doc;
char buffer[320];

// Variables para el control de clics por software (eliminamos interrupción conflictiva)
int contadorPulsaciones = 0;
unsigned long ultimoTiempoBoton = 0;
bool evaluandoClics = false;
bool ultimoEstadoBoton = HIGH; 
unsigned long ultimoTiempoDebounce = 0;
const unsigned long DEBOUNCE_DELAY = 50; // 50ms para evitar rebotes físicos

unsigned long ultimoReintento = 0;      
unsigned long ultimoReintentoWifi = 0;
unsigned long ultimoStatusGPS = 0;
bool gpsFixAnterior = false;
float ultimaLatValida = LAT_FALLBACK;
float ultimaLonValida = LON_FALLBACK;
bool ultimaUbicacionReal = false;

String alertasPendientes[MAX_ALERTAS_PENDIENTES];
uint8_t indicePendienteInicio = 0;
uint8_t indicePendienteFin = 0;
uint8_t totalPendientes = 0;

// ============================================================
// FUNCIONES DE CONEXIÓN
// ============================================================

void alimentarGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

void reportarEstadoGPS() {
  unsigned long ahora = millis();
  bool gpsFixActual = gps.location.isValid() && gps.location.age() <= GPS_FIX_MAX_AGE_MS;

  if (gpsFixActual && !gpsFixAnterior) {
    Serial.println("\n[GPS] FIX OBTENIDO! Ya puedes presionar el boton con coordenadas reales.");
    Serial.printf("[GPS] Satelites: %lu | Lat: %.6f | Lon: %.6f\n",
                  gps.satellites.isValid() ? gps.satellites.value() : 0,
                  gps.location.lat(),
                  gps.location.lng());
  } else if (!gpsFixActual && gpsFixAnterior) {
    Serial.println("[GPS] Fix perdido. Reacquiriendo satelites...");
  }

  if (ahora - ultimoStatusGPS >= GPS_STATUS_INTERVAL_MS) {
    ultimoStatusGPS = ahora;
    if (gpsFixActual) {
      double hdop = gps.hdop.isValid() ? (gps.hdop.value() / 100.0) : -1.0;
      Serial.printf("[GPS] Fix activo | Sat: %lu | %.6f, %.6f | HDOP: %s\n",
                    gps.satellites.isValid() ? gps.satellites.value() : 0,
                    gps.location.lat(),
                    gps.location.lng(),
                    (hdop >= 0.0) ? String(hdop, 1).c_str() : "N/A");
    } else {
      Serial.printf("[GPS] Buscando satelites... (chars: %lu, frases con fix: %lu)\n",
                    gps.charsProcessed(),
                    gps.sentencesWithFix());
      if (gps.charsProcessed() < 10) {
        Serial.println("[GPS] ADVERTENCIA: sin datos del modulo - verifica cable TX del NEO-6M a GPIO16");
      }
    }
  }

  gpsFixAnterior = gpsFixActual;
}

bool obtenerCoordenadas(float* latOut, float* lonOut, bool* esReal) {
  alimentarGPS();

  if (gps.location.isValid() && gps.location.age() <= GPS_FIX_MAX_AGE_MS) {
    *latOut = gps.location.lat();
    *lonOut = gps.location.lng();
    *esReal = true;
    ultimaLatValida = *latOut;
    ultimaLonValida = *lonOut;
    ultimaUbicacionReal = true;
    return true;
  }

  if (gps.location.isValid()) {
    *latOut = gps.location.lat();
    *lonOut = gps.location.lng();
    *esReal = true;
    ultimaLatValida = *latOut;
    ultimaLonValida = *lonOut;
    ultimaUbicacionReal = true;
    return true;
  }

  if (ultimaUbicacionReal) {
    *latOut = ultimaLatValida;
    *lonOut = ultimaLonValida;
    *esReal = true;
    return false;
  }

  *latOut = LAT_FALLBACK;
  *lonOut = LON_FALLBACK;
  *esReal = false;
  return false;
}

bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  unsigned long ahora = millis();
  if (ahora - ultimoReintentoWifi < RETRY_INTERVAL_MS) return false;
  ultimoReintentoWifi = ahora;

  Serial.printf("[WiFi] Reintentando conexión a '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  return false;
}

bool conectarMqtt() {
  if (mqttClient.connected()) return true;

  if (WiFi.status() != WL_CONNECTED) return false;

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

bool encolarAlertaPendiente(const String& payload) {
  if (payload.length() == 0) return false;

  if (totalPendientes >= MAX_ALERTAS_PENDIENTES) {
    Serial.println("[MQTT] Cola de pendientes llena. Se descarta la alerta más antigua para conservar la nueva.");
    indicePendienteInicio = (indicePendienteInicio + 1) % MAX_ALERTAS_PENDIENTES;
    totalPendientes--;
  }

  alertasPendientes[indicePendienteFin] = payload;
  indicePendienteFin = (indicePendienteFin + 1) % MAX_ALERTAS_PENDIENTES;
  totalPendientes++;
  return true;
}

bool obtenerSiguientePendiente(String& payload) {
  if (totalPendientes == 0) return false;

  payload = alertasPendientes[indicePendienteInicio];
  alertasPendientes[indicePendienteInicio] = "";
  indicePendienteInicio = (indicePendienteInicio + 1) % MAX_ALERTAS_PENDIENTES;
  totalPendientes--;
  return true;
}

void reintentarAlertasPendientes() {
  if (!mqttClient.connected() || totalPendientes == 0) return;

  while (totalPendientes > 0) {
    String payload;
    if (!obtenerSiguientePendiente(payload)) break;

    bool publicado = mqttClient.publish(MQTT_TOPIC, payload.c_str(), payload.length());
    if (publicado) {
      Serial.println("[MQTT] ✓ Alerta pendiente reenviada correctamente.");
    } else {
      Serial.println("[MQTT] ✗ No se pudo reenviar una alerta pendiente. Se mantiene en cola.");
      encolarAlertaPendiente(payload);
      break;
    }
  }
}

// ============================================================
// FUNCIÓN PRINCIPAL: PUBLICAR ALERTA
// ============================================================

String generarHashAlerta(int clics, unsigned long timestamp) {
  // Generar ID único determinístico para deduplicación
  String inputStr = String(DEVICE_ID) + "_" + String(timestamp) + "_" + String(clics);
  
  // Usar MD5Builder para generar hash en ESP32
  MD5Builder md5;
  md5.begin();
  md5.add(inputStr.c_str());
  md5.calculate();
  
  // Retornar primeros 12 caracteres del hash
  String fullHash = md5.toString();
  return fullHash.substring(0, 12);
}

void publicarAlerta(int clics) {
  doc.clear();
  
  // Asignación de prioridad según tus requerimientos
  String prioridadAsignada;
  if(clics == 1) prioridadAsignada = "crítica";
  else if(clics == 2) prioridadAsignada = "alta";
  else prioridadAsignada = "baja";

  float lat, lon;
  bool gpsReal;
  obtenerCoordenadas(&lat, &lon, &gpsReal);

  unsigned long timestamp_ms = millis();
  String alert_id = generarHashAlerta(clics, timestamp_ms);

  doc["alert_id"] = alert_id;  // ID único para deduplicación
  doc["ID_dispositivo"] = DEVICE_ID;
  doc["prioridad"] = prioridadAsignada; 
  
  JsonObject coords = doc.createNestedObject("coordenadas");
  coords["lat"] = lat; 
  coords["lon"] = lon; 
  coords["gps_real"] = gpsReal;
  
  doc["timestamp_ms"] = timestamp_ms; 

  size_t n = serializeJson(doc, buffer, sizeof(buffer));
  bool publicado = mqttClient.publish(MQTT_TOPIC, buffer, n);
  
  if (publicado) {
    Serial.printf("[MQTT] ✓ Alerta %s publicada (ID: %s, %d clics)\n", prioridadAsignada.c_str(), alert_id.c_str(), clics);
    // Feedback visual: destello largo al enviar exitosamente
    digitalWrite(PIN_LED, HIGH);
    delay(500);
    digitalWrite(PIN_LED, LOW);
  } else {
    Serial.println("[MQTT] ✗ Error al publicar la alerta.");
    encolarAlertaPendiente(String(buffer));
  }
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n============================================");
  Serial.println("  Sistema C5 - Botón de Pánico ESP32");
  Serial.println("============================================");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // Configuración crucial para tu conexión: resistencia Pull-Up interna activada
  pinMode(PIN_BOTON, INPUT_PULLUP); 

  // GPS NEO-6M por UART2
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GPS] NEO-6M inicializado en RX=%d TX=%d a %d bps\n", GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
  Serial.println("[GPS] Esperando señal satelital... si estas dentro de casa puede tardar o no fijar.");

  conectarWifi();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(2);

  Serial.println("[Sistema] Listo. Presiona el botón para enviar una alerta.");
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
void loop() {
  alimentarGPS();
  reportarEstadoGPS();

  if (WiFi.status() != WL_CONNECTED) {
    conectarWifi();
  }

  if (!mqttClient.connected()) {
    conectarMqtt();
  } else {
    mqttClient.loop();
    reintentarAlertasPendientes();
  }

  // ---- LÓGICA DE DEBOUNCE Y DETECCIÓN DE CLICS ----
  int lectura = digitalRead(PIN_BOTON);

  // Si el botón cambió de estado (por ruido o presión)
  if (lectura != ultimoEstadoBoton) {
    ultimoTiempoDebounce = millis();
  }

  if ((millis() - ultimoTiempoDebounce) > DEBOUNCE_DELAY) {
    // Si el estado ha sido estable y es LOW significa que fue presionado realmente
    if (lectura == LOW && evaluandoClics == false) {
      contadorPulsaciones++;
      evaluandoClics = true;
      ultimoTiempoBoton = millis();
      Serial.printf("[Botón] Clic detectado (%d)\n", contadorPulsaciones);
      
      // Esperar de forma segura a que se suelte el botón para no registrar múltiples clicks continuos
      while(digitalRead(PIN_BOTON) == LOW) { delay(10); } 
    }
    else if (lectura == LOW && evaluandoClics == true) {
      // Sumar clics adicionales dentro de la ventana de tiempo
      contadorPulsaciones++;
      ultimoTiempoBoton = millis();
      Serial.printf("[Botón] Clic adicional detectado (%d)\n", contadorPulsaciones);
      while(digitalRead(PIN_BOTON) == LOW) { delay(10); }
    }
  }

  ultimoEstadoBoton = lectura;

  // Si ya terminó el tiempo de espera (800ms) desde el último clic, enviamos el paquete
  if (evaluandoClics && (millis() - ultimoTiempoBoton > TIEMPO_ESPERA_CLICS)) {
      publicarAlerta(contadorPulsaciones);
      
      // Reiniciar variables para la siguiente ráfaga de clics
      contadorPulsaciones = 0;
      evaluandoClics = false;
  }

  delay(10);  
}