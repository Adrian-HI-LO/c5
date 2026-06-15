/*
 * ============================================================
 * ESP32 - Botón de Pánico - Sistema C5 Alerta Ciudadana
 * ============================================================
 * 
 * Descripción:
 *   Este firmware permite al ESP32 actuar como dispositivo
 *   de alerta ciudadana. Al presionar el botón de pánico,
 *   captura las coordenadas GPS (simuladas o reales) y
 *   publica una alerta vía MQTT al broker del sistema C5.
 *
 * Hardware requerido:
 *   - ESP32 (cualquier variante: ESP32 DevKit, WROOM, etc.)
 *   - Botón pulsador (momentáneo, NO)
 *   - LED de estado (opcional)
 *   - Resistencia 10kΩ (pull-down para el botón)
 *
 * Conexiones:
 *   - Botón  → GPIO 14 (con pull-up interno activado)
 *   - LED    → GPIO 2  (LED integrado en la mayoría de placas)
 *   - GND    → GND
 *
 * Librerías requeridas (instalar en Arduino IDE):
 *   - WiFi.h          (incluida con el soporte ESP32)
 *   - PubSubClient    (Nick O'Leary) - Instalar desde Library Manager
 *   - ArduinoJson     (Benoit Blanchon) - Instalar desde Library Manager
 *
 * ============================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ============================================================
// CONFIGURACIÓN - MODIFICAR SEGÚN TU RED Y ENTORNO
// ============================================================

// Red WiFi
const char* WIFI_SSID     = "Nothing_11";       // Nombre de tu red WiFi
const char* WIFI_PASSWORD = "12345678";    // Contraseña de tu red WiFi

// Broker MQTT (IP de la máquina donde corre Docker)
// Si Docker está en la misma red, usa la IP local de esa máquina.
// Ejemplo: "192.168.1.100"
const char* MQTT_SERVER   = "10.252.169.28";       // ← CAMBIAR por tu IP
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "alertas";

// Identificador único del dispositivo
// Cambiar por un ID único por dispositivo (ej: número de serie, MAC)
const char* DEVICE_ID     = "ESP32-001";
// --- Variables para contar pulsaciones del botón ---
int contadorPulsaciones = 0;
unsigned long ultimoTiempoBoton = 0;
const unsigned long TIEMPO_ESPERA_CLICS = 800; // 800 milisegundos para esperar más clics
bool evaluandoClics = false;

// Tipo de emergencia que enviará este dispositivo
// Opciones: "incendio", "robo", "asalto", "emergencia médica",
//           "accidente grave", "panico", "actividad sospechosa", "otro"
const char* TIPO_EMERGENCIA = "panico";

// Coordenadas GPS del dispositivo
// Si tienes módulo GPS (ej: NEO-6M), reemplaza estas por lecturas reales.
// Coordenadas de ejemplo: Ciudad de México, CDMX
const float LAT_DISPOSITIVO = 19.432608;
const float LON_DISPOSITIVO = -99.133209;

// ============================================================
// PINES GPIO
// ============================================================
const int PIN_BOTON = 14;   // GPIO del botón de pánico
const int PIN_LED   = 2;    // LED de estado (integrado en la placa)

// ============================================================
// CONSTANTES DEL SISTEMA
// ============================================================
const unsigned long DEBOUNCE_MS       = 200;   // Anti-rebote del botón (ms)
const unsigned long RETRY_INTERVAL_MS = 5000;  // Intervalo de reintento MQTT (ms)
const unsigned long LED_BLINK_MS      = 100;   // Duración del parpadeo LED (ms)

// ============================================================
// VARIABLES GLOBALES
// ============================================================
WiFiClient   espClient;
PubSubClient mqttClient(espClient);

volatile bool botonPresionado  = false;  // Flag de interrupción del botón
unsigned long ultimoTimboton   = 0;      // Timestamp del último press (debounce)
unsigned long ultimoReintento  = 0;      // Timestamp del último intento MQTT

// ============================================================
// ISR - Interrupción del botón de pánico
// ============================================================
void IRAM_ATTR isrBoton() {
  unsigned long ahora = millis();
  if (ahora - ultimoTimboton > DEBOUNCE_MS) {
    botonPresionado = true;
    ultimoTimboton  = ahora;
  }
}

// ============================================================
// FUNCIONES DE CONEXIÓN
// ============================================================

/**
 * Conecta al WiFi. Bloquea hasta conseguir conexión.
 */
void conectarWifi() {
  Serial.printf("[WiFi] Conectando a '%s'", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.printf("[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
}

/**
 * Intenta conectar/reconectar al broker MQTT.
 * @return true si se conectó exitosamente.
 */
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
    // Parpadear LED para confirmar conexión
    for (int i = 0; i < 3; i++) {
      digitalWrite(PIN_LED, HIGH);
      delay(LED_BLINK_MS);
      digitalWrite(PIN_LED, LOW);
      delay(LED_BLINK_MS);
    }
  } else {
    Serial.printf("[MQTT] Fallo. Código: %d. Reintentando en %lus...\n",
                  mqttClient.state(), RETRY_INTERVAL_MS / 1000);
  }

  return conectado;
}

// ============================================================
// FUNCIÓN PRINCIPAL: PUBLICAR ALERTA
// ============================================================

/**
 * Construye y publica el JSON de alerta en el topic MQTT.
 */
void publicarAlerta(int clics) {
  // Limpiamos memoria del JSON
  doc.clear();
  
  // 1 clic = critica, 2 clics = alta, 3+ clics = baja
  String prioridadAsignada;
  if(clics == 1) prioridadAsignada = "crítica";
  else if(clics == 2) prioridadAsignada = "alta";
  else prioridadAsignada = "baja";

  doc["ID_dispositivo"]  = DEVICE_ID;
  
  // Enviamos nuestra prioridad en lugar de "tipo_emergencia"
  doc["prioridad"] = prioridadAsignada; 
  
  JsonObject coords = doc.createNestedObject("coordenadas");
  coords["lat"] = currentLat;
  coords["lon"] = currentLon;
  doc["timestamp"] = obtenerTimestampISO();

  // El resto queda igual, para publicar
  size_t n = serializeJson(doc, buffer, sizeof(buffer));
  bool publicado = mqttClient.publish(MQTT_TOPIC, buffer, n);
  if (publicado) {
    Serial.printf("[MQTT] ✓ Alerta %s publicada (%d clics)\n", prioridadAsignada.c_str(), clics);
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
  Serial.println("  Sistema C5 - Botón de Pánico ESP32");
  Serial.println("============================================");
  Serial.printf("  Dispositivo ID : %s\n", DEVICE_ID);
  Serial.printf("  Tipo emergencia: %s\n", TIPO_EMERGENCIA);
  Serial.printf("  Coordenadas    : (%.6f, %.6f)\n", LAT_DISPOSITIVO, LON_DISPOSITIVO);
  Serial.println("============================================\n");

  // Configurar pines
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_BOTON, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_BOTON), isrBoton, FALLING);

  // Conectar WiFi
  conectarWifi();

  // Configurar cliente MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);

  Serial.println("[Sistema] Listo. Presiona el botón para enviar una alerta.");
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  if (!conectarMqtt()) {
    delay(5000);
    return;
  }
  mqttClient.loop();

  // ----- LECTURA MANUAL DE BOTÓN (sin interrupción) -----
  // Asumiendo botón en modo PULL-UP (LOW significa presionado)
  bool estadoBoton = digitalRead(PIN_BOTON) == LOW; 
  
  if (estadoBoton) {
    delay(150); // anti-rebote básico min
    contadorPulsaciones++;
    evaluandoClics = true;
    ultimoTiempoBoton = millis();
    while(digitalRead(PIN_BOTON) == LOW) { delay(10); } // esperar que suelte
  }

  // Si pasaron 800ms desde el último clic y hay clics registrados, enviar!
  if (evaluandoClics && (millis() - ultimoTiempoBoton > TIEMPO_ESPERA_CLICS)) {
      publicarAlerta(contadorPulsaciones);
      
      // Reiniciar para la siguiente
      contadorPulsaciones = 0;
      evaluandoClics = false;
  }

  delay(10);  
}
