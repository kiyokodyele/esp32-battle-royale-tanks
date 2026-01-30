const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game configuration
const CONFIG = {
    MAP_WIDTH: 2000,
    MAP_HEIGHT: 1200,
    TANK_SIZE: 70,
    BULLET_SPEED: 8,
    BULLET_SIZE: 8,
    BASE_TANK_SPEED: 3,
    BASE_FIRE_RATE: 500,
    BASE_DAMAGE: 25,
    BASE_HEALTH: 100,
    BASE_FIRE_RANGE: 500,
    SPAWN_PROTECTION_TIME: 5000,
    OBSTACLE_SPAWN_INTERVAL: 5000,
    POWERUP_SPAWN_INTERVAL: 8000,
    MAX_OBSTACLES: 30,
    MAX_POWERUPS: 5,
    ADMIN_PASSWORD: 'TankDestroyer',
    BOT_REACTION_TIME: 2000,
    TICK_RATE: 60,
    HEARTBEAT_INTERVAL: 5000,  // Ping every 5 seconds
    HEARTBEAT_TIMEOUT: 15000   // Disconnect if no pong for 15 seconds
};

// Game state
let gameState = {
    tanks: new Map(),
    bullets: [],
    obstacles: [],
    powerups: [],
    scoreboard: [],
    bannedIPs: new Set(),
    bots: new Map()
};

// Obstacle types
const OBSTACLE_TYPES = {
    TREE: { hp: 30, destructible: true, color: '#228B22', points: 5 },
    WALL: { hp: 150, destructible: true, color: '#808080', points: 10 },
    BARREL: { hp: 20, destructible: true, color: '#8B4513', explosive: true, explosionRadius: 150, explosionDamage: 100, points: 5 },
    CRATE: { hp: 40, destructible: true, color: '#DEB887', containsPowerup: true, points: 5 }
};

// Powerup types configuration
// duration: seconds before expiry (0 = never expires)
// maxStacks: maximum times this powerup can stack (1 = no stacking)
// multiplier: effect multiplier per stack
const POWERUP_TYPES = {
    SPEED: { color: '#00FFFF', effect: 'speed', multiplier: 1.3, icon: '⚡', duration: 0, maxStacks: 3 },
    POWER: { color: '#FF0000', effect: 'damage', multiplier: 1.5, icon: '💪', duration: 0, maxStacks: 3 },
    HEALTH: { color: '#00FF00', effect: 'health', amount: 50, icon: '❤️', duration: 0, maxStacks: 1 },
    RANGE: { color: '#FFFF00', effect: 'range', multiplier: 1.3, icon: '🎯', duration: 0, maxStacks: 3 },
    INVINCIBILITY: { color: '#FFD700', effect: 'invincible', icon: '⭐', duration: 10, maxStacks: 1 },
    MYSTERY: { color: '#da892dff', effect: 'mystery', icon: '❓', duration: 0, maxStacks: 1, explodeChance: 0.50, explosionRadius: 120, explosionDamage: 80 }
};

// Helper functions
function randomPosition() {
    return {
        x: Math.random() * (CONFIG.MAP_WIDTH - 100) + 50,
        y: Math.random() * (CONFIG.MAP_HEIGHT - 100) + 50
    };
}

// Parse hex color to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Calculate color brightness (0-255)
function getColorBrightness(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    // Using perceived brightness formula
    return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
}

// Generate random bright color
function randomBrightColor() {
    const brightColors = [
        '#FF5722', '#E91E63', '#9C27B0', '#673AB7',
        '#3F51B5', '#2196F3', '#00BCD4', '#009688',
        '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B',
        '#FFC107', '#FF9800', '#FF5722', '#F44336'
    ];
    return brightColors[Math.floor(Math.random() * brightColors.length)];
}

// Validate tank color - reject dark colors that camouflage with background
function validateTankColor(color) {
    if (!color || typeof color !== 'string') return randomBrightColor();

    const brightness = getColorBrightness(color);
    // Background is ~26 brightness (#1a1a1a), reject colors below 60 brightness
    if (brightness < 60) {
        return randomBrightColor();
    }
    return color;
}

// Sanitize tank name - trim and limit to 20 characters
function sanitizeTankName(name) {
    if (!name || typeof name !== 'string') return 'Unknown';
    return name.trim().substring(0, 20) || 'Unknown';
}

function distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function checkCollision(obj1, obj2, size1, size2) {
    return distance(obj1, obj2) < (size1 + size2) / 2;
}

function findSafeSpawnPosition() {
    let attempts = 0;
    let pos;
    do {
        pos = randomPosition();
        attempts++;
        const isSafe = ![...gameState.tanks.values()].some(t =>
            distance(pos, t) < CONFIG.TANK_SIZE * 3
        ) && !gameState.obstacles.some(o =>
            distance(pos, o) < CONFIG.TANK_SIZE * 2
        );
        if (isSafe) return pos;
    } while (attempts < 50);
    return pos;
}

// Tank class
class Tank {
    constructor(id, name, primaryColor, secondaryColor, avatarUrl, isBot = false) {
        const spawnPos = findSafeSpawnPosition();
        this.id = id;
        this.name = sanitizeTankName(name);
        this.primaryColor = validateTankColor(primaryColor) || '#4CAF50';
        this.secondaryColor = validateTankColor(secondaryColor) || '#2E7D32';
        this.avatarUrl = avatarUrl || '';
        this.x = spawnPos.x;
        this.y = spawnPos.y;
        this.angle = Math.random() * Math.PI * 2;
        this.hp = CONFIG.BASE_HEALTH;
        this.maxHp = CONFIG.BASE_HEALTH;
        this.speed = CONFIG.BASE_TANK_SPEED;
        this.damage = CONFIG.BASE_DAMAGE;
        this.fireRange = CONFIG.BASE_FIRE_RANGE;
        this.fireRate = CONFIG.BASE_FIRE_RATE;
        this.lastFire = 0;
        this.score = 0;
        this.kills = 0;
        this.deaths = 0;
        this.isBot = isBot;
        this.spawnProtection = true;
        this.invincible = false;
        this.powerups = {};
        this.moving = { up: false, down: false, left: false, right: false };

        setTimeout(() => {
            this.spawnProtection = false;
        }, CONFIG.SPAWN_PROTECTION_TIME);
    }

    applyPowerup(type) {
        const powerup = POWERUP_TYPES[type];
        if (!powerup) return;

        // Health is instant, no stacking
        if (type === 'HEALTH') {
            this.hp = Math.min(this.maxHp, this.hp + powerup.amount);
            return;
        }

        const now = Date.now();
        const durationMs = powerup.duration * 1000; // Convert seconds to ms
        const expiresAt = durationMs > 0 ? now + durationMs : 0; // 0 = never expires

        // Initialize or update powerup stack
        if (!this.powerups[type] || (this.powerups[type].expiresAt > 0 && now >= this.powerups[type].expiresAt)) {
            // New powerup or expired - start fresh
            this.powerups[type] = { stacks: 1, expiresAt: expiresAt };
        } else if (this.powerups[type].stacks < powerup.maxStacks) {
            // Add stack if under max
            this.powerups[type].stacks++;
            // Refresh duration
            if (durationMs > 0) {
                this.powerups[type].expiresAt = expiresAt;
            }
        } else {
            // At max stacks, just refresh duration
            if (durationMs > 0) {
                this.powerups[type].expiresAt = expiresAt;
            }
        }

        // Handle invincibility specially
        if (type === 'INVINCIBILITY') {
            this.invincible = true;
            this.invincibilityEnd = expiresAt;

            if (durationMs > 0) {
                setTimeout(() => {
                    // Check if still the same invincibility period
                    if (this.invincibilityEnd === expiresAt) {
                        this.invincible = false;
                        delete this.powerups[type];
                    }
                }, durationMs);
            }
        }
    }

    getEffectiveStats() {
        let speed = CONFIG.BASE_TANK_SPEED;
        let damage = CONFIG.BASE_DAMAGE;
        let range = CONFIG.BASE_FIRE_RANGE;

        const now = Date.now();

        // Apply SPEED powerup with stacking
        const speedPowerup = this.powerups.SPEED;
        if (speedPowerup && (speedPowerup.expiresAt === 0 || now < speedPowerup.expiresAt)) {
            // Apply multiplier for each stack
            for (let i = 0; i < speedPowerup.stacks; i++) {
                speed *= POWERUP_TYPES.SPEED.multiplier;
            }
        } else if (speedPowerup) {
            delete this.powerups.SPEED; // Cleanup expired
        }

        // Apply POWER powerup with stacking
        const powerPowerup = this.powerups.POWER;
        if (powerPowerup && (powerPowerup.expiresAt === 0 || now < powerPowerup.expiresAt)) {
            for (let i = 0; i < powerPowerup.stacks; i++) {
                damage *= POWERUP_TYPES.POWER.multiplier;
            }
        } else if (powerPowerup) {
            delete this.powerups.POWER;
        }

        // Apply RANGE powerup with stacking
        const rangePowerup = this.powerups.RANGE;
        if (rangePowerup && (rangePowerup.expiresAt === 0 || now < rangePowerup.expiresAt)) {
            for (let i = 0; i < rangePowerup.stacks; i++) {
                range *= POWERUP_TYPES.RANGE.multiplier;
            }
        } else if (rangePowerup) {
            delete this.powerups.RANGE;
        }

        return { speed, damage, range };
    }

    resetPowerups() {
        this.powerups = {};
        this.speed = CONFIG.BASE_TANK_SPEED;
        this.damage = CONFIG.BASE_DAMAGE;
        this.fireRange = CONFIG.BASE_FIRE_RANGE;
        this.invincible = false;
    }

    respawn() {
        const spawnPos = findSafeSpawnPosition();
        this.x = spawnPos.x;
        this.y = spawnPos.y;
        this.hp = CONFIG.BASE_HEALTH;
        this.angle = Math.random() * Math.PI * 2;
        this.resetPowerups();
        this.spawnProtection = true;
        this.deaths++;

        setTimeout(() => {
            this.spawnProtection = false;
        }, CONFIG.SPAWN_PROTECTION_TIME);
    }

    toJSON() {
        const now = Date.now();
        // Build active powerups with stack info
        const activePowerups = {};
        for (const [type, data] of Object.entries(this.powerups)) {
            if (data.expiresAt === 0 || now < data.expiresAt) {
                activePowerups[type] = {
                    stacks: data.stacks,
                    expiresAt: data.expiresAt,
                    maxStacks: POWERUP_TYPES[type]?.maxStacks || 1
                };
            }
        }

        return {
            id: this.id,
            name: this.name,
            primaryColor: this.primaryColor,
            secondaryColor: this.secondaryColor,
            avatarUrl: this.avatarUrl,
            x: this.x,
            y: this.y,
            angle: this.angle,
            hp: this.hp,
            maxHp: this.maxHp,
            score: this.score,
            kills: this.kills,
            deaths: this.deaths,
            isBot: this.isBot,
            spawnProtection: this.spawnProtection,
            invincible: this.invincible,
            invincibilityEnd: this.invincibilityEnd || 0,
            powerups: activePowerups
        };
    }
}

// Bullet class
class Bullet {
    constructor(ownerId, x, y, angle, damage, range) {
        this.id = uuidv4();
        this.ownerId = ownerId;
        this.x = x;
        this.y = y;
        this.startX = x;
        this.startY = y;
        this.angle = angle;
        this.damage = damage;
        this.range = range;
        this.speed = CONFIG.BULLET_SPEED;
    }

    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
    }

    isOutOfRange() {
        return distance(this, { x: this.startX, y: this.startY }) > this.range;
    }

    isOutOfBounds() {
        return this.x < 0 || this.x > CONFIG.MAP_WIDTH ||
               this.y < 0 || this.y > CONFIG.MAP_HEIGHT;
    }
}

// Obstacle class
class Obstacle {
    constructor(type) {
        const pos = randomPosition();
        this.id = uuidv4();
        this.type = type;
        this.x = pos.x;
        this.y = pos.y;
        this.hp = OBSTACLE_TYPES[type].hp;
        this.maxHp = OBSTACLE_TYPES[type].hp;
        this.size = type === 'WALL' ? 60 : 40;
        this.config = OBSTACLE_TYPES[type];
    }

    takeDamage(damage) {
        this.hp -= damage;
        return this.hp <= 0;
    }
}

// Powerup class
class Powerup {
    constructor(type, x, y) {
        this.id = uuidv4();
        this.type = type;
        this.x = x || randomPosition().x;
        this.y = y || randomPosition().y;
        this.config = POWERUP_TYPES[type];
        this.size = 25;
    }
}

// Bot AI
class BotAI {
    constructor(tank) {
        this.tank = tank;
        this.targetId = null;
        this.lastDecision = 0;
        this.state = 'roaming';
    }

    update() {
        const now = Date.now();
        if (now - this.lastDecision < CONFIG.BOT_REACTION_TIME) return;
        this.lastDecision = now;

        // Find nearest player tank
        let nearestPlayer = null;
        let nearestDist = Infinity;

        gameState.tanks.forEach((tank, id) => {
            if (tank.isBot || id === this.tank.id) return;
            const dist = distance(this.tank, tank);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlayer = tank;
            }
        });

        if (nearestPlayer && nearestDist < 400) {
            // Attack mode
            this.state = 'attacking';
            const angleToPlayer = Math.atan2(
                nearestPlayer.y - this.tank.y,
                nearestPlayer.x - this.tank.x
            );
            this.tank.angle = angleToPlayer;

            if (nearestDist > 150) {
                // Move towards player
                this.tank.moving = { up: true, down: false, left: false, right: false };
            } else {
                this.tank.moving = { up: false, down: false, left: false, right: false };
            }

            // Fire at player
            if (nearestDist < this.tank.fireRange) {
                fireBullet(this.tank);
            }
        } else {
            // Roaming mode
            this.state = 'roaming';
            if (Math.random() < 0.1) {
                this.tank.angle += (Math.random() - 0.5) * 0.5;
            }
            this.tank.moving = { up: Math.random() > 0.3, down: false, left: false, right: false };

            // Occasionally fire
            if (Math.random() < 0.05) {
                fireBullet(this.tank);
            }
        }

        // Avoid obstacles
        gameState.obstacles.forEach(obs => {
            if (distance(this.tank, obs) < 80) {
                this.tank.angle += Math.PI / 4;
            }
        });

        // Avoid map edges
        if (this.tank.x < 100) this.tank.angle = 0;
        if (this.tank.x > CONFIG.MAP_WIDTH - 100) this.tank.angle = Math.PI;
        if (this.tank.y < 100) this.tank.angle = Math.PI / 2;
        if (this.tank.y > CONFIG.MAP_HEIGHT - 100) this.tank.angle = -Math.PI / 2;
    }
}

// Fire bullet function
function fireBullet(tank) {
    const now = Date.now();
    if (now - tank.lastFire < tank.fireRate) return null;

    tank.lastFire = now;
    const stats = tank.getEffectiveStats();

    const bullet = new Bullet(
        tank.id,
        tank.x + Math.cos(tank.angle) * (CONFIG.TANK_SIZE / 2 + 5),
        tank.y + Math.sin(tank.angle) * (CONFIG.TANK_SIZE / 2 + 5),
        tank.angle,
        stats.damage,
        stats.range
    );

    gameState.bullets.push(bullet);
    return bullet;
}

// Spawn obstacle
function spawnObstacle() {
    if (gameState.obstacles.length >= CONFIG.MAX_OBSTACLES) return;

    const types = Object.keys(OBSTACLE_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const obstacle = new Obstacle(type);

    // Check for collision with tanks
    const collides = [...gameState.tanks.values()].some(t =>
        distance(obstacle, t) < CONFIG.TANK_SIZE * 2
    );

    if (!collides) {
        gameState.obstacles.push(obstacle);
        broadcast({ type: 'obstacleSpawn', obstacle });
    }
}

// Spawn powerup
function spawnPowerup(x, y) {
    if (gameState.powerups.length >= CONFIG.MAX_POWERUPS) return;

    const types = Object.keys(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const powerup = new Powerup(type, x, y);

    gameState.powerups.push(powerup);
    broadcast({ type: 'powerupSpawn', powerup });
}

// Explosion effect
function createExplosion(x, y, radius, damage) {
    gameState.tanks.forEach((tank) => {
        if (tank.spawnProtection || tank.invincible) return;

        const dist = distance({ x, y }, tank);
        if (dist < radius) {
            const actualDamage = damage * (1 - dist / radius);
            tank.hp -= actualDamage;

            if (tank.hp <= 0) {
                tank.respawn();
                broadcast({ type: 'tankDeath', tankId: tank.id, killer: null });
            }
        }
    });

    broadcast({ type: 'explosion', x, y, radius });
}

// Update game state
function updateGame() {
    // Update tanks
    gameState.tanks.forEach((tank) => {
        const stats = tank.getEffectiveStats();

        let dx = 0, dy = 0;
        if (tank.moving.up) {
            dx += Math.cos(tank.angle) * stats.speed;
            dy += Math.sin(tank.angle) * stats.speed;
        }
        if (tank.moving.down) {
            dx -= Math.cos(tank.angle) * stats.speed;
            dy -= Math.sin(tank.angle) * stats.speed;
        }
        if (tank.moving.left) {
            tank.angle -= 0.05;
        }
        if (tank.moving.right) {
            tank.angle += 0.05;
        }

        // Check wall collisions
        const newX = Math.max(CONFIG.TANK_SIZE / 2, Math.min(CONFIG.MAP_WIDTH - CONFIG.TANK_SIZE / 2, tank.x + dx));
        const newY = Math.max(CONFIG.TANK_SIZE / 2, Math.min(CONFIG.MAP_HEIGHT - CONFIG.TANK_SIZE / 2, tank.y + dy));

        // Check obstacle collisions
        let canMove = true;
        let barrelToExplode = null;
        gameState.obstacles.forEach(obs => {
            if (distance({ x: newX, y: newY }, obs) < (CONFIG.TANK_SIZE + obs.size) / 2) {
                if (obs.type === 'BARREL') {
                    barrelToExplode = obs;
                } else {
                    canMove = false;
                }
            }
        });

        // Handle barrel collision - tank bumps into it and it explodes
        if (barrelToExplode) {
            const obsIndex = gameState.obstacles.indexOf(barrelToExplode);
            if (obsIndex > -1) {
                gameState.obstacles.splice(obsIndex, 1);
                const posBeforeExplosion = { x: tank.x, y: tank.y };
                createExplosion(barrelToExplode.x, barrelToExplode.y, barrelToExplode.config.explosionRadius, barrelToExplode.config.explosionDamage);
                broadcast({ type: 'obstacleDestroyed', obstacleId: barrelToExplode.id });
                // If tank died and respawned, don't overwrite its new position
                if (tank.x !== posBeforeExplosion.x || tank.y !== posBeforeExplosion.y) {
                    return; // Tank respawned to new location, skip position update
                }
            }
        }

        if (canMove) {
            tank.x = newX;
            tank.y = newY;
        }

        // Check powerup collisions
        gameState.powerups = gameState.powerups.filter(powerup => {
            if (distance(tank, powerup) < (CONFIG.TANK_SIZE + powerup.size) / 2) {
                // Handle MYSTERY powerup specially
                if (powerup.type === 'MYSTERY') {
                    const mysteryConfig = POWERUP_TYPES.MYSTERY;
                    if (Math.random() < mysteryConfig.explodeChance) {
                        // Bad luck - it explodes!
                        broadcast({ type: 'mysteryExplode', tankId: tank.id, x: powerup.x, y: powerup.y, radius: mysteryConfig.explosionRadius });
                        createExplosion(powerup.x, powerup.y, mysteryConfig.explosionRadius, mysteryConfig.explosionDamage);
                    } else {
                        // Good luck - give a random real powerup
                        const realPowerups = ['SPEED', 'POWER', 'HEALTH', 'RANGE', 'INVINCIBILITY'];
                        const randomType = realPowerups[Math.floor(Math.random() * realPowerups.length)];
                        tank.applyPowerup(randomType);
                        broadcast({ type: 'powerupCollect', tankId: tank.id, powerupType: randomType, x: powerup.x, y: powerup.y, wasMystery: true });
                    }
                } else {
                    tank.applyPowerup(powerup.type);
                    broadcast({ type: 'powerupCollect', tankId: tank.id, powerupType: powerup.type, x: powerup.x, y: powerup.y });
                }
                return false;
            }
            return true;
        });
    });

    // Update bullets
    gameState.bullets = gameState.bullets.filter(bullet => {
        bullet.update();

        if (bullet.isOutOfBounds() || bullet.isOutOfRange()) {
            return false;
        }

        // Check tank collisions
        let hitTank = false;
        gameState.tanks.forEach((tank, tankId) => {
            if (tankId === bullet.ownerId) return;
            if (tank.spawnProtection || tank.invincible) return;

            if (checkCollision(bullet, tank, CONFIG.BULLET_SIZE, CONFIG.TANK_SIZE)) {
                tank.hp -= bullet.damage;
                hitTank = true;

                if (tank.hp <= 0) {
                    const attacker = gameState.tanks.get(bullet.ownerId);
                    if (attacker) {
                        const points = tank.isBot ? 50 : 100;
                        attacker.score += points;
                        attacker.kills++;
                        updateScoreboard();
                    }
                    tank.respawn();
                    broadcast({
                        type: 'tankDeath',
                        tankId: tank.id,
                        killerId: bullet.ownerId,
                        wasBot: tank.isBot
                    });
                }
            }
        });

        if (hitTank) return false;

        // Check obstacle collisions
        for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
            const obs = gameState.obstacles[i];
            if (checkCollision(bullet, obs, CONFIG.BULLET_SIZE, obs.size)) {
                const destroyed = obs.takeDamage(bullet.damage);

                if (destroyed) {
                    // Award points to shooter
                    const attacker = gameState.tanks.get(bullet.ownerId);
                    if (attacker) {
                        attacker.score += obs.config.points;
                        updateScoreboard();
                    }

                    if (obs.config.explosive) {
                        createExplosion(obs.x, obs.y, obs.config.explosionRadius, obs.config.explosionDamage);
                    }

                    if (obs.config.containsPowerup) {
                        if (Math.random() < 0.7) {
                            spawnPowerup(obs.x, obs.y);
                        } else {
                            // Spawn bomb (explosion)
                            createExplosion(obs.x, obs.y, 60, 30);
                        }
                    }

                    gameState.obstacles.splice(i, 1);
                    broadcast({ type: 'obstacleDestroyed', obstacleId: obs.id });
                }

                return false;
            }
        }

        return true;
    });

    // Update bot AI
    gameState.bots.forEach(bot => bot.update());
}

// Update scoreboard
function updateScoreboard() {
    gameState.scoreboard = [...gameState.tanks.values()]
        .map(t => ({
            id: t.id,
            name: t.name,
            score: t.score,
            kills: t.kills,
            deaths: t.deaths,
            isBot: t.isBot
        }))
        .sort((a, b) => b.score - a.score);

    broadcast({ type: 'scoreboardUpdate', scoreboard: gameState.scoreboard });
}

// Broadcast to all clients (except ESP32 controllers which only send commands)
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && !client.isESP32) {
            client.send(message);
        }
    });
}

// Send to specific client
function sendTo(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;

    // Check if banned
    if (gameState.bannedIPs.has(clientIP)) {
        sendTo(ws, { type: 'banned' });
        ws.close();
        return;
    }

    // Heartbeat tracking
    ws.isAlive = true;
    ws.lastPong = Date.now();

    ws.on('pong', () => {
        ws.isAlive = true;
        ws.lastPong = Date.now();
    });

    let playerId = null;
    let isAdmin = false;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'spectate': {
                    // Spectator mode - view only, no tank created
                    ws.isSpectator = true;
                    sendTo(ws, {
                        type: 'spectateJoined',
                        config: CONFIG,
                        gameState: {
                            tanks: [...gameState.tanks.values()].map(t => t.toJSON()),
                            bullets: gameState.bullets,
                            obstacles: gameState.obstacles,
                            powerups: gameState.powerups,
                            scoreboard: gameState.scoreboard
                        }
                    });
                    break;
                }

                case 'join': {
                    // Regular join is disabled - players must use ESP32 or simulator
                    // This is now spectator-only from the main page
                    sendTo(ws, { type: 'error', message: 'Direct join disabled. Use ESP32 controller or simulator.' });
                    break;
                }

                case 'move': {
                    const tank = gameState.tanks.get(playerId);
                    if (tank) {
                        tank.moving = data.moving;
                    }
                    break;
                }

                case 'rotate': {
                    const tank = gameState.tanks.get(playerId);
                    if (tank) {
                        tank.angle = data.angle;
                    }
                    break;
                }

                case 'fire': {
                    const tank = gameState.tanks.get(playerId);
                    if (tank) {
                        const bullet = fireBullet(tank);
                        if (bullet) {
                            broadcast({ type: 'bulletFired', bullet, ownerId: playerId });
                        }
                    }
                    break;
                }

                case 'adminLogin': {
                    if (data.password === CONFIG.ADMIN_PASSWORD) {
                        isAdmin = true;
                        sendTo(ws, { type: 'adminLoginSuccess' });
                    } else {
                        sendTo(ws, { type: 'adminLoginFailed' });
                    }
                    break;
                }

                case 'adminKick': {
                    if (!isAdmin) return;
                    const targetTank = gameState.tanks.get(data.targetId);
                    if (targetTank && !targetTank.isBot) {
                        wss.clients.forEach(client => {
                            if (client.playerId === data.targetId) {
                                sendTo(client, { type: 'kicked' });
                                client.close();
                            }
                        });
                    }
                    break;
                }

                case 'adminBan': {
                    if (!isAdmin) return;
                    wss.clients.forEach(client => {
                        if (client.playerId === data.targetId) {
                            gameState.bannedIPs.add(client.clientIP);
                            sendTo(client, { type: 'banned' });
                            client.close();
                        }
                    });
                    break;
                }

                case 'adminSpawnBot': {
                    if (!isAdmin) return;
                    const botId = uuidv4();
                    const botTank = new Tank(
                        botId,
                        `Bot_${Math.floor(Math.random() * 1000)}`,
                        data.primaryColor || '#FF5722',
                        data.secondaryColor || '#E64A19',
                        '',
                        true
                    );
                    gameState.tanks.set(botId, botTank);
                    gameState.bots.set(botId, new BotAI(botTank));
                    broadcast({ type: 'playerJoined', tank: botTank.toJSON() });
                    updateScoreboard();
                    break;
                }

                case 'adminRemoveBot': {
                    if (!isAdmin) return;
                    const botTank = gameState.tanks.get(data.botId);
                    if (botTank && botTank.isBot) {
                        gameState.tanks.delete(data.botId);
                        gameState.bots.delete(data.botId);
                        broadcast({ type: 'playerLeft', playerId: data.botId });
                        updateScoreboard();
                    }
                    break;
                }

                case 'adminResetScoreboard': {
                    if (!isAdmin) return;
                    gameState.tanks.forEach(tank => {
                        tank.score = 0;
                        tank.kills = 0;
                        tank.deaths = 0;
                    });
                    updateScoreboard();
                    broadcast({ type: 'scoreboardReset' });
                    break;
                }

                case 'adminGetPlayers': {
                    if (!isAdmin) return;
                    sendTo(ws, {
                        type: 'playerList',
                        players: [...gameState.tanks.values()].map(t => ({
                            id: t.id,
                            name: t.name,
                            isBot: t.isBot,
                            score: t.score
                        }))
                    });
                    break;
                }

                case 'simulatorJoin': {
                    // Simulator join requires admin password verification
                    if (data.adminPassword !== CONFIG.ADMIN_PASSWORD) {
                        sendTo(ws, { type: 'error', message: 'Invalid admin password for simulator' });
                        return;
                    }

                    // Use deviceId if provided, otherwise use name as identifier
                    const simDeviceId = data.deviceId || sanitizeTankName(data.name);

                    // Check if this simulator already has a tank (reconnecting player)
                    let existingSimTank = null;
                    let existingSimId = null;
                    for (const [id, tank] of gameState.tanks.entries()) {
                        if (tank.deviceId === simDeviceId && !tank.isBot) {
                            existingSimTank = tank;
                            existingSimId = id;
                            break;
                        }
                    }

                    if (existingSimTank) {
                        // Reconnect to existing tank
                        playerId = existingSimId;
                        existingSimTank.ws = ws; // Update active websocket
                        ws.playerId = playerId;
                        ws.clientIP = clientIP;

                        sendTo(ws, {
                            type: 'joined',
                            playerId,
                            tank: existingSimTank.toJSON(),
                            config: CONFIG,
                            gameState: {
                                tanks: [...gameState.tanks.values()].map(t => t.toJSON()),
                                bullets: gameState.bullets,
                                obstacles: gameState.obstacles,
                                powerups: gameState.powerups,
                                scoreboard: gameState.scoreboard
                            }
                        });

                        console.log(`Simulator reconnected: ${existingSimTank.name}`);
                    } else {
                        // New simulator - create new tank
                        playerId = uuidv4();
                        const simTank = new Tank(
                            playerId,
                            data.name,
                            data.primaryColor,
                            data.secondaryColor,
                            data.avatarUrl
                        );
                        simTank.deviceId = simDeviceId; // Store device identifier
                        simTank.ws = ws; // Store active websocket
                        gameState.tanks.set(playerId, simTank);
                        ws.playerId = playerId;
                        ws.clientIP = clientIP;

                        sendTo(ws, {
                            type: 'joined',
                            playerId,
                            tank: simTank.toJSON(),
                            config: CONFIG,
                            gameState: {
                                tanks: [...gameState.tanks.values()].map(t => t.toJSON()),
                                bullets: gameState.bullets,
                                obstacles: gameState.obstacles,
                                powerups: gameState.powerups,
                                scoreboard: gameState.scoreboard
                            }
                        });

                        broadcast({ type: 'playerJoined', tank: simTank.toJSON() });
                        updateScoreboard();
                        console.log(`Simulator joined: ${data.name}`);
                    }
                    break;
                }

                case 'esp32Join': {
                    // ESP32 devices can join directly with their fixed config
                    // They only send commands and don't need game state feedback

                    // Use deviceId if provided, otherwise use name as identifier
                    const deviceId = data.deviceId || sanitizeTankName(data.name);

                    // Check if this device already has a tank (reconnecting player)
                    let existingTank = null;
                    let existingId = null;
                    for (const [id, tank] of gameState.tanks.entries()) {
                        if (tank.deviceId === deviceId && !tank.isBot) {
                            existingTank = tank;
                            existingId = id;
                            break;
                        }
                    }

                    if (existingTank) {
                        // Reconnect to existing tank
                        playerId = existingId;
                        existingTank.ws = ws; // Update active websocket
                        ws.playerId = playerId;
                        ws.clientIP = clientIP;
                        ws.isESP32 = true;

                        // Send minimal response to ESP32
                        sendTo(ws, {
                            type: 'joined',
                            playerId
                        });

                        console.log(`ESP32 device reconnected: ${existingTank.name}`);
                    } else {
                        // New device - create new tank
                        playerId = uuidv4();
                        const espTank = new Tank(
                            playerId,
                            data.name,
                            data.primaryColor,
                            data.secondaryColor,
                            data.avatarUrl
                        );
                        espTank.deviceId = deviceId; // Store device identifier
                        espTank.ws = ws; // Store active websocket
                        gameState.tanks.set(playerId, espTank);
                        ws.playerId = playerId;
                        ws.clientIP = clientIP;
                        ws.isESP32 = true;

                        // Send minimal response to ESP32
                        sendTo(ws, {
                            type: 'joined',
                            playerId
                        });

                        broadcast({ type: 'playerJoined', tank: espTank.toJSON() });
                        updateScoreboard();
                        console.log(`ESP32 device joined: ${data.name}`);
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        if (playerId) {
            const tank = gameState.tanks.get(playerId);
            // Only delete if this websocket is still the active one for the tank
            // (prevents deleting tank when old connection closes after reconnect)
            if (tank && !tank.isBot && tank.ws === ws) {
                gameState.tanks.delete(playerId);
                broadcast({ type: 'playerLeft', playerId });
                updateScoreboard();
                console.log(`Player disconnected and removed: ${tank.name}`);
            }
        }
    });
});

// Game loop
setInterval(updateGame, 1000 / CONFIG.TICK_RATE);

// Broadcast game state periodically
setInterval(() => {
    broadcast({
        type: 'gameState',
        tanks: [...gameState.tanks.values()].map(t => t.toJSON()),
        bullets: gameState.bullets,
        obstacles: gameState.obstacles,
        powerups: gameState.powerups
    });
}, 1000 / 30);

// Spawn obstacles periodically
setInterval(spawnObstacle, CONFIG.OBSTACLE_SPAWN_INTERVAL);

// Spawn powerups periodically
setInterval(() => spawnPowerup(), CONFIG.POWERUP_SPAWN_INTERVAL);

// Heartbeat - detect and remove disconnected clients (unplugged ESP32, etc.)
setInterval(() => {
    const now = Date.now();
    wss.clients.forEach(ws => {
        // Check if client hasn't responded to pings
        if (now - ws.lastPong > CONFIG.HEARTBEAT_TIMEOUT) {
            console.log(`Client timed out (no pong), terminating connection`);
            ws.terminate(); // Force close, triggers 'close' event
            return;
        }

        // Send ping to client
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, CONFIG.HEARTBEAT_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tank 1990 server running on port ${PORT}`);
    console.log(`Game: http://localhost:${PORT}`);
    console.log(`Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin Password: ${CONFIG.ADMIN_PASSWORD}`);
});
