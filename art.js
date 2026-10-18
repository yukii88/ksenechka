// art.js — всё, что нарисовано кодом: лилии, сердечки, лепестки.
// Леопард — это фото leopard.jpg, лилии генерируются как SVG прямо в браузере.

const Art = (() => {
  // Генератор «случайных» чисел с зерном: при каждом открытии лилия получается одинаковой.
  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  const f = (n) => Math.round(n * 10) / 10;

  // ---------- Лилия ----------
  // Шесть лепестков (три широких снизу, три узких сверху), красная серединка с крапинками,
  // тычинки. mono — одноцветный силуэт (для сургучной печати).

  let lilyCount = 0;

  function lilySVG(opt) {
    const o = Object.assign({ seed: 3, mono: null, rotate: 15 }, opt || {});
    const r = rng(o.seed);
    const id = 'lily' + ++lilyCount;
    const petal = (L, w) =>
      `M0 0C${w} ${-L * 0.22} ${w * 0.95} ${-L * 0.68} 0 ${-L}C${-w * 0.95} ${-L * 0.68} ${-w} ${-L * 0.22} 0 0Z`;

    const defs = o.mono ? '' :
      `<defs><radialGradient id="${id}" cx="0" cy="0" r="92" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="#7a0b20"/><stop offset=".3" stop-color="#c8193f"/>` +
      `<stop offset=".62" stop-color="#ef8aa0"/><stop offset=".92" stop-color="#fff4f1"/></radialGradient></defs>`;
    const fill = o.mono || `url(#${id})`;

    const layer = (angles, L, w) => angles.map((a) => {
      let s = `<g transform="rotate(${a})"><path d="${petal(L, w)}" fill="${fill}"` +
        (o.mono ? '/>' : ' stroke="#8a1030" stroke-opacity=".25" stroke-width="1"/>');
      if (!o.mono) {
        s += `<path d="M0 -10Q${f(w * 0.12)} ${f(-L * 0.5)} 0 ${f(-L * 0.88)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" fill="none"/>`;
        for (let i = 0; i < 5; i++) {
          s += `<circle cx="${f((r() - 0.5) * w * 0.7)}" cy="${f(-(14 + r() * 32))}" r="${f(0.9 + r() * 1.5)}" fill="#5c0716"/>`;
        }
      }
      return s + '</g>';
    }).join('');

    let body = layer([0, 120, 240], 92, 30) + layer([60, 180, 300], 84, 24);

    if (!o.mono) {
      body += '<circle r="8" fill="#e9f2c0" opacity=".9"/>';
      for (let k = 0; k < 6; k++) {
        const a = ((k * 60 + 20 + r() * 16) * Math.PI) / 180;
        const L = 46 + r() * 10;
        const x = Math.sin(a) * L, y = -Math.cos(a) * L;
        body += `<path d="M0 0Q${f(x * 0.5 + 4)} ${f(y * 0.5)} ${f(x)} ${f(y)}" stroke="#d9e6a8" stroke-width="1.6" fill="none"/>` +
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="5.5" ry="2.4" transform="rotate(${f((a * 180) / Math.PI + 90)} ${f(x)} ${f(y)})" fill="#8b3a10"/>`;
      }
      body += '<path d="M0 0L6 -58" stroke="#c9dc8f" stroke-width="2.2"/><circle cx="6" cy="-59" r="3.6" fill="#b3cf6e"/>';
    }

    return `<svg class="lily" xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">${defs}<g transform="rotate(${o.rotate})">${body}</g></svg>`;
  }

  // Сердечко (для игры и эффектов). Рисуется вокруг точки (0, 0), ширина ~40.
  const HEART_PATH = 'M0 -10C-3 -18 -20 -19 -20 -6C-20 5 -8 11 0 18C8 11 20 5 20 -6C20 -19 3 -18 0 -10Z';

  // ---------- Помощники ----------

  const dataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // Фото леопарда для канваса (скретч-карточки). Загружается один раз.
  let leopardImg = null;
  function leopardImage() {
    if (!leopardImg) {
      leopardImg = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = (window.GIFT_ASSET_BASE || '') + 'leopard.jpg';
      });
    }
    return leopardImg;
  }

  // Слой для эффектов (лепестки, сердечки) поверх всего.
  const fx = () => document.getElementById('fx');

  // Взрыв из сердечек и лепестков в точке (x, y).
  function burst(x, y, n) {
    n = n || 18;
    for (let k = 0; k < n; k++) {
      const p = document.createElement('div');
      if (Math.random() < 0.5) {
        p.className = 'fx-heart';
        p.textContent = '♥';
      } else {
        p.className = 'fx-petal';
      }
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      fx().append(p);
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 110;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 40;
      const rot = (Math.random() - 0.5) * 540;
      p.animate([
        { transform: 'translate(-50%, -50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 90}px)) scale(.8) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
    }
  }

  // Один лепесток медленно падает сверху вниз, покачиваясь.
  function fallingPetal() {
    const p = document.createElement('div');
    p.className = 'fx-petal';
    const s = 0.7 + Math.random() * 0.7;
    const drift = (Math.random() - 0.5) * 160;
    const spin = 360 + Math.random() * 360;
    const H = window.innerHeight + 60;
    p.style.left = Math.random() * window.innerWidth + 'px';
    p.style.top = '-30px';
    fx().append(p);
    p.animate([
      { transform: `translate(0, 0) rotate(0deg) scale(${s})` },
      { transform: `translate(${drift * 0.6 + 30}px, ${H * 0.35}px) rotate(${spin * 0.35}deg) scale(${s})` },
      { transform: `translate(${drift * 0.3 - 30}px, ${H * 0.7}px) rotate(${spin * 0.7}deg) scale(${s})` },
      { transform: `translate(${drift}px, ${H}px) rotate(${spin}deg) scale(${s})` },
    ], { duration: 7000 + Math.random() * 5000, easing: 'linear' }).onfinish = () => p.remove();
  }

  return { lilySVG, HEART_PATH, dataUrl, leopardImage, burst, fallingPetal };
})();
