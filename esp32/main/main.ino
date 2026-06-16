/*
 * ============================================================
 * ESP32 - Botón de Pánico - Sistema C5 Alerta Ciudadana (CORREGIDO)
 * ============================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

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

// Coordenadas GPS estáticas del dispositivo (CDMX)
const float LAT_DISPOSITIVO = 19.432608;
const float LON_DISPOSITIVO = -99.133209;

// ============================================================
// PINES GPIO
// ============================================================
const int PIN_BOTON = 14;   // GPIO del botón de pánico
const int PIN_LED   = 2;    // LED integrado en la placa

// ============================================================
// CONSTANTES DEL SISTEMA
// ============================================================
const unsigned long TIEMPO_ESPERA_CLICS = 800; // Ventana de tiempo para acumular clics (ms)
const unsigned long RETRY_INTERVAL_MS   = 5000; // Reintento MQTT (ms)
const unsigned long LED_BLINK_MS        = 100;  // Parpadeo LED (ms)

// ============================================================
// VARIABLES GLOBALES
// ============================================================
WiFiClient   espClient;
PubSubClient mqttClient(espClient);

// Variables para el JSON (¡Añadidas para que compile!)
StaticJsonDocument<256> doc;
char buffer[256];

// Variables para el control de clics por software (eliminamos interrupción conflictiva)
int contadorPulsaciones = 0;
unsigned long ultimoTiempoBoton = 0;
bool evaluandoClics = false;
bool ultimoEstadoBoton = HIGH; 
unsigned long ultimoTiempoDebounce = 0;
const unsigned long DEBOUNCE_DELAY = 50; // 50ms para evitar rebotes físicos

unsigned long ultimoReintento = 0;      

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

void publicarAlerta(int clics) {
  doc.clear();
  
  // Asignación de prioridad según tus requerimientos
  String prioridadAsignada;
  if(clics == 1) prioridadAsignada = "crítica";
  else if(clics == 2) prioridadAsignada = "alta";
  else prioridadAsignada = "baja";

  doc["ID_dispositivo"] = DEVICE_ID;
  doc["prioridad"]      = prioridadAsignada; 
  
  JsonObject coords = doc.createNestedObject("coordenadas");
  coords["lat"] = LAT_DISPOSITIVO; // Corregido con la variable global correcta
  coords["lon"] = LON_DISPOSITIVO; // Corregido con la variable global correcta
  
  // Nota: Al no haber servidor NTP activo, enviamos el tiempo activo en milisegundos
  doc["timestamp_ms"] = millis(); 

  size_t n = serializeJson(doc, buffer, sizeof(buffer));
  bool publicado = mqttClient.publish(MQTT_TOPIC, buffer, n);
  
  if (publicado) {
    Serial.printf("[MQTT] ✓ Alerta %s publicada (%d clics)\n", prioridadAsignada.c_str(), clics);
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
  Serial.println("  Sistema C5 - Botón de Pánico ESP32");
  Serial.println("============================================");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // Configuración crucial para tu conexión: resistencia Pull-Up interna activada
  pinMode(PIN_BOTON, INPUT_PULLUP); 

  conectarWifi();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setKeepAlive(60);

  Serial.println("[Sistema] Listo. Presiona el botón para enviar una alerta.");
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  
  if (!mqttClient.connected()) {
    conectarMqtt();
    return; // Si no hay MQTT, no procesamos clicks para evitar pérdidas
  }
  mqttClient.loop();

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