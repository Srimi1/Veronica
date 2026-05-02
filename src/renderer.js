// renderer.js — Holographic AI orb (Iron Man hologram style)
// Radial filaments + sphere wireframe + red/blue glow particles.

const COLORS = {
  red:       '#DC143C',
  redBright: '#FF1A40',
  redDeep:   '#8B0000',
  blue:      '#1E90FF',
  blueIce:   '#5FD0FF',
  white:     '#FFFFFF',
};

const STATE_CONFIG = {
  IDLE:      { speedMult: 0.5, glowMult: 1.1, chaos: 0.30, blueRatio: 0.35 },
  LISTENING: { speedMult: 0.9, glowMult: 1.3, chaos: 0.40, blueRatio: 0.45 },
  THINKING:  { speedMult: 1.6, glowMult: 1.4, chaos: 0.65, blueRatio: 0.50 },
  SPEAKING:  { speedMult: 1.0, glowMult: 1.2, chaos: 0.45, blueRatio: 0.35 },
  ALERT:     { speedMult: 2.5, glowMult: 1.8, chaos: 0.90, blueRatio: 0.08 },
};

const LOGICAL_SIZE = 280;

// ─── Filament: radial energy thread from inner radius to outer radius ───
class Filament {
  constructor() { this.reset(true); }
  reset(initial) {
    this.angle = Math.random() * Math.PI * 2;
    this.angleVel = (Math.random() - 0.5) * 0.004;
    this.innerR = 18 + Math.random() * 8;
    this.outerR = 60 + Math.random() * 70;
    this.life = initial ? Math.random() : 0;
    this.lifeSpeed = 0.003 + Math.random() * 0.008;
    this.thickness = 0.4 + Math.random() * 0.9;
    this.isBlue = false;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.wobbleAmp = Math.random() * 0.06;
    this.segments = 5 + ((Math.random() * 4) | 0);
  }
  step(dt, speedMult, chaos) {
    this.angle += this.angleVel * speedMult;
    this.life += this.lifeSpeed * speedMult;
    this.wobblePhase += 0.05 * speedMult * (1 + chaos);
    if (this.life >= 1) this.reset(false);
  }
  draw(ctx, cx, cy, blueRatio, glowMult, chaos) {
    // alpha envelope: fade in/out with life
    const env = Math.sin(this.life * Math.PI);
    if (env <= 0) return;
    const useBlue = this.isBlue || Math.random() < 0; // decided once per spawn
    const color = this.isBlue ? COLORS.blue : COLORS.red;
    const tipColor = this.isBlue ? COLORS.blueIce : COLORS.redBright;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    // multi-segment line w/ slight curve via wobble
    ctx.beginPath();
    const len = this.outerR - this.innerR;
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      const r = this.innerR + len * t;
      // tangential wobble grows with chaos
      const wob = Math.sin(this.wobblePhase + t * 6) * this.wobbleAmp * len * (0.5 + chaos);
      const x = r;
      const y = wob;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = this.thickness;
    ctx.strokeStyle = color;
    ctx.globalAlpha = env * 0.85;
    ctx.shadowColor = tipColor;
    ctx.shadowBlur = 6 * glowMult;
    ctx.stroke();

    // bright tip dot
    const tipR = this.outerR;
    const tipWob = Math.sin(this.wobblePhase + 6) * this.wobbleAmp * len * (0.5 + chaos);
    ctx.beginPath();
    ctx.arc(tipR, tipWob, 1.2 + env * 1.0, 0, Math.PI * 2);
    ctx.fillStyle = tipColor;
    ctx.globalAlpha = env;
    ctx.shadowBlur = 10 * glowMult;
    ctx.fill();

    ctx.restore();
  }
}

// ─── Spark: short-lived chaotic particle drifting outward ───
class Spark {
  constructor() { this.reset(true); }
  reset(initial) {
    const ang = Math.random() * Math.PI * 2;
    this.x = Math.cos(ang) * (20 + Math.random() * 30);
    this.y = Math.sin(ang) * (20 + Math.random() * 30);
    const speed = 0.15 + Math.random() * 0.6;
    this.vx = Math.cos(ang) * speed;
    this.vy = Math.sin(ang) * speed;
    this.life = initial ? Math.random() : 0;
    this.lifeSpeed = 0.008 + Math.random() * 0.02;
    this.size = 0.6 + Math.random() * 1.4;
    this.isBlue = Math.random() < 0.25;
  }
  step(dt, speedMult, chaos) {
    this.x += this.vx * speedMult;
    this.y += this.vy * speedMult;
    // chaos jitter
    this.vx += (Math.random() - 0.5) * 0.05 * chaos;
    this.vy += (Math.random() - 0.5) * 0.05 * chaos;
    this.life += this.lifeSpeed * speedMult;
    if (this.life >= 1 || Math.hypot(this.x, this.y) > 130) this.reset(false);
  }
  draw(ctx, cx, cy, glowMult) {
    const env = Math.sin(this.life * Math.PI);
    if (env <= 0) return;
    const color = this.isBlue ? COLORS.blueIce : COLORS.redBright;
    ctx.save();
    ctx.globalAlpha = env;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * glowMult;
    ctx.beginPath();
    ctx.arc(cx + this.x, cy + this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.dpr = window.devicePixelRatio || 1;

    this.size = LOGICAL_SIZE;
    this.cx = this.size / 2;
    this.cy = this.size / 2;

    const winSize = window.innerWidth || LOGICAL_SIZE;
    this.scale = winSize / this.size;

    this.canvas.width = winSize * this.dpr;
    this.canvas.height = winSize * this.dpr;
    this.canvas.style.width = winSize + 'px';
    this.canvas.style.height = winSize + 'px';
    this.ctx.scale(this.dpr * this.scale, this.dpr * this.scale);

    this.currentState = 'IDLE';
    this.hoverActive = false;
    this.pulsePhase = 0;
    this.time = 0;
    this.lastTime = 0;
    this.running = false;

    // Build filaments
    this.filaments = [];
    const FIL_COUNT = 130;
    for (let i = 0; i < FIL_COUNT; i++) this.filaments.push(new Filament());
    // Re-roll blue assignment per current state
    this._assignColors(STATE_CONFIG.IDLE.blueRatio);

    // Build sparks
    this.sparks = [];
    for (let i = 0; i < 50; i++) this.sparks.push(new Spark());

    // Sphere wireframe arcs (precomputed angles for latitude/longitude lines)
    this.lat = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
    this.lonRot = 0;
  }

  _assignColors(blueRatio) {
    this.filaments.forEach(f => { f.isBlue = Math.random() < blueRatio; });
  }

  setState(state) {
    if (!STATE_CONFIG[state]) return;
    this.currentState = state;
    this._assignColors(STATE_CONFIG[state].blueRatio);
  }

  setHover(active) { this.hoverActive = !!active; }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(50, t - this.lastTime);
      this.lastTime = t;
      this.time += dt;
      this._render(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }
  destroy() { this.stop(); }

  _render(dt) {
    const cfg = STATE_CONFIG[this.currentState];
    const speedMult = cfg.speedMult * (this.hoverActive ? 1.15 : 1);
    const glowMult = cfg.glowMult * (this.hoverActive ? 1.2 : 1);
    const chaos = cfg.chaos;

    const ctx = this.ctx;
    const cx = this.cx, cy = this.cy;

    // clear with full transparency (window is transparent)
    ctx.clearRect(0, 0, this.size, this.size);

    // outer faint sphere glow — large soft red gradient
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 120);
    grad.addColorStop(0, 'rgba(255,30,60,0.25)');
    grad.addColorStop(0.45, 'rgba(220,20,60,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.size, this.size);

    // sphere wireframe — longitude (vertical ovals) + latitude (horiz arcs)
    this.lonRot += 0.0025 * speedMult;
    this._drawSphereWireframe(ctx, cx, cy, glowMult);

    // filaments
    this.filaments.forEach(f => {
      f.step(dt, speedMult, chaos);
      f.draw(ctx, cx, cy, cfg.blueRatio, glowMult, chaos);
    });

    // sparks
    this.sparks.forEach(s => {
      s.step(dt, speedMult, chaos);
      s.draw(ctx, cx, cy, glowMult);
    });

    // pulsing core
    this.pulsePhase += 0.04 * speedMult;
    const pulse = 0.7 + Math.sin(this.pulsePhase) * 0.3;
    const coreR = 7 + pulse * 3;
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    coreGrad.addColorStop(0, '#FFFFFF');
    coreGrad.addColorStop(0.3, COLORS.redBright);
    coreGrad.addColorStop(1, 'rgba(220,20,60,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
    ctx.fill();

    // bright white core dot
    ctx.shadowColor = COLORS.redBright;
    ctx.shadowBlur = 18 * glowMult;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  _drawSphereWireframe(ctx, cx, cy, glowMult) {
    const R = 110;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,20,60,0.35)';
    ctx.lineWidth = 0.6;
    ctx.shadowColor = COLORS.red;
    ctx.shadowBlur = 4 * glowMult;

    // latitude horizontal arcs (squashed circles)
    this.lat.forEach(phi => {
      const rx = R * Math.cos(phi);
      const ry = Math.abs(Math.sin(phi)) * 16 + 2;
      const offY = R * Math.sin(phi);
      ctx.beginPath();
      ctx.ellipse(cx, cy + offY, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    });

    // longitude — rotating vertical ovals (3 of them, evenly spaced)
    for (let i = 0; i < 3; i++) {
      const a = this.lonRot + i * (Math.PI / 3);
      const rx = Math.abs(Math.cos(a)) * R + 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, R, 0, 0, Math.PI * 2);
      ctx.strokeStyle = i === 1
        ? 'rgba(94,208,255,0.30)'   // one blue meridian
        : 'rgba(220,20,60,0.30)';
      ctx.stroke();
    }

    // outer rim
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,26,64,0.55)';
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 8 * glowMult;
    ctx.stroke();

    ctx.restore();
  }
}

export function createRenderer(canvas) { return new Renderer(canvas); }
