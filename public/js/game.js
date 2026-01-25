class TankGame {
    constructor() {
        this.ws = null;
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.playerId = null;
        this.config = null;
        this.gameState = {
            tanks: [],
            bullets: [],
            obstacles: [],
            powerups: []
        };
        this.keys = {};
        this.explosions = [];
        this.lastFrameTime = 0;

        this.setupEventListeners();
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    setupEventListeners() {
        document.getElementById('join-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.connect();
        });

        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    connect() {
        const name = document.getElementById('tank-name').value;
        const primaryColor = document.getElementById('primary-color').value;
        const secondaryColor = document.getElementById('secondary-color').value;
        const avatarUrl = document.getElementById('avatar-url').value;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}`);

        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({
                type: 'join',
                name,
                primaryColor,
                secondaryColor,
                avatarUrl
            }));
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'joined':
                this.playerId = data.playerId;
                this.config = data.config;
                // Ensure gameState has all required arrays
                this.gameState = {
                    tanks: data.gameState?.tanks || [],
                    bullets: data.gameState?.bullets || [],
                    obstacles: data.gameState?.obstacles || [],
                    powerups: data.gameState?.powerups || []
                };
                console.log('Joined game!', { playerId: this.playerId, tank: data.tank, gameState: this.gameState });
                this.showGameScreen();
                this.updatePlayerHUD(data.tank);
                this.startGameLoop();
                break;

            case 'gameState':
                this.gameState.tanks = data.tanks;
                this.gameState.bullets = data.bullets;
                this.gameState.obstacles = data.obstacles;
                this.gameState.powerups = data.powerups;
                this.updatePlayerHUDFromState();
                break;

            case 'playerJoined':
                this.addKillFeedMessage(`${data.tank.name} joined the battle`, 'powerup');
                break;

            case 'playerLeft':
                const leftTank = this.gameState.tanks.find(t => t.id === data.playerId);
                if (leftTank) {
                    this.addKillFeedMessage(`${leftTank.name} left the battle`, 'powerup');
                }
                break;

            case 'tankDeath':
                const victim = this.gameState.tanks.find(t => t.id === data.tankId);
                const killer = this.gameState.tanks.find(t => t.id === data.killerId);
                if (victim && killer) {
                    this.addKillFeedMessage(`${killer.name} destroyed ${victim.name}`);
                }
                if (data.tankId === this.playerId) {
                    this.showDeathScreen();
                }
                break;

            case 'explosion':
                this.createExplosionEffect(data.x, data.y, data.radius);
                break;

            case 'powerupCollect':
                const collector = this.gameState.tanks.find(t => t.id === data.tankId);
                if (collector) {
                    this.addKillFeedMessage(`${collector.name} got ${data.powerupType}`, 'powerup');
                }
                break;

            case 'scoreboardUpdate':
                this.updateScoreboard(data.scoreboard);
                break;

            case 'scoreboardReset':
                this.addKillFeedMessage('Scoreboard has been reset!', 'powerup');
                break;

            case 'kicked':
                document.getElementById('kicked-screen').classList.remove('hidden');
                break;

            case 'banned':
                document.getElementById('banned-screen').classList.remove('hidden');
                break;
        }
    }

    showGameScreen() {
        document.getElementById('connection-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    }

    showDeathScreen() {
        const deathScreen = document.getElementById('death-screen');
        deathScreen.classList.remove('hidden');
        setTimeout(() => {
            deathScreen.classList.add('hidden');
        }, 2000);
    }

    updatePlayerHUD(tank) {
        if (!tank) return;

        document.getElementById('player-name').textContent = tank.name || 'Unknown';
        document.getElementById('player-score').textContent = `Score: ${tank.score || 0}`;

        const healthFill = document.getElementById('health-fill');
        const hpPercent = tank.maxHp ? (tank.hp / tank.maxHp) * 100 : 100;
        healthFill.style.width = `${hpPercent}%`;

        if (tank.avatarUrl) {
            document.getElementById('player-avatar').style.backgroundImage = `url(${tank.avatarUrl})`;
        }

        this.updatePowerupDisplay(tank.powerups || {});
    }

    updatePlayerHUDFromState() {
        const tank = this.gameState.tanks.find(t => t.id === this.playerId);
        if (tank) {
            this.updatePlayerHUD(tank);
        }
    }

    updatePowerupDisplay(powerups) {
        const container = document.getElementById('powerups-display');
        container.innerHTML = '';

        const powerupIcons = {
            SPEED: { icon: '⚡', color: '#00FFFF' },
            POWER: { icon: '💪', color: '#FF0000' },
            RANGE: { icon: '🎯', color: '#FFFF00' },
            INVINCIBILITY: { icon: '⭐', color: '#FFD700' }
        };

        // Handle both old array format and new object format with stacks
        if (Array.isArray(powerups)) {
            powerups.forEach(p => {
                const info = powerupIcons[p];
                if (info) {
                    const div = document.createElement('div');
                    div.className = 'powerup-indicator';
                    div.style.borderColor = info.color;
                    div.textContent = info.icon;
                    container.appendChild(div);
                }
            });
        } else if (typeof powerups === 'object') {
            for (const [type, data] of Object.entries(powerups)) {
                const info = powerupIcons[type];
                if (info) {
                    const div = document.createElement('div');
                    div.className = 'powerup-indicator';
                    div.style.borderColor = info.color;

                    // Show icon with stack count
                    if (data.stacks > 1) {
                        div.innerHTML = `${info.icon}<span class="stack-count">x${data.stacks}</span>`;
                    } else {
                        div.textContent = info.icon;
                    }
                    container.appendChild(div);
                }
            }
        }
    }

    updateScoreboard(scoreboard) {
        const list = document.getElementById('scoreboard-list');
        list.innerHTML = '';

        scoreboard.forEach((entry, index) => {
            const div = document.createElement('div');
            div.className = 'scoreboard-entry';
            if (entry.id === this.playerId) div.classList.add('current-player');
            if (entry.isBot) div.classList.add('bot');

            div.innerHTML = `
                <span class="scoreboard-rank">#${index + 1}</span>
                <span class="scoreboard-name">${entry.name}${entry.isBot ? ' [BOT]' : ''}</span>
                <span class="scoreboard-score">${entry.score}</span>
            `;
            list.appendChild(div);
        });
    }

    addKillFeedMessage(message, type = '') {
        const feed = document.getElementById('kill-feed');
        const div = document.createElement('div');
        div.className = `kill-message ${type}`;
        div.textContent = message;
        feed.appendChild(div);

        setTimeout(() => {
            div.remove();
        }, 5000);

        while (feed.children.length > 5) {
            feed.removeChild(feed.firstChild);
        }
    }

    createExplosionEffect(x, y, radius) {
        this.explosions.push({
            x, y, radius,
            maxRadius: radius,
            alpha: 1,
            startTime: Date.now()
        });
    }

    startGameLoop() {
        const loop = (timestamp) => {
            const deltaTime = timestamp - this.lastFrameTime;
            this.lastFrameTime = timestamp;

            this.handleInput();
            this.render();
            this.updateExplosions();

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    handleInput() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const moving = {
            up: this.keys['KeyW'] || this.keys['ArrowUp'],
            down: this.keys['KeyS'] || this.keys['ArrowDown'],
            left: this.keys['KeyA'] || this.keys['ArrowLeft'],
            right: this.keys['KeyD'] || this.keys['ArrowRight']
        };

        this.ws.send(JSON.stringify({ type: 'move', moving }));

        if (this.keys['Space']) {
            this.ws.send(JSON.stringify({ type: 'fire' }));
        }
    }

    render() {
        const ctx = this.ctx;
        const config = this.config;

        if (!config) return;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Calculate camera offset (center on player)
        const playerTank = this.gameState.tanks.find(t => t.id === this.playerId);
        let offsetX = 0, offsetY = 0;

        if (playerTank) {
            // Center the camera on the player
            offsetX = this.canvas.width / 2 - playerTank.x;
            offsetY = this.canvas.height / 2 - playerTank.y;

            // Clamp camera to map bounds (don't show past edges)
            // If map is smaller than canvas, center the map
            if (this.canvas.width >= config.MAP_WIDTH) {
                offsetX = (this.canvas.width - config.MAP_WIDTH) / 2;
            } else {
                offsetX = Math.min(0, Math.max(this.canvas.width - config.MAP_WIDTH, offsetX));
            }

            if (this.canvas.height >= config.MAP_HEIGHT) {
                offsetY = (this.canvas.height - config.MAP_HEIGHT) / 2;
            } else {
                offsetY = Math.min(0, Math.max(this.canvas.height - config.MAP_HEIGHT, offsetY));
            }
        } else {
            // No player tank yet, center the map
            offsetX = (this.canvas.width - config.MAP_WIDTH) / 2;
            offsetY = (this.canvas.height - config.MAP_HEIGHT) / 2;
        }

        ctx.save();
        ctx.translate(offsetX, offsetY);

        // Draw map background
        this.drawMap();

        // Draw obstacles
        if (this.gameState.obstacles && Array.isArray(this.gameState.obstacles)) {
            this.gameState.obstacles.forEach(obs => this.drawObstacle(obs));
        }

        // Draw powerups
        if (this.gameState.powerups && Array.isArray(this.gameState.powerups)) {
            this.gameState.powerups.forEach(powerup => this.drawPowerup(powerup));
        }

        // Draw bullets
        if (this.gameState.bullets && Array.isArray(this.gameState.bullets)) {
            this.gameState.bullets.forEach(bullet => this.drawBullet(bullet));
        }

        // Draw tanks
        if (this.gameState.tanks && Array.isArray(this.gameState.tanks)) {
            this.gameState.tanks.forEach(tank => this.drawTank(tank));
        }

        // Draw explosions
        this.explosions.forEach(exp => this.drawExplosion(exp));

        ctx.restore();
    }

    drawMap() {
        const ctx = this.ctx;
        const config = this.config;

        if (!config) return;

        // Draw map background with grid
        ctx.fillStyle = '#2d2d2d';
        ctx.fillRect(0, 0, config.MAP_WIDTH, config.MAP_HEIGHT);

        // Draw grid
        ctx.strokeStyle = '#3a3a3a';
        ctx.lineWidth = 1;
        const gridSize = 50;

        for (let x = 0; x <= config.MAP_WIDTH; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, config.MAP_HEIGHT);
            ctx.stroke();
        }

        for (let y = 0; y <= config.MAP_HEIGHT; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(config.MAP_WIDTH, y);
            ctx.stroke();
        }

        // Draw map border
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, config.MAP_WIDTH, config.MAP_HEIGHT);
    }

    drawTank(tank) {
        if (!tank || typeof tank.x !== 'number' || typeof tank.y !== 'number') return;

        const ctx = this.ctx;
        const size = this.config?.TANK_SIZE || 40;

        // Blinking effect for invincibility (blink every 100ms)
        const isBlinkVisible = Math.floor(Date.now() / 100) % 2 === 0;

        ctx.save();
        ctx.translate(tank.x, tank.y);
        ctx.rotate(tank.angle || 0);

        // Draw spawn protection / invincibility effect with blinking
        if (tank.spawnProtection || tank.invincible) {
            if (isBlinkVisible) {
                ctx.beginPath();
                ctx.arc(0, 0, size / 2 + 10, 0, Math.PI * 2);
                ctx.strokeStyle = tank.invincible ? '#FFD700' : '#00FFFF';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Glowing effect
                ctx.beginPath();
                ctx.arc(0, 0, size / 2 + 5, 0, Math.PI * 2);
                ctx.fillStyle = tank.invincible ? 'rgba(255, 215, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)';
                ctx.fill();
            }
        }

        // Tank body
        ctx.fillStyle = tank.primaryColor;
        ctx.fillRect(-size / 2, -size / 2.5, size, size / 1.25);

        // Tank tracks
        ctx.fillStyle = tank.secondaryColor;
        ctx.fillRect(-size / 2, -size / 2.5, size / 6, size / 1.25);
        ctx.fillRect(size / 2 - size / 6, -size / 2.5, size / 6, size / 1.25);

        // Tank turret
        ctx.fillStyle = tank.secondaryColor;
        ctx.beginPath();
        ctx.arc(0, 0, size / 4, 0, Math.PI * 2);
        ctx.fill();

        // Tank barrel
        ctx.fillStyle = tank.secondaryColor;
        ctx.fillRect(0, -size / 10, size / 2 + 5, size / 5);

        // Avatar in center of tank (on top of turret)
        if (tank.avatarUrl) {
            ctx.save();
            ctx.rotate(-(tank.angle || 0)); // Counter-rotate so avatar stays upright
            const avatarSize = size / 2.5;
            const img = new Image();
            img.src = tank.avatarUrl;
            ctx.beginPath();
            ctx.arc(0, 0, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            try {
                ctx.drawImage(img, -avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
            } catch (e) {}
            ctx.restore();
        }

        ctx.restore();

        // Draw name and HP bar above tank
        this.drawTankInfo(tank);
    }

    drawTankInfo(tank) {
        const ctx = this.ctx;
        const size = this.config?.TANK_SIZE || 40;

        // Name above tank
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(tank.name + (tank.isBot ? ' [BOT]' : ''), tank.x, tank.y - size / 2 - 20);

        // HP Bar background
        const barWidth = 50;
        const barHeight = 6;
        ctx.fillStyle = '#333';
        ctx.fillRect(tank.x - barWidth / 2, tank.y - size / 2 - 12, barWidth, barHeight);

        // HP Bar fill
        const hpPercent = (tank.hp || 0) / (tank.maxHp || 100);
        let hpColor = '#4CAF50';
        if (hpPercent < 0.3) hpColor = '#f44336';
        else if (hpPercent < 0.6) hpColor = '#ff9800';

        ctx.fillStyle = hpColor;
        ctx.fillRect(tank.x - barWidth / 2, tank.y - size / 2 - 12, barWidth * hpPercent, barHeight);

        // HP Bar border
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.strokeRect(tank.x - barWidth / 2, tank.y - size / 2 - 12, barWidth, barHeight);
    }

    drawBullet(bullet) {
        const ctx = this.ctx;
        const size = this.config?.BULLET_SIZE || 8;

        ctx.save();
        ctx.translate(bullet.x, bullet.y);
        ctx.rotate(bullet.angle);

        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Bullet trail
        ctx.fillStyle = 'rgba(255, 200, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(-size * 2, 0, size * 2, size / 3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    drawObstacle(obstacle) {
        const ctx = this.ctx;
        const size = obstacle.size || 40;

        // Color mapping for obstacle types
        const obstacleColors = {
            TREE: '#228B22',
            WALL: '#808080',
            BARREL: '#8B4513',
            CRATE: '#DEB887'
        };
        const color = obstacle.config?.color || obstacleColors[obstacle.type] || '#888';

        ctx.save();
        ctx.translate(obstacle.x, obstacle.y);

        switch (obstacle.type) {
            case 'TREE':
                // Tree trunk
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-5, -5, 10, 15);
                // Tree foliage
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(0, -10, size / 2, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'WALL':
                ctx.fillStyle = color;
                ctx.fillRect(-size / 2, -size / 2, size, size);
                // Brick pattern
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 2;
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.beginPath();
                ctx.moveTo(-size / 2, 0);
                ctx.lineTo(size / 2, 0);
                ctx.moveTo(0, -size / 2);
                ctx.lineTo(0, 0);
                ctx.moveTo(-size / 4, 0);
                ctx.lineTo(-size / 4, size / 2);
                ctx.moveTo(size / 4, 0);
                ctx.lineTo(size / 4, size / 2);
                ctx.stroke();
                break;

            case 'BARREL':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.ellipse(0, 0, size / 2.5, size / 2, 0, 0, Math.PI * 2);
                ctx.fill();
                // Hazard symbol
                ctx.fillStyle = '#FFD700';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('!', 0, 0);
                break;

            case 'CRATE':
                ctx.fillStyle = color;
                ctx.fillRect(-size / 2, -size / 2, size, size);
                // Crate pattern
                ctx.strokeStyle = '#8B7355';
                ctx.lineWidth = 2;
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.beginPath();
                ctx.moveTo(-size / 2, -size / 2);
                ctx.lineTo(size / 2, size / 2);
                ctx.moveTo(size / 2, -size / 2);
                ctx.lineTo(-size / 2, size / 2);
                ctx.stroke();
                // Question mark
                ctx.fillStyle = '#000';
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', 0, 0);
                break;
        }

        // Health bar for obstacles
        const hpPercent = obstacle.hp / (obstacle.maxHp || 100);
        if (hpPercent < 1) {
            const barWidth = size;
            const barHeight = 4;
            ctx.fillStyle = '#333';
            ctx.fillRect(-barWidth / 2, -size / 2 - 10, barWidth, barHeight);
            ctx.fillStyle = '#f44336';
            ctx.fillRect(-barWidth / 2, -size / 2 - 10, barWidth * hpPercent, barHeight);
        }

        ctx.restore();
    }

    drawPowerup(powerup) {
        const ctx = this.ctx;
        const size = powerup.size || 25;

        // Powerup color/icon mapping
        const powerupData = {
            SPEED: { color: '#00FFFF', icon: '⚡' },
            POWER: { color: '#FF0000', icon: '💪' },
            HEALTH: { color: '#00FF00', icon: '❤️' },
            RANGE: { color: '#FFFF00', icon: '🎯' },
            INVINCIBILITY: { color: '#FFD700', icon: '⭐' }
        };
        const data = powerup.config || powerupData[powerup.type] || { color: '#fff', icon: '?' };

        ctx.save();
        ctx.translate(powerup.x, powerup.y);

        // Glow effect
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
        gradient.addColorStop(0, data.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Powerup circle
        ctx.fillStyle = data.color;
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Icon
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(data.icon, 0, 0);

        ctx.restore();
    }

    drawExplosion(explosion) {
        const ctx = this.ctx;
        const elapsed = Date.now() - explosion.startTime;
        const duration = 500;

        if (elapsed > duration) return;

        const progress = elapsed / duration;
        const currentRadius = explosion.maxRadius * (0.5 + progress * 0.5);
        const alpha = 1 - progress;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Outer ring
        const gradient = ctx.createRadialGradient(
            explosion.x, explosion.y, 0,
            explosion.x, explosion.y, currentRadius
        );
        gradient.addColorStop(0, '#FF6600');
        gradient.addColorStop(0.5, '#FF0000');
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    updateExplosions() {
        const now = Date.now();
        this.explosions = this.explosions.filter(exp => now - exp.startTime < 500);
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new TankGame();
});
