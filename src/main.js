import './style.css';
import { Game, W, H } from './game.js';
import { Sfx } from './audio.js';
import { redeemCoupon, getVipCode, isVip } from './coupon.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const stage = $('stage');
const hud = $('hud');
const menu = $('menu');
const gameover = $('gameover');
const toastEl = $('toast');
const powerEl = $('power');
const powerFill = $('power-fill');
const plungerBtn = $('btn-plunger');

const sfx = new Sfx();
let toastTimer = 0;

function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('bad', bad);
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

function fmtLives(lives) {
  return lives === Infinity ? '∞' : String(lives);
}

const game = new Game(canvas, {
  sfx,
  setScore: (v) => {
    $('hud-score').textContent = v.toLocaleString('tr-TR');
  },
  setHi: (v) => {
    $('hud-hi').textContent = v.toLocaleString('tr-TR');
  },
  setLives: (v) => {
    $('hud-lives').textContent = fmtLives(v);
  },
  setMultiball: (on) => $('hud-multiball').classList.toggle('hidden', !on),
  setSave: (on) => $('hud-save').classList.toggle('hidden', !on),
  setPower: (p) => {
    powerFill.style.height = `${Math.round(p * 100)}%`;
  },
  showPlunger: (show) => {
    const inGame = menu.classList.contains('hidden') && gameover.classList.contains('hidden');
    plungerBtn.classList.toggle('hidden', !(show && inGame));
    powerEl.classList.toggle('hidden', !(show && inGame));
  },
  toast,
  onGameOver: (score, hi) => {
    $('over-score').textContent = score.toLocaleString('tr-TR');
    $('over-hi').textContent = hi.toLocaleString('tr-TR');
    plungerBtn.classList.add('hidden');
    powerEl.classList.add('hidden');
    gameover.classList.remove('hidden');
  },
});

// ---- Responsive auto-fit ----
function fit() {
  const pad = 10;
  const vw = window.innerWidth - pad;
  const vh = window.innerHeight - pad;
  const scale = Math.min(vw / W, vh / H);
  const cssW = Math.max(200, Math.floor(W * scale));
  const cssH = Math.max(300, Math.floor(H * scale));
  stage.style.width = `${cssW}px`;
  stage.style.height = `${cssH}px`;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 100));
fit();

// ---- Menü / kupon / oyun sonu ----
function refreshVip() {
  const code = getVipCode();
  $('vip-badge').classList.toggle('hidden', !code);
  if (code) $('vip-badge').textContent = `VIP AKTİF: ${code} • SINIRSUZ HAK`;
}

function play() {
  sfx.unlock();
  const vip = isVip();
  menu.classList.add('hidden');
  gameover.classList.add('hidden');
  hud.classList.remove('hidden');
  $('hud-hi').textContent = game.hi.toLocaleString('tr-TR');
  $('hud-lives').textContent = fmtLives(vip ? Infinity : 3);
  game.startGame(vip);
}

$('btn-play').addEventListener('click', play);
$('btn-retry').addEventListener('click', play);
$('btn-menu').addEventListener('click', () => {
  game.toMenu();
  gameover.classList.add('hidden');
  hud.classList.add('hidden');
  plungerBtn.classList.add('hidden');
  powerEl.classList.add('hidden');
  refreshVip();
  menu.classList.remove('hidden');
});

$('coupon-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sfx.unlock();
  const input = $('coupon-input');
  const msg = $('coupon-msg');
  const code = redeemCoupon(input.value);
  if (code) {
    msg.textContent = `${code} kabul edildi: sınırsız hak aktif!`;
    msg.className = 'coupon-msg ok';
    refreshVip();
    toast(`VIP AKTİF: ${code}`);
    sfx.mansion();
    if (game.state !== 'menu' && game.state !== 'gameover') {
      game.lives = Infinity;
      $('hud-lives').textContent = '∞';
    }
  } else {
    msg.textContent = 'Geçersiz kupon kodu.';
    msg.className = 'coupon-msg err';
    toast('GEÇERSİZ KUPON', true);
  }
  input.value = '';
  input.blur();
});

// ---- Ses düğmesi ----
const muteBtn = $('btn-mute');
function refreshMute() {
  muteBtn.textContent = sfx.muted ? 'SES: KAPALI' : 'SES: AÇIK';
}
muteBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.toggleMuted();
  refreshMute();
});
refreshMute();
refreshVip();

// ---- Klavye ----
const keyMap = { ArrowLeft: 'L', KeyZ: 'L', ArrowRight: 'R', KeyM: 'R', Slash: 'R' };
window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  sfx.unlock();
  const side = keyMap[ev.code];
  if (side) {
    game.setFlipper(side, true);
    ev.preventDefault();
    return;
  }
  if (ev.code === 'Space' || ev.code === 'ArrowDown') {
    if (!menu.classList.contains('hidden') || !gameover.classList.contains('hidden')) {
      play();
      ev.preventDefault();
      return;
    }
    game.plungerStart();
    ev.preventDefault();
  }
  if (ev.code === 'Enter' && !menu.classList.contains('hidden')) play();
});
window.addEventListener('keyup', (ev) => {
  const side = keyMap[ev.code];
  if (side) game.setFlipper(side, false);
  if (ev.code === 'Space' || ev.code === 'ArrowDown') game.plungerRelease();
});

// ---- Dokunmatik paletler (sıfır gecikme: touchstart/end) ----
const touchSides = new Map();
function sideOf(touch) {
  const rect = canvas.getBoundingClientRect();
  return touch.clientX - rect.left < rect.width / 2 ? 'L' : 'R';
}
canvas.addEventListener(
  'touchstart',
  (ev) => {
    sfx.unlock();
    ev.preventDefault();
    for (const t of ev.changedTouches) {
      const side = sideOf(t);
      touchSides.set(t.identifier, side);
      game.setFlipper(side, true);
    }
  },
  { passive: false },
);
function endTouch(ev) {
  ev.preventDefault();
  for (const t of ev.changedTouches) {
    const side = touchSides.get(t.identifier);
    if (side) {
      game.setFlipper(side, false);
      touchSides.delete(t.identifier);
    }
  }
}
canvas.addEventListener('touchend', endTouch, { passive: false });
canvas.addEventListener('touchcancel', endTouch, { passive: false });

// Fare ile de palet (masaüstü kolaylığı)
canvas.addEventListener('mousedown', (ev) => {
  sfx.unlock();
  const rect = canvas.getBoundingClientRect();
  game.setFlipper(ev.clientX - rect.left < rect.width / 2 ? 'L' : 'R', true);
});
window.addEventListener('mouseup', () => {
  game.setFlipper('L', false);
  game.setFlipper('R', false);
});

// ---- Yay butonu: çek-bırak (dokunmatik + fare) ----
let dragY0 = 0;
let dragging = false;
function dragPower(clientY) {
  return Math.min(1, Math.max(0, (clientY - dragY0) / 130));
}
plungerBtn.addEventListener(
  'touchstart',
  (ev) => {
    sfx.unlock();
    ev.preventDefault();
    dragging = true;
    dragY0 = ev.changedTouches[0].clientY;
    game.plungerStart();
  },
  { passive: false },
);
plungerBtn.addEventListener(
  'touchmove',
  (ev) => {
    ev.preventDefault();
    if (dragging) game.plungerDrag(dragPower(ev.changedTouches[0].clientY));
  },
  { passive: false },
);
function plungerTouchEnd(ev) {
  ev.preventDefault();
  if (dragging) {
    dragging = false;
    game.plungerRelease();
  }
}
plungerBtn.addEventListener('touchend', plungerTouchEnd, { passive: false });
plungerBtn.addEventListener('touchcancel', plungerTouchEnd, { passive: false });
plungerBtn.addEventListener('mousedown', (ev) => {
  sfx.unlock();
  dragging = true;
  dragY0 = ev.clientY;
  game.plungerStart();
});
window.addEventListener('mousemove', (ev) => {
  if (dragging && game.charging) game.plungerDrag(dragPower(ev.clientY));
});
window.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false;
    game.plungerRelease();
  }
});

// İlk dokunuşta ses kilidini aç
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// Fontlar inince statik masayı tazele (tabela yazıları için)
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => game._bakeStatic()).catch(() => {});
}

// Test/konsol erişimi (zararsız hata ayıklama tutamacı)
window.__tilt = game;

game.start();
