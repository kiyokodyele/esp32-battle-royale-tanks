/*
 * Tank 1990 - ESP32 Controller
 *
 * This code runs on an ESP32 device to control a tank in the
 * Tank 1990 multiplayer game via WebSocket connection.
 *
 * Hardware Requirements:
 * - ESP32 DevKit or similar
 * - 4 Navigation buttons (UP, DOWN, LEFT, RIGHT)
 * - 1 Fire button
 *
 * Button Wiring (Active LOW with internal pull-up):
 * - BTN_UP    -> GPIO 32
 * - BTN_DOWN  -> GPIO 33
 * - BTN_LEFT  -> GPIO 25
 * - BTN_RIGHT -> GPIO 26
 * - BTN_FIRE  -> GPIO 27
 *
 * Libraries Required:
 * - WiFi (built-in)
 * - WebSocketsClient by Markus Sattler
 * - ArduinoJson by Benoit Blanchon
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================
// CONFIGURATION - MODIFY THESE VALUES
// ============================================

// WiFi Configuration
const char* WIFI_SSID = "Erza";
const char* WIFI_PASSWORD = "ErzaKnightw@lk3r";

// Game Server Configuration
const char* SERVER_HOST = "15.235.204.158";  // Change to your server IP
const int SERVER_PORT = 3000;

// Tank Configuration (Fixed for this device)
const char* TANK_NAME = "SIR. PAGUIO";
const char* PRIMARY_COLOR = "#03FCDF";    // Purple
const char* SECONDARY_COLOR = "#FFFFFF";  // Dark Purple
const char* AVATAR_URL = "https://icons.iconarchive.com/icons/papirus-team/papirus-apps/128/pingus-icon-icon.png";               // Optional avatar URL

// ============================================
// PIN DEFINITIONS
// ============================================

#define BTN_UP    32
#define BTN_DOWN  33
#define BTN_LEFT  25
#define BTN_RIGHT 26
#define BTN_FIRE  27

#define LED_BUILTIN 2  // Built-in LED for status

// ============================================
// GLOBAL VARIABLES
// ============================================

WebSocketsClient webSocket;

// Button states
bool btnUp = false;
bool btnDown = false;
bool btnLeft = false;
bool btnRight = false;
bool btnFire = false;

// Previous button states (for edge detection)
bool prevBtnUp = false;
bool prevBtnDown = false;
bool prevBtnLeft = false;
bool prevBtnRight = false;
bool prevBtnFire = false;

// Connection state
bool isConnected = false;
String playerId = "";

// Game stats
int health = 100;
int maxHealth = 100;
int score = 0;
int kills = 0;
int deaths = 0;
bool spawnProtection = false;

// Timing
unsigned long lastButtonCheck = 0;
const int BUTTON_CHECK_INTERVAL = 20;    // ms

// Debounce
unsigned long lastDebounceTime[5] = {0, 0, 0, 0, 0};
const int DEBOUNCE_DELAY = 50; // ms

// ============================================
// SETUP
// ============================================

void setup() {
    Serial.begin(115200);
    Serial.println("\n\n=== Tank 1990 ESP32 Controller ===\n");

    // Initialize pins
    pinMode(BTN_UP, INPUT_PULLUP);
    pinMode(BTN_DOWN, INPUT_PULLUP);
    pinMode(BTN_LEFT, INPUT_PULLUP);
    pinMode(BTN_RIGHT, INPUT_PULLUP);
    pinMode(BTN_FIRE, INPUT_PULLUP);
    pinMode(LED_BUILTIN, OUTPUT);

    // Status LED off initially
    digitalWrite(LED_BUILTIN, LOW);

    // Connect to WiFi
    connectWiFi();

    // Connect to game server
    connectWebSocket();
}

// ============================================
// MAIN LOOP
// ============================================

void loop() {
    // Handle WebSocket events
    webSocket.loop();

    unsigned long currentTime = millis();

    // Check buttons at regular intervals
    if (currentTime - lastButtonCheck >= BUTTON_CHECK_INTERVAL) {
        lastButtonCheck = currentTime;
        checkButtons();
    }

    // Blink LED when connected
    if (isConnected) {
        digitalWrite(LED_BUILTIN, (millis() / 500) % 2);
    } else {
        digitalWrite(LED_BUILTIN, (millis() / 100) % 2); // Fast blink when disconnected
    }
}

// ============================================
// WIFI CONNECTION
// ============================================

void connectWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected!");
        Serial.print("IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\nWiFi connection failed!");
        delay(3000);
        ESP.restart();
    }
}

// ============================================
// WEBSOCKET CONNECTION
// ============================================

void connectWebSocket() {
    Serial.print("Connecting to game server: ");
    Serial.print(SERVER_HOST);
    Serial.print(":");
    Serial.println(SERVER_PORT);

    webSocket.begin(SERVER_HOST, SERVER_PORT, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected!");
            isConnected = false;
            playerId = "";
            break;

        case WStype_CONNECTED:
            Serial.println("[WS] Connected to server!");
            sendJoinMessage();
            break;

        case WStype_TEXT:
            handleServerMessage((char*)payload);
            break;

        case WStype_ERROR:
            Serial.println("[WS] Error!");
            break;

        case WStype_PING:
        case WStype_PONG:
            break;
    }
}

void sendJoinMessage() {
    StaticJsonDocument<256> doc;
    doc["type"] = "esp32Join";  // Use esp32Join for ESP32 devices
    doc["name"] = TANK_NAME;
    doc["primaryColor"] = PRIMARY_COLOR;
    doc["secondaryColor"] = SECONDARY_COLOR;
    doc["avatarUrl"] = AVATAR_URL;

    String message;
    serializeJson(doc, message);
    webSocket.sendTXT(message);

    Serial.println("[WS] Sent esp32Join message");
}

void handleServerMessage(char* payload) {
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        Serial.print("[JSON] Parse error: ");
        Serial.println(error.c_str());
        return;
    }

    const char* type = doc["type"];

    if (strcmp(type, "joined") == 0) {
        isConnected = true;
        playerId = doc["playerId"].as<String>();
        Serial.print("[GAME] Joined! Player ID: ");
        Serial.println(playerId);
    }
    else if (strcmp(type, "gameState") == 0) {
        // Find our tank in the game state
        JsonArray tanks = doc["tanks"];
        for (JsonObject tank : tanks) {
            if (tank["id"].as<String>() == playerId) {
                health = tank["hp"];
                maxHealth = tank["maxHp"];
                score = tank["score"];
                kills = tank["kills"];
                deaths = tank["deaths"];
                spawnProtection = tank["spawnProtection"];
                break;
            }
        }
    }
    else if (strcmp(type, "tankDeath") == 0) {
        if (doc["tankId"].as<String>() == playerId) {
            Serial.println("[GAME] You were destroyed!");
        }
    }
    else if (strcmp(type, "powerupCollect") == 0) {
        if (doc["tankId"].as<String>() == playerId) {
            const char* powerupType = doc["powerupType"];
            Serial.print("[GAME] Collected powerup: ");
            Serial.println(powerupType);
        }
    }
    else if (strcmp(type, "kicked") == 0) {
        Serial.println("[GAME] You have been kicked!");
        isConnected = false;
    }
    else if (strcmp(type, "banned") == 0) {
        Serial.println("[GAME] You have been banned!");
        isConnected = false;
    }
}

// ============================================
// BUTTON HANDLING
// ============================================

void checkButtons() {
    unsigned long currentTime = millis();

    // Read button states (active LOW)
    bool newUp = !digitalRead(BTN_UP);
    bool newDown = !digitalRead(BTN_DOWN);
    bool newLeft = !digitalRead(BTN_LEFT);
    bool newRight = !digitalRead(BTN_RIGHT);
    bool newFire = !digitalRead(BTN_FIRE);

    // Debounce
    if (newUp != btnUp && (currentTime - lastDebounceTime[0] > DEBOUNCE_DELAY)) {
        lastDebounceTime[0] = currentTime;
        btnUp = newUp;
    }
    if (newDown != btnDown && (currentTime - lastDebounceTime[1] > DEBOUNCE_DELAY)) {
        lastDebounceTime[1] = currentTime;
        btnDown = newDown;
    }
    if (newLeft != btnLeft && (currentTime - lastDebounceTime[2] > DEBOUNCE_DELAY)) {
        lastDebounceTime[2] = currentTime;
        btnLeft = newLeft;
    }
    if (newRight != btnRight && (currentTime - lastDebounceTime[3] > DEBOUNCE_DELAY)) {
        lastDebounceTime[3] = currentTime;
        btnRight = newRight;
    }
    if (newFire != btnFire && (currentTime - lastDebounceTime[4] > DEBOUNCE_DELAY)) {
        lastDebounceTime[4] = currentTime;
        btnFire = newFire;
    }

    // Check for state changes
    bool movementChanged = (btnUp != prevBtnUp) || (btnDown != prevBtnDown) ||
                           (btnLeft != prevBtnLeft) || (btnRight != prevBtnRight);

    bool firePressed = (btnFire && !prevBtnFire);

    // Send movement update if changed
    if (movementChanged && isConnected) {
        sendMovement();
    }

    // Send fire command on button press
    if (firePressed && isConnected) {
        sendFire();
    }

    // Update previous states
    prevBtnUp = btnUp;
    prevBtnDown = btnDown;
    prevBtnLeft = btnLeft;
    prevBtnRight = btnRight;
    prevBtnFire = btnFire;
}

void sendMovement() {
    StaticJsonDocument<128> doc;
    doc["type"] = "move";

    JsonObject moving = doc.createNestedObject("moving");
    moving["up"] = btnUp;
    moving["down"] = btnDown;
    moving["left"] = btnLeft;
    moving["right"] = btnRight;

    String message;
    serializeJson(doc, message);
    webSocket.sendTXT(message);

    Serial.print("[SEND] Move: ");
    if (btnUp) Serial.print("UP ");
    if (btnDown) Serial.print("DOWN ");
    if (btnLeft) Serial.print("LEFT ");
    if (btnRight) Serial.print("RIGHT ");
    Serial.println();
}

void sendFire() {
    StaticJsonDocument<64> doc;
    doc["type"] = "fire";

    String message;
    serializeJson(doc, message);
    webSocket.sendTXT(message);

    Serial.println("[SEND] FIRE!");
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Auto-reconnect to WiFi if disconnected
void checkWiFiConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] Connection lost, reconnecting...");
        connectWiFi();
        connectWebSocket();
    }
}
