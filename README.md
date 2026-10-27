# TILT — Addams Temalı Pinball

Vite + Vanilla JS + Matter.js ile yazılmış, mobil uyumlu (responsive) pinball oyunu.
Vercel'de web, Capacitor + GitHub Actions ile Android APK olarak çalışır.

## Klasör yapısı

```text
Tilt/
├── index.html                 # Kabuk: canvas, HUD, menü, kupon kutusu, game over
├── package.json               # Tek komut build: npm run build
├── vite.config.js             # base './' (APK + Vercel uyumu)
├── capacitor.config.json      # Capacitor: appId com.tilt.pinball, webDir dist
├── vercel.json                # Vercel build/output ayarı
├── public/
│   ├── icon.svg               # Uygulama ikonu
│   └── manifest.webmanifest   # PWA bildirimi
├── src/
│   ├── main.js                # Giriş: ekran uyumu, klavye/dokunmatik, menü/HUD
│   ├── game.js                # Masa: Matter.js fizik + katmanlı Canvas 2D çizim
│   ├── audio.js               # Web Audio ile sentetik retro sesler
│   ├── coupon.js              # Kupon/VIP + localStorage
│   └── style.css              # Gotik tema, HUD, overlay stilleri
└── .github/workflows/
    └── build-apk.yml          # Push'ta APK derler, Releases'e yükler
```

## Hızlı başla

```bash
npm install
npm run dev      # geliştirme: http://localhost:5173
npm run build    # üretim: dist/
npm run preview  # dist önizleme
```

## Kontroller

- Sol/sağ palet: `◀` / `▶` veya `Z` / `M`. Mobilde ekranın alt yarısına dokun.
- Yay: `BOŞLUK` basılı tut-bırak. Mobilde **YAYI ÇEK** butonunu aşağı sürükle-bırak.

## Kupon sistemi

- Normal oyuncu 3 hakla başlar, hak bitince **GAME OVER**.
- Menüdeki kupon kutusuna `POLAT` veya `LUTFI` yaz (büyük/küçük harf fark etmez).
- Kod doğruysa VIP bildirimi çıkar, hak `∞` olur, top düşse bile oyun bitmez.
- VIP durumu `localStorage`da saklanır; yenileme/APK yeniden açılışında korunur.

## Masa özellikleri

- Merkezde Addams Konağı: A-D-M hedefleri tamamlanınca konak aydınlanır.
- **Thing**: sol üst rampaya giren topu yakalar, gizli geçitten sağ kulvara atar.
- **Elektrikli sandalye**: konak tamamlanınca 5 sn mıknatıs topu çeker.
- **Multiball**: konak tamamlanınca 3 top aynı anda sahada, skor x2.
- 5 sn top kurtarıcı, bumper/sling parlamaları, parçacıklar, ekran sarsıntısı.

## Vercel deploy

Repo'yu Vercel'e bağla; `vercel.json` sayesinde build komutu otomatik `npm run build`,
çıktı `dist` olur. Ek ayar gerekmez.

## Android APK

`main`/`master` branch'e her push'ta Actions otomatik derler:

1. `npm ci` + `npm run build`
2. `npx cap add android` (yoksa) + `npx cap sync android`
3. `./gradlew assembleDebug`
4. APK hem Artifacts'e hem de **Releases** sayfasına `build-<sayı>` etiketiyle yüklenir.

Yerelde denemek için:

```bash
npm run android:sync
npx cap open android
```

## Notlar

- Fizik 120 Hz alt adımlarla işler; top hız tavanı ve güvenlik ağı sayesinde
  harita dışına çıkamaz.
- Sesler tamamen Web Audio osilatörleriyle üretilir, dosya gerektirmez.
