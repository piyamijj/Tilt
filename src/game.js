import Matter from 'matter-js';

export const W = 480;
export const H = 800;

const { Engine, World, Bodies, Body, Events, Constraint } = Matter;

// ---- Stil bloğu: tek palet, tek ışık yönü (sol-üst) ----
const C = {
  felt0: '#1c4030',
  felt1: '#0a1510',
  wood0: '#4a2f18',
  wood1: '#1c1009',
  steel0: '#f2ede0',
  steel1: '#8f8a7c',
  steel2: '#3c3a34',
  brass: '#c9a227',
  brassD: '#7a5f14',
  bone: '#e8e0c8',
  green: '#7dff9a',
  greenD: '#1f5c33',
  blood: '#b3122e',
  rubber: '#8c1f2f',
  shadow: 'rgba(0,0,0,0.55)',
};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => performance.now();

// ---- Masa geometrisi: fizik ve çizim AYNI sabitleri kullanır ----
// (Topun "çizgiye değip ne olduğu belirsiz" kalmaması için görsel = fizik.)
const G = {
  ballR: 11,
  wallT: 16,
  laneDivX: 408, // kulvar ayırıcı merkez x (iki parça + çıkış boşluğu)
  laneDivW: 10,
  laneBallX: 436, // fırlatma kulvarında topun x'i
  laneBaseY: 704, // yay tabanı merkez y
  laneRestY: 680, // kulvardaki topun durma noktası (YAY butonunun üstünde)
  flipL: { x: 178, y: 716 },
  flipR: { x: 302, y: 716 },
  flipLen: 54,
  flipRest: 0.5, // radyan, yataydan aşağı
  flipActive: -0.5,
  flipSpeed: 0.25, // vuruş hızı (rad/alt-adım): ~40ms'de tam savrulma
  flipReturn: 0.18,
};

// ---- Palet sürüş matematiği (saf fonksiyon: test edilebilir) ----
// Hedefe yaklaştıkça yumuşayan hız + hedefte ölü bant. setAngle ışınlaması
// YOK: ışınlama pivot kısıtıyla kavga edip paleti titretiyordu (vızıltı).
export function flipperTarget(side, pressed) {
  if (side === 'L') return pressed ? G.flipActive : G.flipRest;
  return pressed ? Math.PI - G.flipActive : Math.PI - G.flipRest;
}

export function flipperDrive(side, angle, pressed) {
  const target = flipperTarget(side, pressed);
  const a = side === 'R' ? (((angle % TAU) + TAU) % TAU) : angle;
  const diff = Math.atan2(Math.sin(target - a), Math.cos(target - a));
  if (Math.abs(diff) < 0.004) return 0;
  const top = pressed ? G.flipSpeed : G.flipReturn;
  return Math.sign(diff) * top * clamp(Math.abs(diff) / 0.35, 0.12, 1);
}

// Pivot ofseti: Matter kısıtı pointB'yi dünya ekseninde alır ve SADECE
// sonradan dönen farkı takip eder. O yüzden ofset, yaratılış açısına göre
// DÖNDÜRÜLMÜŞ verilmelidir; yoksa palet yanlış noktadan menteşelenir
// (sağ palet duvara gömülü kalmıştı).
export function flipperPinOffset(off, restAngle) {
  return { x: -off * Math.cos(restAngle), y: -off * Math.sin(restAngle) };
}

export class Game {
  constructor(canvas, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = hooks;

    this.engine = Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1.15;
    this.engine.positionIterations = 10;
    this.engine.velocityIterations = 8;
    this.world = this.engine.world;

    this.state = 'menu'; // menu | plunge | flight | play | gameover
    this.score = 0;
    this.hi = 0;
    this.lives = 3;
    this.balls = []; // Matter body listesi
    this.held = null; // Thing'in tuttuğu top
    this.holdUntil = 0;
    this.thingReadyAt = 0;
    this.multiball = false;
    this.spawnQueue = []; // {at}
    this.saverUntil = 0;
    this.flightSince = 0;

    this.leftDown = false;
    this.rightDown = false;
    this.charging = false;
    this.power = 0;
    this.chargeT0 = 0;

    this.standups = [false, false, false];
    this.magnetUntil = 0;
    this.magnet = { x: 356, y: 196 };

    this.particles = [];
    this.floaters = [];
    this.banner = null; // {text, sub, until}
    this.trauma = 0;
    this.cool = {}; // ses kısıntıları
    this.trails = new Map(); // ball.id -> [{x,y}]

    this.acc = 0;
    this.lastT = 0;
    this.running = false;
    this.t0 = now();

    try {
      this.hi = parseInt(localStorage.getItem('tilt.hi') || '0', 10) || 0;
    } catch {
      this.hi = 0;
    }

    this._buildTable();
    this._bindCollisions();
    this._bakeStatic();
  }

  // ================= MASA İNŞASI =================
  _buildTable() {
    const { ballR } = G;
    const wall = { isStatic: true, friction: 0.02, restitution: 0.35, label: 'wall' };
    const add = (b) => World.add(this.world, b);

    // Dış duvarlar (kalın: top asla dışarı çıkamaz)
    add(Bodies.rectangle(8, H / 2, G.wallT, H + 80, { ...wall })); // sol
    add(Bodies.rectangle(W - 8, H / 2, G.wallT, H + 80, { ...wall })); // sağ
    add(Bodies.rectangle(W / 2, 8, W, G.wallT, { ...wall })); // üst
    // Alt güvenlik: orta drenaj boşluğu hariç kapalı
    add(Bodies.rectangle(115, H - 6, 200, G.wallT, { ...wall }));
    add(Bodies.rectangle(365, H - 6, 200, G.wallT, { ...wall }));

    // Üst köşe pahları (topu ortaya yönlendirir, sıkışma yok)
    add(Bodies.rectangle(40, 44, 70, 12, { ...wall, angle: 0.6 }));
    add(Bodies.rectangle(440, 44, 70, 12, { ...wall, angle: -0.6 }));

    // Fırlatma kulvarı ayırıcısı: ortasında çıkış boşluğu olan iki parça
    add(Bodies.rectangle(G.laneDivX, 210, G.laneDivW, 80, { ...wall, label: 'divider' }));
    add(Bodies.rectangle(G.laneDivX, 525, G.laneDivW, 350, { ...wall, label: 'divider' }));
    // Yay tabanı
    add(Bodies.rectangle(G.laneBallX, G.laneBaseY, 48, 12, { ...wall, label: 'plungerBase' }));

    // Yönlendirici kanat: kulvarda yükselen topu boşluktan oyun alanına aktarır
    add(Bodies.rectangle(430, 300, 56, 10, { ...wall, angle: 0.6, label: 'vane' }));
    // Kulvar üst kapağı (sigorta: top üstte kalamaz)
    add(Bodies.rectangle(436, 168, 50, 10, { ...wall, label: 'cap' }));

    // Alt kılavuzlar (inlane)
    add(Bodies.rectangle(95, 672, 140, 12, { ...wall, angle: 0.43, label: 'guide' }));
    add(Bodies.rectangle(360, 692, 96, 12, { ...wall, angle: -0.24, label: 'guide' }));

    // Thing rampası iç duvarı (sol üst kulvar)
    add(Bodies.rectangle(112, 250, 10, 150, { ...wall, label: 'rampWall' }));
    add(Bodies.rectangle(86, 176, 62, 10, { ...wall, angle: 0.25, label: 'rampWall' }));

    // ---- Bumperlar ----
    this.bumpers = [];
    const bumperAt = (x, y) => {
      const body = Bodies.circle(x, y, 23, {
        isStatic: true,
        restitution: 1.45,
        friction: 0,
        label: 'bumper',
      });
      body.plugin = { flash: 0 };
      this.bumpers.push(body);
      add(body);
    };
    bumperAt(185, 262);
    bumperAt(295, 262);
    bumperAt(240, 330);

    // ---- Slingler (yüksek sekmeli kicker yüzleri) ----
    this.slings = [];
    const slingAt = (x, y, angle, side) => {
      const body = Bodies.rectangle(x, y, 24, 82, {
        isStatic: true,
        restitution: 1.25,
        friction: 0,
        angle,
        label: 'sling',
      });
      body.plugin = { flash: 0, side };
      this.slings.push(body);
      add(body);
    };
    slingAt(118, 588, 0.35, 'L');
    slingAt(344, 592, -0.35, 'R');

    // Kauçuk direkler
    this.posts = [
      { x: 150, y: 512 },
      { x: 316, y: 516 },
    ];
    for (const p of this.posts) {
      add(
        Bodies.circle(p.x, p.y, 5, {
          isStatic: true,
          restitution: 0.9,
          friction: 0,
          label: 'post',
        }),
      );
    }

    // ---- Konak hedef bankası (3 standup) ----
    this.standupBodies = [];
    [196, 240, 284].forEach((x, i) => {
      const body = Bodies.rectangle(x, 448, 32, 13, {
        isStatic: true,
        restitution: 0.6,
        friction: 0,
        label: `standup${i}`,
      });
      this.standupBodies.push(body);
      add(body);
    });

    // ---- Flipperlar (dinamik + pivot kısıtı) ----
    this.flippers = {};
    const mkFlipper = (side) => {
      const pivot = side === 'L' ? G.flipL : G.flipR;
      const rest = side === 'L' ? G.flipRest : Math.PI - G.flipRest;
      const dirx = Math.cos(rest);
      const diry = Math.sin(rest);
      const off = G.flipLen / 2 - 4;
      const body = Bodies.rectangle(pivot.x + dirx * off, pivot.y + diry * off, G.flipLen, 15, {
        angle: rest,
        density: 0.02,
        friction: 0.08,
        frictionAir: 0.01,
        restitution: 0.15,
        label: side === 'L' ? 'flipperL' : 'flipperR',
        chamfer: { radius: 7 },
      });
      const pin = Constraint.create({
        pointA: { x: pivot.x, y: pivot.y },
        bodyB: body,
        pointB: flipperPinOffset(off, rest),
        stiffness: 1,
        length: 0,
      });
      add(body);
      World.add(this.world, pin);
      this.flippers[side] = { body, pin, pivot, rest, pressed: false };
    };
    mkFlipper('L');
    mkFlipper('R');

    // ---- Sensörler ----
    const sensor = (x, y, w, h, label) => {
      const s = Bodies.rectangle(x, y, w, h, { isStatic: true, isSensor: true, label });
      add(s);
      return s;
    };
    sensor(240, 792, 76, 26, 'drain');
    sensor(360, 300, 100, 50, 'laneExit');
    sensor(G.laneBallX, 560, 42, 260, 'laneZone');
    sensor(72, 318, 76, 22, 'thingRamp');
    const chair = Bodies.circle(this.magnet.x, this.magnet.y, 44, {
      isStatic: true,
      isSensor: true,
      label: 'chairZone',
    });
    add(chair);
    void ballR;
  }

  _bindCollisions() {
    Events.on(this.engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const { bodyA, bodyB } = pair;
        const ball = bodyA.label === 'ball' ? bodyA : bodyB.label === 'ball' ? bodyB : null;
        if (!ball) continue;
        const other = ball === bodyA ? bodyB : bodyA;
        this._onBallHit(ball, other);
      }
    });
  }

  _audible(key, ms) {
    const t = now();
    if (this.cool[key] && t - this.cool[key] < ms) return false;
    this.cool[key] = t;
    return true;
  }

  // ================= OYUN AKIŞI =================
  get vip() {
    return this.lives === Infinity;
  }

  startGame(vip) {
    this._clearBalls();
    this.clearEffects();
    this.score = 0;
    this.lives = vip ? Infinity : 3;
    this.multiball = false;
    this.spawnQueue = [];
    this.standups = [false, false, false];
    this.magnetUntil = 0;
    this.state = 'plunge';
    this.h.setScore(0);
    this.h.setLives(this.lives);
    this.h.setMultiball(false);
    this.h.setSave(false);
    this._spawnPlungerBall();
    this.h.toast(vip ? 'VIP MODU: SINIRSUZ TOP' : 'BOL ŞANS, MORTICIA SENİNLE');
  }

  toMenu() {
    this.state = 'menu';
    this._clearBalls();
    this.clearEffects();
    this.multiball = false;
    this.h.setMultiball(false);
    this.h.setSave(false);
  }

  _clearBalls() {
    for (const b of this.balls) World.remove(this.world, b);
    this.balls = [];
    this.held = null;
    this.trails.clear();
  }

  clearEffects() {
    this.particles = [];
    this.floaters = [];
    this.banner = null;
    this.trauma = 0;
    this.charging = false;
    this.power = 0;
  }

  _spawnBall(x, y, vx = 0, vy = 0) {
    const ball = Bodies.circle(x, y, G.ballR, {
      restitution: 0.25,
      friction: 0.008,
      frictionAir: 0.0016,
      density: 0.0018,
      slop: 0.02,
      label: 'ball',
    });
    Body.setVelocity(ball, { x: vx, y: vy });
    World.add(this.world, ball);
    this.balls.push(ball);
    this.trails.set(ball.id, []);
    return ball;
  }

  _spawnPlungerBall() {
    this.state = 'plunge';
    this._spawnBall(G.laneBallX, G.laneRestY, 0, 0);
    this.h.showPlunger(true);
  }

  _removeBall(ball) {
    World.remove(this.world, ball);
    this.balls = this.balls.filter((b) => b !== ball);
    this.trails.delete(ball.id);
    if (this.held === ball) this.held = null;
  }

  addScore(n, x = null, y = null) {
    const mult = this.multiball ? 2 : 1;
    this.score += n * mult;
    if (this.score > this.hi) {
      this.hi = this.score;
      try {
        localStorage.setItem('tilt.hi', String(this.hi));
      } catch {
        /* yoksay */
      }
      this.h.setHi(this.hi);
    }
    this.h.setScore(this.score);
    if (x !== null && y !== null) this._floater(x, y, `+${n * mult}`, '#e8e0c8');
  }

  // ---- Yay (plunger) ----
  plungerStart() {
    if (this.state !== 'plunge') return;
    this.charging = true;
    this.chargeT0 = now();
    this.power = 0;
  }

  plungerDrag(frac) {
    if (this.state !== 'plunge' || !this.charging) return;
    this.power = clamp(frac, 0, 1);
    this.h.setPower(this.power);
  }

  plungerRelease() {
    if (this.state !== 'plunge' || !this.charging) return;
    this.charging = false;
    const ball = this.balls[0];
    if (!ball) return;
    const p = this.power > 0.03 ? this.power : 0.35;
    Body.setVelocity(ball, { x: 0, y: -(22 + 12 * p) });
    this.state = 'flight';
    this.flightSince = now();
    this.h.showPlunger(false);
    this.h.setPower(0);
    this.h.sfx.launch(p);
    this._burst(ball.position.x, ball.position.y + 14, 8, '#c9a227');
  }

  /** Test/hata ayıklama: ilk topu verilen noktaya koyar (fizik aynen işler). */
  debugPlace(x, y) {
    const ball = this.balls[0];
    if (!ball || ball.isStatic) return false;
    Body.setPosition(ball, { x, y });
    Body.setVelocity(ball, { x: 0, y: 0.5 });
    return true;
  }

  // ---- Flipper girişi ----
  setFlipper(side, down) {
    const f = this.flippers[side];
    if (!f) return;
    if (down && !f.pressed && this._audible(`flip${side}`, 60)) this.h.sfx.flipper();
    f.pressed = down;
  }

  // ---- Çarpışma yönlendirme ----
  _onBallHit(ball, other) {
    const label = other.label;
    const pos = ball.position;
    switch (true) {
      case label === 'bumper': {
        other.plugin.flash = 1;
        this.addScore(100, pos.x, pos.y - 26);
        this.h.sfx.bumper();
        this.trauma = Math.min(1, this.trauma + 0.18);
        this._burst(pos.x, pos.y, 6, '#ffd34d');
        break;
      }
      case label === 'sling': {
        other.plugin.flash = 1;
        this.addScore(50);
        if (this._audible('sling', 70)) this.h.sfx.sling();
        this._burst(pos.x, pos.y, 4, '#7dff9a');
        break;
      }
      case label === 'post': {
        this.addScore(10);
        if (this._audible('post', 120)) this.h.sfx.target();
        break;
      }
      case label.startsWith('standup'): {
        const i = Number(label.slice(7));
        if (!this.standups[i]) {
          this.standups[i] = true;
          this.addScore(250, other.position.x, other.position.y - 20);
          this.h.sfx.target();
          this._burst(other.position.x, other.position.y, 10, '#7dff9a');
          if (this.standups.every(Boolean)) this._mansionComplete();
        } else {
          this.addScore(25);
        }
        break;
      }
      case label === 'drain': {
        this._onDrain(ball);
        break;
      }
      case label === 'laneExit': {
        if (this.state === 'flight') {
          this.state = 'play';
          this.saverUntil = now() + 5000;
          this.h.setSave(true);
          this.addScore(25);
          if (this._audible('exit', 200)) this.h.sfx.target();
        }
        break;
      }
      case label === 'laneZone': {
        this._onLaneZone(ball);
        break;
      }
      case label === 'thingRamp': {
        this._onThingRamp(ball);
        break;
      }
      case label === 'chairZone': {
        this.addScore(150, pos.x, pos.y - 24);
        if (this._audible('chair', 400)) this.h.sfx.magnet();
        this._burst(pos.x, pos.y, 8, '#9fd8ff');
        break;
      }
      case label === 'wall' || label === 'guide' || label === 'divider' || label === 'vane' || label === 'cap': {
        const sp = Math.hypot(ball.velocity.x, ball.velocity.y);
        if (sp > 9 && this._audible('tick', 140)) this.h.sfx.sling();
        break;
      }
      default:
        break;
    }
  }

  _onLaneZone(ball) {
    if (this.state === 'flight' && now() - this.flightSince > 350) {
      // Zayıf atış geri düştü: yeniden doldur
      this.state = 'plunge';
      Body.setPosition(ball, { x: G.laneBallX, y: G.laneRestY });
      Body.setVelocity(ball, { x: 0, y: 0 });
      this.h.showPlunger(true);
    }
    // Oyundayken kulvara düşen top _step içindeki yoklamayla yönetilir.
  }

  _onDrain(ball) {
    if (this.state !== 'play' && this.state !== 'flight') return;
    // Top kurtarıcı aktif mi?
    if (now() < this.saverUntil && this.balls.length <= 1) {
      Body.setPosition(ball, { x: G.laneBallX, y: G.laneRestY });
      Body.setVelocity(ball, { x: 0, y: 0 });
      this.state = 'plunge';
      this.saverUntil = 0;
      this.h.setSave(false);
      this.h.showPlunger(true);
      this.h.sfx.save();
      this._showBanner('TOP KURTARILDI', '', 1400);
      return;
    }
    this._removeBall(ball);
    this.h.sfx.drain();
    this.trauma = Math.min(1, this.trauma + 0.3);
    if (this.balls.length > 0) {
      if (this.balls.length === 1) {
        this.multiball = false;
        this.h.setMultiball(false);
      }
      return;
    }
    // Son top düştü
    this.multiball = false;
    this.h.setMultiball(false);
    this.h.setSave(false);
    if (!this.vip) {
      this.lives -= 1;
      this.h.setLives(this.lives);
    }
    if (this.vip || this.lives > 0) {
      this.standups = [false, false, false];
      this._spawnPlungerBall();
      if (this.vip) this.h.toast('VIP: YENİ TOP GELDİ');
    } else {
      this.state = 'gameover';
      this.h.sfx.gameover();
      this.h.onGameOver(this.score, this.hi);
    }
  }

  _mansionComplete() {
    this.addScore(1000, 240, 400);
    this.h.sfx.mansion();
    this.magnetUntil = now() + 5000;
    this._showBanner('KONAK AYDINLANDI', 'MIKNATIS + MULTIBALL', 2200);
    this._burst(240, 440, 24, '#7dff9a');
    this.trauma = Math.min(1, this.trauma + 0.35);
    if (!this.multiball) this._startMultiball();
    setTimeout(() => {
      if (this.state === 'play' || this.state === 'plunge') this.standups = [false, false, false];
    }, 6000);
  }

  _startMultiball() {
    this.multiball = true;
    this.h.setMultiball(true);
    this.h.sfx.multiball();
    const t = now();
    this.spawnQueue.push({ at: t + 700 }, { at: t + 1400 });
  }

  _onThingRamp(ball) {
    const t = now();
    if (this.state !== 'play' || this.held || t < this.thingReadyAt) return;
    if (ball.position.y > 360) return;
    this.held = ball;
    this.holdUntil = t + 1100;
    this.thingReadyAt = t + 10000;
    Body.setVelocity(ball, { x: 0, y: 0 });
    Body.setStatic(ball, true);
    Body.setPosition(ball, { x: 72, y: 300 });
    this.h.sfx.thing();
    this._showBanner('THING YAKALADI', '', 1100);
  }

  _releaseThing() {
    const ball = this.held;
    if (!ball) return;
    this.held = null;
    Body.setStatic(ball, false);
    // Gizli geçit: sağ iç kulvara bırak
    Body.setPosition(ball, { x: 348, y: 420 });
    Body.setVelocity(ball, { x: 1.5, y: 4 });
    this.addScore(1000, 348, 390);
    this._burst(348, 420, 18, '#c9a227');
    this.trauma = Math.min(1, this.trauma + 0.25);
  }

  // ================= FİZİK ADIMI =================
  _step(dtMs) {
    const t = now();
    // Klavye ile basılı tutma: güç 1.2 sn'de dolar
    if (this.charging && this.state === 'plunge') {
      this.power = clamp((t - this.chargeT0) / 1200, 0, 1);
      this.h.setPower(this.power);
    }
    this._driveFlipper('L');
    this._driveFlipper('R');
    if (t < this.magnetUntil) this._applyMagnet();
    if (this.held && t >= this.holdUntil) this._releaseThing();
    // Multiball kuyruğu
    while (this.spawnQueue.length && t >= this.spawnQueue[0].at) {
      this.spawnQueue.shift();
      if ((this.state === 'play' || this.state === 'flight') && this.balls.length < 3) {
        this._spawnBall(330, 140, -3.5, 1.5);
        this._burst(330, 140, 12, '#ff8f9d');
      }
    }
    if (this.saverUntil && t >= this.saverUntil) {
      this.saverUntil = 0;
      this.h.setSave(false);
    }
    // Güvenlik: fırlatış sensörü ıskalanırsa uçuşu oyuna çevir (top asla "arafta" kalmaz)
    if (this.state === 'flight' && t - this.flightSince > 4000) {
      this.state = 'play';
      this.saverUntil = t + 3000;
      this.h.setSave(true);
    }
    // Hız tavanı + harita güvenlik ağı
    for (const ball of [...this.balls]) {
      if (ball.isStatic) continue; // Thing tutuyor
      const v = ball.velocity;
      const sp = Math.hypot(v.x, v.y);
      if (sp > 34) Body.setVelocity(ball, { x: (v.x / sp) * 34, y: (v.y / sp) * 34 });
      const p = ball.position;
      if (p.x < -20 || p.x > W + 20 || p.y < -40) {
        Body.setPosition(ball, { x: clamp(p.x, 60, W - 80), y: clamp(p.y, 120, 500) });
        Body.setVelocity(ball, { x: 0, y: 2 });
      } else if (p.y > H + 30) {
        if (this.state === 'plunge') {
          // Kulvar topu bir şekilde aşağı düştüyse hak kaybettirmeden iade et
          Body.setPosition(ball, { x: G.laneBallX, y: G.laneRestY });
          Body.setVelocity(ball, { x: 0, y: 0 });
        } else {
          this._onDrain(ball);
        }
      }
    }
    // Kulvara düşen top: tek top ise ücretsiz yeniden doldur, multiball ise otomatik fırlat
    if (this.state === 'play') {
      for (const ball of this.balls) {
        if (ball.isStatic) continue;
        const p = ball.position;
        const inLane = p.x > 414 && p.x < 458 && p.y > 380 && p.y < 700;
        const sp = Math.hypot(ball.velocity.x, ball.velocity.y);
        if (inLane && sp < 1.5) {
          ball.laneT = (ball.laneT || 0) + dtMs;
          if (ball.laneT > 900) {
            ball.laneT = 0;
            Body.setPosition(ball, { x: G.laneBallX, y: G.laneRestY });
            if (this.balls.length === 1) {
              Body.setVelocity(ball, { x: 0, y: 0 });
              this.state = 'plunge';
              this.h.showPlunger(true);
              this.h.toast('KULVARA DÖNDÜN: TEKRAR FIRLAT');
            } else {
              Body.setVelocity(ball, { x: 0, y: -28 });
            }
          }
        } else {
          ball.laneT = 0;
        }
      }
    }
    // Takılma sigortası: oyunda hareketsiz kalan topu hafifçe dürt
    if (this.state === 'play') {
      for (const ball of this.balls) {
        if (ball.isStatic || this.held === ball) continue;
        const sp = Math.hypot(ball.velocity.x, ball.velocity.y);
        const inLane = ball.position.x > 413 && ball.position.y > 400;
        if (sp < 0.25 && !inLane) {
          ball.pluginT = (ball.pluginT || 0) + dtMs;
          if (ball.pluginT > 2500) {
            ball.pluginT = 0;
            Body.setVelocity(ball, { x: rand(-3, 3), y: -4 });
            this._floater(ball.position.x, ball.position.y - 20, 'DÜRTME', '#c9a227');
          }
        } else {
          ball.pluginT = 0;
        }
      }
    }
    for (const b of this.bumpers) b.plugin.flash *= 0.9;
    for (const s of this.slings) s.plugin.flash *= 0.88;
    Engine.update(this.engine, dtMs);
  }

  _driveFlipper(side) {
    const f = this.flippers[side];
    Body.setAngularVelocity(f.body, flipperDrive(side, f.body.angle, f.pressed));
  }

  _applyMagnet() {
    const m = this.magnet;
    for (const ball of this.balls) {
      if (ball.isStatic) continue;
      const dx = m.x - ball.position.x;
      const dy = m.y - ball.position.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 230 || d < 4) continue;
      const near = d < 34 ? d / 34 : 1;
      const f = 0.0016 * ball.mass * clamp(1 - d / 230, 0.15, 1) * near;
      Body.applyForce(ball, ball.position, { x: (dx / d) * f, y: (dy / d) * f });
    }
  }

  // ---- Efektler ----
  _burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 300) this.particles.shift();
      const a = rand(0, TAU);
      const sp = rand(1, 4.5);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
    }
  }

  _floater(x, y, text, color) {
    if (this.floaters.length > 12) this.floaters.shift();
    this.floaters.push({ x: clamp(x, 60, W - 60), y, text, color, life: 1 });
  }

  _showBanner(text, sub, ms) {
    this.banner = { text, sub, until: now() + ms, from: now() };
  }

  // ================= STATİK MASA KATMANI =================
  _bakeStatic() {
    const S = 2;
    const cv = document.createElement('canvas');
    cv.width = W * S;
    cv.height = H * S;
    const g = cv.getContext('2d');
    g.scale(S, S);

    // Ahşap kasa
    const wood = g.createLinearGradient(0, 0, W, H);
    wood.addColorStop(0, C.wood0);
    wood.addColorStop(0.5, '#2c1a0c');
    wood.addColorStop(1, C.wood1);
    g.fillStyle = wood;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * H;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(W * 0.3, y + 6, W * 0.6, y - 6, W, y + 3);
      g.stroke();
    }

    // Keçe zemin
    const felt = g.createRadialGradient(240, 300, 60, 240, 420, 520);
    felt.addColorStop(0, C.felt0);
    felt.addColorStop(0.55, '#14301f');
    felt.addColorStop(1, C.felt1);
    g.fillStyle = felt;
    rr(g, 15, 15, W - 30, H - 30, 14);
    g.fill();

    // Fırlatma kulvarı kanalı (hafif çukur hissi)
    g.fillStyle = 'rgba(0,0,0,0.35)';
    rr(g, 414, 24, 42, 730, 8);
    g.fill();
    g.strokeStyle = C.brassD;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(414, 60);
    g.lineTo(414, 740);
    g.stroke();

    // Çelik iç çerçeve çizgileri
    g.strokeStyle = '#5c584c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(17, 40);
    g.lineTo(17, 770);
    g.moveTo(W - 17, 90);
    g.lineTo(W - 17, 770);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(19, 40);
    g.lineTo(19, 770);
    g.moveTo(W - 19, 90);
    g.lineTo(W - 19, 770);
    g.stroke();

    // ---- Konak illüstrasyonu (etkileşimsiz taban; pencereler dinamik) ----
    this._paintMansionBase(g);

    // ---- Elektrikli sandalye sahnesi ----
    this._paintChair(g);

    // ---- Thing rampası tabelası ----
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.4)';
    rr(g, 30, 196, 66, 22, 6);
    g.fill();
    g.fillStyle = C.brass;
    g.font = '800 11px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText('THING', 63, 211);
    g.strokeStyle = 'rgba(201,162,39,0.5)';
    g.setLineDash([4, 4]);
    g.lineWidth = 1.5;
    g.strokeRect(28, 226, 88, 108);
    g.setLineDash([]);
    g.restore();

    // Kulvar etiketi
    g.save();
    g.fillStyle = C.brass;
    g.font = '800 10px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText('FIRLAT', 435, 648);
    g.restore();

    // ---- Fizik gövdelerinin çelik ray görünümleri ----
    const rail = (x, y, w, h, angle = 0) => {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.fillStyle = C.shadow;
      rr(g, -w / 2 + 3, -h / 2 + 4, w, h, Math.min(h / 2, 6));
      g.fill();
      const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, C.steel0);
      grad.addColorStop(0.45, C.steel1);
      grad.addColorStop(1, C.steel2);
      g.fillStyle = grad;
      rr(g, -w / 2, -h / 2, w, h, Math.min(h / 2, 6));
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(-w / 2 + 3, -h / 2 + 1.5, w - 6, 1.6);
      g.restore();
    };
    const stud = (x, y, r, rubber = false) => {
      g.save();
      g.fillStyle = C.shadow;
      g.beginPath();
      g.arc(x + 2, y + 3, r, 0, TAU);
      g.fill();
      const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      if (rubber) {
        grad.addColorStop(0, '#d44a5e');
        grad.addColorStop(0.6, C.rubber);
        grad.addColorStop(1, '#4a0d16');
      } else {
        grad.addColorStop(0, C.steel0);
        grad.addColorStop(0.6, C.steel1);
        grad.addColorStop(1, C.steel2);
      }
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.restore();
    };

    rail(40, 44, 70, 12, 0.6);
    rail(440, 44, 70, 12, -0.6);
    rail(G.laneDivX, 210, G.laneDivW, 80);
    rail(G.laneDivX, 525, G.laneDivW, 350);
    rail(G.laneBallX, G.laneBaseY, 48, 12);
    rail(430, 300, 56, 10, 0.6);
    rail(436, 168, 50, 10);
    rail(95, 672, 140, 12, 0.43);
    rail(360, 692, 96, 12, -0.24);
    rail(112, 250, 10, 150);
    rail(86, 176, 62, 10, 0.25);
    for (const p of this.posts) stud(p.x, p.y, 5, true);

    // Drenaj çukuru
    g.save();
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(240, 788, 46, 16, 0, 0, TAU);
    g.fill();
    g.strokeStyle = C.brassD;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(240, 786, 46, 15, 0, Math.PI, TAU);
    g.stroke();
    g.restore();

    // Vignette
    const vg = g.createRadialGradient(240, 400, 240, 240, 400, 560);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    this.staticCv = cv;
  }

  _paintMansionBase(g) {
    // Gotik konak silueti
    g.save();
    g.fillStyle = C.shadow;
    g.fillRect(178, 503, 124, 112);
    g.fillStyle = '#101319';
    g.fillRect(175, 500, 124, 112); // ana gövde
    g.fillStyle = '#0a0c11';
    g.beginPath(); // çatı
    g.moveTo(165, 500);
    g.lineTo(237, 448);
    g.lineTo(309, 500);
    g.closePath();
    g.fill();
    g.fillStyle = '#101319'; // kule
    g.fillRect(288, 430, 34, 182);
    g.fillStyle = '#0a0c11';
    g.beginPath();
    g.moveTo(284, 430);
    g.lineTo(305, 396);
    g.lineTo(326, 430);
    g.closePath();
    g.fill();
    // Kapı
    g.fillStyle = '#05070a';
    rr(g, 224, 566, 26, 46, 10);
    g.fill();
    g.strokeStyle = C.brassD;
    g.lineWidth = 2;
    rr(g, 224, 566, 26, 46, 10);
    g.stroke();
    // Pencere çerçeveleri (camlar dinamik boyanır)
    this.windowRects = [
      { x: 188, y: 520, w: 20, h: 26 },
      { x: 218, y: 520, w: 20, h: 26 },
      { x: 256, y: 520, w: 20, h: 26 },
      { x: 188, y: 556, w: 20, h: 26 },
      { x: 256, y: 556, w: 20, h: 26 },
      { x: 295, y: 452, w: 20, h: 26 },
    ];
    for (const wr of this.windowRects) {
      g.fillStyle = '#05070a';
      g.fillRect(wr.x, wr.y, wr.w, wr.h);
      g.strokeStyle = C.brassD;
      g.lineWidth = 1.5;
      g.strokeRect(wr.x, wr.y, wr.w, wr.h);
    }
    // Tabela
    g.fillStyle = 'rgba(0,0,0,0.55)';
    rr(g, 182, 614, 150, 20, 6);
    g.fill();
    g.fillStyle = C.brass;
    g.font = '800 11px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText('ADDAMS KONAĞI', 257, 628);
    g.restore();
  }

  _paintChair(g) {
    const { x, y } = this.magnet;
    g.save();
    // Alan halkası
    g.strokeStyle = 'rgba(159,216,255,0.35)';
    g.lineWidth = 2;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.arc(x, y, 44, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    // Zemin
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.ellipse(x, y + 26, 34, 10, 0, 0, TAU);
    g.fill();
    // Sandalye
    g.fillStyle = '#1a1410';
    g.fillRect(x - 16, y - 22, 32, 8); // başlık
    g.fillRect(x - 14, y - 14, 6, 34); // sol direk
    g.fillRect(x + 8, y - 14, 6, 34); // sağ direk
    g.fillRect(x - 18, y + 6, 36, 8); // oturak
    g.fillRect(x - 14, y + 14, 5, 12); // bacaklar
    g.fillRect(x + 9, y + 14, 5, 12);
    g.fillStyle = C.brass;
    g.fillRect(x - 16, y - 22, 32, 2);
    // Şimşekler
    g.strokeStyle = '#9fd8ff';
    g.lineWidth = 2;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + sx * 26, y - 30);
      g.lineTo(x + sx * 20, y - 12);
      g.lineTo(x + sx * 26, y - 12);
      g.lineTo(x + sx * 18, y + 8);
      g.stroke();
    }
    g.fillStyle = '#9fd8ff';
    g.font = '800 9px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText('ELEKTRİK', x, y + 42);
    g.restore();
  }

  // ================= DİNAMİK KARE =================
  _frame(dt) {
    const t = now();
    const g = this.ctx;
    const s = this.cv.width / W;

    // İzler
    for (const ball of this.balls) {
      const tr = this.trails.get(ball.id);
      if (!tr) continue;
      tr.push({ x: ball.position.x, y: ball.position.y });
      if (tr.length > 9) tr.shift();
    }
    // Parçacıklar
    for (const p of this.particles) {
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vy += 0.08 * dt * 0.06;
      p.life -= dt / 650;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.y -= dt * 0.045;
      f.life -= dt / 1100;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.trauma = Math.max(0, this.trauma - dt / 900);

    const sh = this.trauma * this.trauma * 9;
    const shx = rand(-sh, sh);
    const shy = rand(-sh, sh);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(s, 0, 0, s, shx * s, shy * s);
    g.drawImage(this.staticCv, 0, 0, W, H);

    const magnetOn = t < this.magnetUntil;
    if (magnetOn) this._drawMagnet(g, t);
    this._drawMansionLights(g, t);
    for (const b of this.bumpers) this._drawBumper(g, b, t);
    for (const sl of this.slings) this._drawSling(g, sl);
    this._drawStandups(g, t);
    this._drawFlipper(g, 'L');
    this._drawFlipper(g, 'R');
    this._drawPlunger(g);
    for (const ball of this.balls) this._drawBall(g, ball);
    if (this.held) this._drawHand(g, t);
    this._drawParticles(g);
    this._drawFloaters(g);
    if (this.banner && t < this.banner.until) this._drawBanner(g, t);
    else if (this.banner && t >= this.banner.until) this.banner = null;
  }

  _drawMagnet(g, t) {
    const { x, y } = this.magnet;
    g.save();
    const pulse = 0.6 + 0.4 * Math.sin(t / 90);
    const glow = g.createRadialGradient(x, y, 8, x, y, 120);
    glow.addColorStop(0, `rgba(159,216,255,${0.35 * pulse})`);
    glow.addColorStop(1, 'rgba(159,216,255,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, 120, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(200,235,255,${0.5 + 0.5 * pulse})`;
    g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a0 = rand(0, TAU);
      g.beginPath();
      g.arc(x, y, 52 + i * 14, a0, a0 + rand(0.6, 1.6));
      g.stroke();
    }
    g.restore();
  }

  _drawMansionLights(g, t) {
    const lit = this.standups.filter(Boolean).length;
    const allLit = lit === 3;
    const flicker = allLit ? 0.75 + 0.25 * Math.sin(t / 70) : 1;
    this.windowRects.forEach((wr, i) => {
      const on = i < lit * 2;
      g.save();
      if (on) {
        g.fillStyle = `rgba(125,255,154,${0.85 * flicker})`;
        g.shadowColor = '#7dff9a';
        g.shadowBlur = 12;
      } else {
        g.fillStyle = '#0a0f0c';
      }
      g.fillRect(wr.x, wr.y, wr.w, wr.h);
      g.restore();
      g.strokeStyle = '#2a2113';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(wr.x + wr.w / 2, wr.y);
      g.lineTo(wr.x + wr.w / 2, wr.y + wr.h);
      g.moveTo(wr.x, wr.y + wr.h / 2);
      g.lineTo(wr.x + wr.w, wr.y + wr.h / 2);
      g.stroke();
    });
  }

  _drawBumper(g, body, t) {
    const { x, y } = body.position;
    let flash = body.plugin.flash;
    if (this.state === 'menu') flash = Math.max(flash, 0.25 + 0.15 * Math.sin(t / 400 + x));
    g.save();
    g.fillStyle = C.shadow;
    g.beginPath();
    g.arc(x + 3, y + 5, 24, 0, TAU);
    g.fill();
    // Taban halka
    g.fillStyle = '#241a0c';
    g.beginPath();
    g.arc(x, y, 24, 0, TAU);
    g.fill();
    g.strokeStyle = C.brassD;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 24, 0, TAU);
    g.stroke();
    // Kubbe
    const dome = g.createRadialGradient(x - 7, y - 8, 2, x, y, 20);
    const hot = Math.round(flash * 255);
    dome.addColorStop(0, `rgb(255,${200 + Math.round(flash * 55)},${170 + Math.round(flash * 85)})`);
    dome.addColorStop(0.55, flash > 0.4 ? '#ffd34d' : '#c94054');
    dome.addColorStop(1, flash > 0.4 ? '#7a4a00' : C.blood);
    g.fillStyle = dome;
    g.beginPath();
    g.arc(x, y, 19, 0, TAU);
    g.fill();
    if (flash > 0.05) {
      g.strokeStyle = `rgba(255,240,180,${flash})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, y, 21, 0, TAU);
      g.stroke();
    }
    // Kapak
    g.fillStyle = C.bone;
    g.beginPath();
    g.arc(x, y, 7, 0, TAU);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x - 8, y - 9, 3.5, 0, TAU);
    g.fill();
    void hot;
    g.restore();
  }

  _drawSling(g, body) {
    const flash = body.plugin.flash;
    g.save();
    g.translate(body.position.x, body.position.y);
    g.rotate(body.angle);
    g.fillStyle = C.shadow;
    rr(g, -10 + 3, -39 + 4, 24, 82, 8);
    g.fill();
    const grad = g.createLinearGradient(-12, 0, 12, 0);
    grad.addColorStop(0, '#3c3a34');
    grad.addColorStop(0.5, flash > 0.3 ? '#ffe9a8' : '#8f8a7c');
    grad.addColorStop(1, '#3c3a34');
    g.fillStyle = grad;
    rr(g, -12, -41, 24, 82, 8);
    g.fill();
    // Kauçuk yüz
    g.fillStyle = flash > 0.3 ? '#ff6b80' : C.rubber;
    rr(g, body.plugin.side === 'L' ? 2 : -12, -34, 10, 68, 5);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(-9, -38, 3, 76);
    g.restore();
  }

  _drawStandups(g, t) {
    const letters = ['A', 'D', 'M'];
    this.standupBodies.forEach((body, i) => {
      const { x, y } = body.position;
      const on = this.standups[i];
      g.save();
      g.fillStyle = C.shadow;
      rr(g, x - 16 + 2, y - 6 + 3, 32, 13, 4);
      g.fill();
      if (on) {
        g.shadowColor = '#7dff9a';
        g.shadowBlur = 10;
        g.fillStyle = '#2f8a4a';
      } else {
        g.fillStyle = '#3d1220';
      }
      rr(g, x - 16, y - 6.5, 32, 13, 4);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = on ? '#eafff0' : C.bone;
      g.font = '800 10px Cinzel, Georgia, serif';
      g.textAlign = 'center';
      g.fillText(letters[i], x, y + 4);
      if (!on && this.state !== 'menu') {
        g.fillStyle = `rgba(125,255,154,${0.25 + 0.2 * Math.sin(t / 300 + i * 2)})`;
        g.fillRect(x - 16, y + 5, 32, 2);
      }
      g.restore();
    });
  }

  _drawFlipper(g, side) {
    const f = this.flippers[side];
    const { x, y } = f.body.position;
    const a = f.body.angle;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    const L = G.flipLen + 6;
    g.fillStyle = C.shadow;
    rr(g, -L / 2 + 3, -8 + 4, L, 17, 8);
    g.fill();
    const grad = g.createLinearGradient(0, -8, 0, 9);
    grad.addColorStop(0, '#fff7e0');
    grad.addColorStop(0.4, C.brass);
    grad.addColorStop(1, '#5c430e');
    g.fillStyle = grad;
    rr(g, -L / 2, -8.5, L, 17, 8);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.65)';
    rr(g, -L / 2 + 5, -6, L - 10, 3, 1.5);
    g.fill();
    g.restore();
    // Pivot cıvata
    g.save();
    g.fillStyle = C.shadow;
    g.beginPath();
    g.arc(f.pivot.x + 1.5, f.pivot.y + 2, 7, 0, TAU);
    g.fill();
    const bolt = g.createRadialGradient(f.pivot.x - 2, f.pivot.y - 2, 1, f.pivot.x, f.pivot.y, 7);
    bolt.addColorStop(0, '#fff');
    bolt.addColorStop(0.6, C.steel1);
    bolt.addColorStop(1, C.steel2);
    g.fillStyle = bolt;
    g.beginPath();
    g.arc(f.pivot.x, f.pivot.y, 6.5, 0, TAU);
    g.fill();
    g.restore();
  }

  _drawPlunger(g) {
    if (this.state !== 'plunge') return;
    const x = G.laneBallX;
    const top = G.laneBaseY - 6;
    const pull = this.power * 26;
    g.save();
    g.strokeStyle = C.steel1;
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const yy = top + 8 + i * 5 + pull * 0.4;
      const xx = x + (i % 2 === 0 ? -8 : 8);
      if (i === 0) g.moveTo(x, top + 4);
      g.lineTo(xx, yy);
    }
    g.stroke();
    g.fillStyle = C.brass;
    rr(g, x - 10, top + 40 + pull * 0.4, 20, 10, 4);
    g.fill();
    g.restore();
  }

  _drawBall(g, ball) {
    const tr = this.trails.get(ball.id) || [];
    const { x, y } = ball.position;
    g.save();
    // İz
    tr.forEach((p, i) => {
      const a = (i / tr.length) * 0.22;
      g.fillStyle = `rgba(232,224,200,${a})`;
      g.beginPath();
      g.arc(p.x, p.y, G.ballR * (0.4 + 0.6 * (i / tr.length)), 0, TAU);
      g.fill();
    });
    // Temas gölgesi (hızla uzar)
    const v = ball.velocity || { x: 0, y: 0 };
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.ellipse(x + 5 + v.x * 0.5, y + 8 + v.y * 0.3, G.ballR * 0.95, G.ballR * 0.6, 0, 0, TAU);
    g.fill();
    // Krom gövde
    const chrome = g.createRadialGradient(x - 4, y - 5, 1, x, y, G.ballR);
    chrome.addColorStop(0, '#ffffff');
    chrome.addColorStop(0.35, '#d9d4c4');
    chrome.addColorStop(0.75, '#7e7a6e');
    chrome.addColorStop(1, '#2c2b27');
    g.fillStyle = chrome;
    g.beginPath();
    g.arc(x, y, G.ballR, 0, TAU);
    g.fill();
    // Ekvator yansıması
    g.strokeStyle = 'rgba(20,40,28,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, G.ballR - 3, 0.5, Math.PI - 0.5);
    g.stroke();
    // Speküler
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.arc(x - 3.8, y - 4.6, 2.6, 0, TAU);
    g.fill();
    g.restore();
  }

  _drawHand(g, t) {
    const p = clamp(1 - (this.holdUntil - t) / 1100, 0, 1);
    const bx = 72;
    const by = 300;
    g.save();
    g.lineWidth = 2.5;
    g.strokeStyle = '#2a2113';
    g.fillStyle = '#d9cfae';
    // Kol
    rr(g, 8, by - 11, 44, 22, 9);
    g.fill();
    g.stroke();
    // Manşet
    g.fillStyle = '#1a1a1a';
    rr(g, 8, by - 13, 12, 26, 4);
    g.fill();
    g.stroke();
    // Avuç
    g.fillStyle = '#e4dabd';
    g.beginPath();
    g.arc(bx - 8, by, 15, 0, TAU);
    g.fill();
    g.stroke();
    // Parmaklar: açıklıktan kapanışa
    g.strokeStyle = '#2a2113';
    g.lineWidth = 5;
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const fy = by - 12 + i * 8;
      const open = 26;
      const closed = 12;
      const reach = open + (closed - open) * p;
      g.beginPath();
      g.moveTo(bx - 2, fy);
      g.quadraticCurveTo(bx + reach, fy - 2, bx + reach + 4, fy + 6 * p);
      g.stroke();
    }
    g.restore();
  }

  _drawParticles(g) {
    if (!this.particles.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      g.globalAlpha = clamp(p.life, 0, 1);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, 2.4 * p.life + 0.6, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  _drawFloaters(g) {
    g.save();
    g.textAlign = 'center';
    g.font = '600 15px Spectral, Georgia, serif';
    for (const f of this.floaters) {
      g.globalAlpha = clamp(f.life, 0, 1);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.restore();
  }

  _drawBanner(g, t) {
    const age = t - this.banner.from;
    const remain = this.banner.until - t;
    const grow = Math.min(1, age / 180);
    const ease = 1 + 0.25 * Math.sin(grow * Math.PI * 0.5) * (1 - grow);
    g.save();
    g.globalAlpha = remain < 300 ? remain / 300 : 1;
    g.translate(240, 360);
    g.scale(ease, ease);
    g.fillStyle = 'rgba(4,6,5,0.85)';
    rr(g, -170, -44, 340, this.banner.sub ? 88 : 66, 12);
    g.fill();
    g.strokeStyle = C.brass;
    g.lineWidth = 2;
    rr(g, -170, -44, 340, this.banner.sub ? 88 : 66, 12);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = C.bone;
    g.font = '800 25px Cinzel, Georgia, serif';
    g.fillText(this.banner.text, 0, -4, 320);
    if (this.banner.sub) {
      g.fillStyle = C.green;
      g.font = '600 13px Cinzel, Georgia, serif';
      g.fillText(this.banner.sub, 0, 22, 320);
    }
    g.restore();
  }

  // ================= DÖNGÜ =================
  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = now();
    const tick = (t) => {
      if (!this.running) return;
      let dt = t - this.lastT;
      this.lastT = t;
      if (!document.hidden) {
        dt = Math.min(dt, 60);
        if (this.state === 'plunge' || this.state === 'flight' || this.state === 'play') {
          this.acc += dt;
          let n = 0;
          const STEP = 1000 / 120;
          while (this.acc >= STEP && n < 4) {
            this._step(STEP);
            this.acc -= STEP;
            n++;
          }
          if (n === 4) this.acc = 0;
        }
        this._frame(dt);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }
}

function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}
