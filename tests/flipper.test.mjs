// Palet sürüş testi: sağ palet yukarı vurmalı, hedefte vızıltı yapmamalı.
// Çalıştırma: npm test  (node --test, ek çerçeve yok)
import test from 'node:test';
import assert from 'node:assert/strict';
import { flipperDrive, flipperTarget, flipperPinOffset } from '../src/game.js';

const REST_L = 0.5;
const ACTIVE_L = -0.5;
const REST_R = Math.PI - 0.5;
const ACTIVE_R = Math.PI + 0.5;

test('hedefler: dinlenme aşağı, vuruş yukarı', () => {
  assert.equal(flipperTarget('L', false), REST_L);
  assert.equal(flipperTarget('L', true), ACTIVE_L);
  assert.ok(Math.abs(flipperTarget('R', false) - REST_R) < 1e-12);
  assert.ok(Math.abs(flipperTarget('R', true) - ACTIVE_R) < 1e-12);
});

test('sağ palet basılınca yukarı süpürür (açı artar)', () => {
  const v = flipperDrive('R', REST_R, true);
  assert.ok(v > 0, `beklenen pozitif hız, alınan ${v}`);
});

test('sol palet basılınca yukarı süpürür (açı azalır)', () => {
  const v = flipperDrive('L', REST_L, true);
  assert.ok(v < 0, `beklenen negatif hız, alınan ${v}`);
});

test('iki palet simetrik güçte vurur', () => {
  const l = Math.abs(flipperDrive('L', REST_L, true));
  const r = Math.abs(flipperDrive('R', REST_R, true));
  assert.ok(Math.abs(l - r) < 1e-12, `sol=${l} sağ=${r}`);
});

test('hedefe varınca sürüş durur (vızıltı yok)', () => {
  assert.equal(flipperDrive('R', ACTIVE_R, true), 0);
  assert.equal(flipperDrive('L', ACTIVE_L, true), 0);
  assert.equal(flipperDrive('R', REST_R, false), 0);
  assert.equal(flipperDrive('L', REST_L, false), 0);
});

test('hedefe yaklaşınca hız yumuşar (aşma yok)', () => {
  const full = Math.abs(flipperDrive('R', REST_R, true));
  const near = Math.abs(flipperDrive('R', ACTIVE_R - 0.1, true));
  assert.ok(near < full, `yakında=${near} tam=${full}`);
  assert.ok(near > 0, 'hedefe varmadan durmamalı');
});

test('bırakınca dinlenmeye döner', () => {
  assert.ok(flipperDrive('R', ACTIVE_R, false) < 0);
  assert.ok(flipperDrive('L', ACTIVE_L, false) > 0);
});

test('açı sarımında da doğru hedefe gider', () => {
  assert.equal(flipperDrive('R', ACTIVE_R + Math.PI * 2, true), 0);
  assert.ok(flipperDrive('R', REST_R + Math.PI * 2, true) > 0);
});

test('pivot ofseti palet ekseni üzerindedir (menteşe kaymaz)', () => {
  const off = 23;
  for (const rest of [REST_L, REST_R]) {
    const o = flipperPinOffset(off, rest);
    // Ofset boyu = kola uzaklık (uçta değil dipte menteşe)
    assert.ok(Math.abs(Math.hypot(o.x, o.y) - off) < 1e-9);
    // Ofset yönü = palet ekseninin tersi (yerel -x, dünyaya döndürülmüş)
    const ex = Math.cos(rest);
    const ey = Math.sin(rest);
    const dot = o.x * ex + o.y * ey;
    assert.ok(Math.abs(dot + off) < 1e-9, `eksen dışı menteşe: ${dot}`);
  }
});

test('sağ pivot ofseti sola bakar (palet duvara gömülmez)', () => {
  const o = flipperPinOffset(23, REST_R);
  assert.ok(o.x > 0, `sağ ofset +x olmalı, alınan ${o.x}`);
});
