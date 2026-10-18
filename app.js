// app.js — логика квеста. Этапы идут по очереди:
//   0 конверт с замком → 1 квиз → 2 мини-игра → 3 коробка → 4 скретч-фото → 5 вопрос → 6 письмо
// Всё личное (имя, вопросы, фото, письмо) приходит из зашифрованного secret.json.
// Если secret.json нет — включается демо-режим с заглушками (удобно для проверки).

(function () {
  'use strict';

  const $app = document.getElementById('app');
  const $progress = document.getElementById('progress');

  // localStorage в приватном режиме Safari может бросать ошибку — оборачиваем.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ничего страшного */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ничего страшного */ } },
  };

  // Заглушки для демо-режима. Настоящее содержимое — в private/content.js.
  const DEMO = {
    name: 'Любимая',
    envelope: 'Для самой любимой',
    quiz: [
      { q: 'Где мы впервые встретились?', options: ['Вариант 1 (правильный)', 'Вариант 2', 'Вариант 3'], answer: 0 },
      { q: 'Какие у тебя любимые цветы?', options: ['Розы', 'Лилии', 'Ромашки'], answer: 1, right: 'Конечно, лилии 🤍' },
      { q: 'Кто из нас первым написал?', options: ['Я', 'Ты'], answer: 0 },
    ],
    gameGoal: 15,
    box: {
      text: 'Здесь будет твоё послание из коробки 🎁',
      coupon: { title: 'На любое желание', note: '(хотя купон для этого и не нужен)', fine: 'Срок действия: всегда', tip: 'Сделай скриншот, чтобы не потерять 😉' },
    },
    memories: [
      { photo: null, caption: 'Здесь будет ваше фото и подпись к нему' },
      { photo: null, caption: 'И ещё одно воспоминание' },
    ],
    question: 'Ты останешься со мной навсегда?',
    letter: 'Это демо-письмо.\n\nЗдесь будет твой настоящий текст — его пишешь ты в private/content.js, а потом шифруешь.\n\nОн печатается вот так, буква за буквой, а сверху падают лепестки лилий.',
    signature: 'С любовью ♡',
  };

  const RIGHT = ['Правильно! 💞', 'Умничка 🐆', 'Конечно! 😌❤️', 'Точно в сердечко 💘'];
  const WRONG = ['Эй, ты это точно помнишь? 😼', 'Не-а, попробуй ещё 🙈', 'Холодно-холодно ❄️', 'Мимо, но я всё равно тебя люблю 💋'];

  const STAGES = [stageEnvelope, stageQuiz, stageGame, stageBox, stageMemories, stageQuestion, stageLetter];

  // Титры перед каждой сценой, как в кино: [надзаголовок, название, подпись]
  const CHAPTERS = [
    ['Премьера', 'Для тебя', 'история в семи сценах'],
    ['Сцена I', 'Экзамен', 'насколько хорошо ты помнишь мелкие детали из нашей истории'],
    ['Сцена II', 'Охота на лилии', 'проверим, насколько у тебя быстрые руки'],
    ['Сцена III', 'Сюрприз', 'внутри кое-что есть'],
    ['Сцена IV', 'Кадры', 'моменты, которые я храню'],
    ['Сцена V', 'Главный вопрос', 'ответ только один'],
    ['Финал', 'Письмо', 'от меня — тебе'],
  ];

  let C = null;        // расшифрованное содержимое
  let secret = null;   // зашифрованный secret.json (null → демо-режим)
  let cleanup = null;  // «убрать за собой» у текущего этапа (таймеры, слушатели)

  // ---------- Помощники ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Видео в карточках: определяем по расширению файла или по data:video.
  const isVideo = (src) => /^data:video\//.test(src) || /\.(mp4|mov|m4v|webm)$/i.test(src);

  // На айфоне видео надёжнее всего играет из blob-ссылки (а не из data: или с простого сервера).
  const blobCache = new Map();
  function playableSrc(src) {
    if (!isVideo(src)) return Promise.resolve(src);
    if (!blobCache.has(src)) {
      blobCache.set(src, fetch(src).then((r) => r.blob()).then((b) => URL.createObjectURL(b)).catch(() => src));
    }
    return blobCache.get(src);
  }

  // Перезапустить CSS-анимацию (класс shake, pop и т.п.)
  function replay(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function centerOf(node) {
    const r = node.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  // ---------- Переходы между этапами ----------

  // Сцену без содержимого (нет вопросов / нет воспоминаний) пропускаем вместе с титрами.
  function isEmpty(i) {
    return (i === 1 && !(C.quiz || []).length) || (i === 4 && !(C.memories || []).length);
  }

  let goToken = 0;

  function go(i) {
    if (C && isEmpty(i)) return go(i + 1);
    const token = ++goToken;
    store.set('gift.stage', String(i));
    // Сначала титры закрывают экран, под ними меняется сцена, потом титры растворяются.
    showChapter(i, () => {
      if (token !== goToken) return;
      if (cleanup) { cleanup(); cleanup = null; }
      renderProgress(i);
      const screen = document.createElement('section');
      screen.className = 'screen';
      $app.replaceChildren(screen);
      STAGES[i](screen, () => go(i + 1));
    });
  }

  function showChapter(i, onCovered) {
    const [kicker, title, sub] = CHAPTERS[i];
    const ov = el(`
      <div class="chapter">
        <p class="ch-kicker">${kicker}</p>
        <h1 class="ch-title">${title}</h1>
        <p class="ch-sub">${sub}</p>
      </div>`);
    document.body.append(ov);
    let covered = false, finished = false;
    const finish = () => {
      if (!covered || finished) return;
      finished = true;
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 1000);
    };
    setTimeout(() => { covered = true; onCovered(); }, 650);
    // Держим титры, пока подпись спокойно читается: чем она длиннее, тем дольше (4,3–5,5 с).
    setTimeout(finish, 3800 + sub.length * 30);
    ov.addEventListener('click', finish); // нажатие — пропустить титры
  }

  function renderProgress(i) {
    $progress.innerHTML = STAGES.map((_, k) =>
      `<span class="pp${k < i ? ' done' : ''}${k === i ? ' now' : ''}"></span>`).join('');
  }

  // Айфон: запрещаем случайный «щипок» для увеличения страницы (мешает в игре и при стирании).
  ['gesturestart', 'gesturechange'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

  async function start() {
    // Предпросмотр (tools/preview.html): содержимое берётся прямо из private/content.js, без шифрования.
    if (window.PREVIEW_CONTENT) {
      C = JSON.parse(JSON.stringify(window.PREVIEW_CONTENT));
      for (const o of [...(C.quiz || []), ...(C.memories || [])]) {
        if (Array.isArray(o.photo)) o.photo = o.photo.map((p) => '../private/photos/' + p);
        else if (o.photo) o.photo = '../private/photos/' + o.photo;
      }
      document.body.append(el('<div class="demo-badge">предпросмотр · только на этом компьютере</div>'));
      const stage = Number(store.get('gift.stage')) || 0;
      return go(Math.min(Math.max(stage, 0), STAGES.length - 1));
    }

    try {
      const res = await fetch('secret.json', { cache: 'no-cache' });
      if (res.ok) secret = await res.json();
    } catch (e) { /* файла нет → демо */ }

    const saved = store.get('gift.key');
    if (!secret) {
      document.body.append(el('<div class="demo-badge">демо · нет secret.json</div>'));
      if (saved === 'demo') C = DEMO;
    } else if (saved && saved !== 'demo') {
      // Ключ уже запомнен на этом телефоне — пароль второй раз не нужен.
      try {
        C = await GiftCrypto.decryptWithKey(secret, await GiftCrypto.importKey(saved));
      } catch (e) {
        store.del('gift.key'); // secret.json поменялся — нужен пароль заново
      }
    }

    const stage = C ? Number(store.get('gift.stage')) || 0 : 0;
    go(Math.min(Math.max(stage, 0), STAGES.length - 1));
  }

  // ---------- 0. Конверт с замком ----------

  function stageEnvelope(screen, next) {
    screen.innerHTML = `
      <div class="envelope">
        <div class="env-back"></div>
        <div class="env-lining"></div>
        <div class="env-letter">${Art.lilySVG()}</div>
        <div class="env-front"><div class="shape"></div><div class="env-to"></div></div>
        <div class="env-flap"><div class="shape"></div></div>
        <button class="seal" aria-label="Открыть письмо">${Art.lilySVG({ mono: 'rgba(255,236,226,.5)' })}</button>
      </div>
      <div class="card framed lock"></div>`;

    const env = screen.querySelector('.envelope');
    const seal = screen.querySelector('.seal');
    const card = screen.querySelector('.lock');

    function showLocked() {
      const hint = secret ? secret.hint : 'демо-режим: подойдёт любое слово';
      card.innerHTML = `
        <form class="lock-form" autocomplete="off">
          <p class="eyebrow">Письмо под замком</p>
          <h2>Скажи секретное слово</h2>
          ${hint ? `<p class="muted">Подсказка: ${esc(hint)}</p>` : ''}
          <input class="field" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="секретное слово">
          <button class="btn" type="submit">Открыть</button>
          <p class="lock-error"></p>
        </form>`;
      const form = card.querySelector('form');
      const input = card.querySelector('input');
      const btn = card.querySelector('button');
      const err = card.querySelector('.lock-error');

      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!input.value.trim()) { replay(card, 'shake'); input.focus(); return; }
        btn.disabled = true;
        btn.textContent = 'Открываю…';
        seal.classList.add('thinking');
        err.textContent = '';
        try {
          if (secret) {
            const res = await GiftCrypto.unlock(secret, input.value);
            C = res.content;
            store.set('gift.key', await GiftCrypto.exportKey(res.key));
          } else {
            C = DEMO;
            store.set('gift.key', 'demo');
          }
          input.blur();
          showUnlocked();
        } catch (ex) {
          // Без https айфон не даёт расшифровывать — честно говорим об этом, а не «неверный пароль».
          err.textContent = window.crypto && crypto.subtle
            ? 'Не то слово… попробуй ещё 💋'
            : 'Открой ссылку, которая начинается с https://';
          replay(card, 'shake');
          btn.disabled = false;
          btn.textContent = 'Открыть';
        }
        seal.classList.remove('thinking');
      };
    }

    function showUnlocked() {
      screen.querySelector('.env-to').textContent = C.envelope || 'Для тебя';
      card.innerHTML = `<p class="eyebrow">Это тебе</p><h2>Сломай печать</h2><p class="muted">просто нажми на неё</p>`;
      replay(card, 'pop');
      seal.classList.add('ready');
    }

    seal.onclick = () => {
      if (!C) {
        replay(card, 'shake');
        const input = card.querySelector('input');
        if (input) input.focus();
        return;
      }
      if (env.classList.contains('open')) return;
      env.classList.add('open');
      // Когда клапан перевернулся, прячем его за письмо, чтобы письмо «выехало» поверх.
      setTimeout(() => env.classList.add('flipped'), 350);
      card.classList.add('fade-out');
      setTimeout(() => Art.burst(...centerOf(env), 24), 500);
      setTimeout(next, 1900);
    };

    if (C) showUnlocked(); else showLocked();
  }

  // ---------- 1. Квиз ----------

  function stageQuiz(screen, next) {
    const qs = C.quiz || [];
    if (!qs.length) return next();
    let i = 0;
    const card = el('<div class="card framed quiz"></div>');
    screen.append(card);

    function show() {
      const q = qs[i];
      card.innerHTML = `
        <p class="eyebrow">Маленький экзамен · ${i + 1} из ${qs.length}</p>
        <h2 class="${q.q.length > 55 ? 'long' : ''}">${esc(q.q)}</h2>
        <div class="options"></div>
        <p class="reaction"></p>`;
      const box = card.querySelector('.options');
      const react = card.querySelector('.reaction');
      let done = false;

      q.options.forEach((text, k) => {
        const b = el(`<button class="option">${esc(text)}</button>`);
        b.onclick = (ev) => {
          if (done) return;
          if (k === q.answer) {
            done = true;
            b.classList.add('right');
            react.textContent = q.right || pick(RIGHT);
            Art.burst(ev.clientX || centerOf(b)[0], ev.clientY || centerOf(b)[1]);
            const goOn = () => { i++; if (i < qs.length) show(); else finish(); };
            if (q.photo) {
              // Фото-воспоминание «проявляется» после верного ответа, дальше — по кнопке.
              box.querySelectorAll('.option:not(.right)').forEach((o) => o.classList.add('gone'));
              react.insertAdjacentHTML('afterend', `
                <figure class="quiz-photo">
                  <img src="${esc(q.photo)}" alt="">
                  ${q.photoCaption ? `<figcaption>${esc(q.photoCaption)}</figcaption>` : ''}
                </figure>
                <button class="btn">Дальше</button>`);
              const next = card.querySelector('.btn');
              next.onclick = goOn;
              setTimeout(() => next.scrollIntoView({ behavior: 'smooth', block: 'end' }), 900);
            } else {
              setTimeout(goOn, 3500); // даём спокойно прочитать реакцию
            }
          } else {
            b.classList.add('wrong');
            b.disabled = true;
            react.textContent = q.wrong || pick(WRONG);
            replay(card, 'shake');
          }
        };
        box.append(b);
      });
      replay(card, 'pop');
    }

    function finish() {
      card.innerHTML = `
        <p class="eyebrow">Результат</p>
        <h2>${esc(C.name ? C.name + ', ты' : 'Ты')} помнишь всё до мелочей 💯</h2>
        <p class="muted">Кто бы сомневался 🐆</p>
        <button class="btn">Дальше</button>`;
      card.querySelector('.btn').onclick = next;
      replay(card, 'pop');
    }

    show();
  }

  // ---------- 2. Мини-игра: лови лилии и сердечки ----------

  function stageGame(screen, next) {
    const GOAL = C.gameGoal || 15;
    screen.classList.add('game-screen');
    screen.innerHTML = `
      <canvas class="game-canvas"></canvas>
      <div class="hud" hidden><span class="score">0 / ${GOAL}</span></div>
      <div class="card framed game-card">
        <p class="eyebrow">Мини-игра</p>
        <h2>Лови лилии и сердечки</h2>
        <p class="muted">Нажимай на них, пока падают. Нужно поймать ${GOAL}.<br>Чёрные колючки не трогай!</p>
        <button class="btn">Начать</button>
      </div>`;

    const canvas = screen.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const hud = screen.querySelector('.hud');
    const scoreEl = screen.querySelector('.score');
    const card = screen.querySelector('.game-card');
    const lily = new Image();
    lily.src = Art.dataUrl(Art.lilySVG());
    const heart = new Path2D(Art.HEART_PATH);

    let W = 0, H = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = screen.clientWidth;
      H = screen.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    let items = [], sparks = [], score = 0, running = false, last = 0, spawnIn = 0, flash = 0, raf = 0;

    function spawn() {
      const r = Math.random();
      const type = score >= 3 && r < 0.15 ? 'thorn' : r < 0.6 ? 'lily' : 'heart';
      const size = type === 'lily' ? 62 : 44;
      items.push({
        type, size,
        x: size / 2 + Math.random() * (W - size),
        y: -size,
        vy: 95 + Math.random() * 60 + score * 6,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 1.6,
        sway: Math.random() * 6,
      });
    }

    function draw(it) {
      ctx.save();
      ctx.translate(it.cx, it.y);
      ctx.rotate(it.rot * 0.4);
      const s = it.size;
      if (it.type === 'lily') {
        ctx.drawImage(lily, -s / 2, -s / 2, s, s);
      } else if (it.type === 'heart') {
        ctx.scale(s / 40, s / 40);
        ctx.fillStyle = '#c8193f';
        ctx.shadowColor = 'rgba(80,0,10,.35)';
        ctx.shadowBlur = 6;
        ctx.fill(heart);
      } else {
        ctx.beginPath();
        for (let k = 0; k < 18; k++) {
          const a = (k * Math.PI) / 9, rr = k % 2 ? s * 0.2 : s * 0.5;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = '#0d0707';
        ctx.shadowColor = 'rgba(208,20,44,.8)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(216,179,106,.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    function frame(t) {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (running) {
        spawnIn -= dt;
        if (spawnIn <= 0) { spawn(); spawnIn = Math.max(0.4, 0.9 - score * 0.03); }
      }
      ctx.clearRect(0, 0, W, H);
      if (flash > 0) {
        ctx.fillStyle = `rgba(208,20,44,${flash * 0.3})`;
        ctx.fillRect(0, 0, W, H);
        flash -= dt * 2;
      }
      items = items.filter((it) => it.y < H + it.size);
      for (const it of items) {
        it.y += it.vy * dt;
        it.rot += it.vr * dt;
        it.sway += dt * 2;
        it.cx = it.x + Math.sin(it.sway) * 12;
        draw(it);
      }
      sparks = sparks.filter((s) => s.life > 0);
      for (const s of sparks) {
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 300 * dt;
        ctx.globalAlpha = Math.max(s.life / 0.7, 0);
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    function sparkle(x, y, colors) {
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 160;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, r: 2 + Math.random() * 3, life: 0.7, c: pick(colors) });
      }
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!running) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bestD = Infinity;
      for (const it of items) {
        const d = Math.hypot(it.cx - x, it.y - y);
        if (d < it.size * 0.75 && d < bestD) { best = it; bestD = d; }
      }
      if (!best) return;
      items.splice(items.indexOf(best), 1);
      if (best.type === 'thorn') {
        score = Math.max(0, score - 1);
        flash = 1;
        sparkle(best.cx, best.y, ['#1c110a', '#3b2416']);
        replay(hud, 'shake');
      } else {
        score++;
        sparkle(best.cx, best.y, ['#c8193f', '#ef8aa0', '#fff4f1', '#e9c46a']);
      }
      scoreEl.textContent = `${score} / ${GOAL}`;
      if (score >= GOAL) win();
    });

    function win() {
      running = false;
      items.forEach((it) => sparkle(it.cx, it.y, ['#c8193f', '#ef8aa0', '#fff4f1']));
      items = [];
      setTimeout(() => {
        hud.hidden = true;
        card.innerHTML = `
          <p class="eyebrow">Победа</p>
          <h2>Умничка! 🐆</h2>
          <p class="muted">Все ${GOAL} пойманы. Руки быстрые… я запомнил 😏</p>
          <button class="btn">Дальше</button>`;
        card.hidden = false;
        replay(card, 'pop');
        card.querySelector('.btn').onclick = next;
      }, 700);
    }

    card.querySelector('.btn').onclick = () => {
      card.hidden = true;
      hud.hidden = false;
      running = true;
    };

    raf = requestAnimationFrame((t) => { last = t; frame(t); });
    cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }

  // ---------- 3. Коробка-подарок ----------

  function stageBox(screen, next) {
    const NEED = 7;
    screen.innerHTML = `
      <div class="card framed box-card">
        <p class="eyebrow">Сюрприз</p>
        <h2>Тут что-то есть…</h2>
        <p class="muted">Постучи по коробке или потряси телефон</p>
        <div class="hearts">${'<span>♥</span>'.repeat(NEED)}</div>
      </div>
      <div class="gift" role="button" aria-label="Коробка">
        <div class="gift-lid"><div class="bow"><i></i></div></div>
        <div class="gift-body"></div>
        <div class="gift-surprise">${Art.lilySVG({ seed: 4 })}</div>
      </div>
      <button class="btn btn-ghost shake-btn" hidden>Включить тряску</button>`;

    const card = screen.querySelector('.box-card');
    const gift = screen.querySelector('.gift');
    const hearts = screen.querySelectorAll('.hearts span');
    const shakeBtn = screen.querySelector('.shake-btn');
    // Раньше в коробке была просто строка — поддерживаем и такой вариант.
    const box = typeof C.box === 'string' ? { text: C.box } : (C.box || {});
    let hits = 0, opened = false, lastShake = 0;

    function hit() {
      if (opened) return;
      hits++;
      hearts[hits - 1].classList.add('on');
      replay(gift, 'wiggle');
      if (hits >= NEED) open();
    }

    function open() {
      opened = true;
      shakeBtn.hidden = true;
      gift.classList.add('open');
      setTimeout(() => {
        const r = gift.getBoundingClientRect();
        Art.burst(r.left + r.width / 2, r.top + r.height * 0.4, 40);
      }, 300);
      setTimeout(() => {
        card.innerHTML = `
          <p class="eyebrow">Внутри было…</p>
          <p class="big">${esc(box.text)}</p>
          <button class="btn">${box.coupon ? 'Там есть что-то ещё…' : 'Дальше'}</button>`;
        card.querySelector('.btn').onclick = box.coupon ? showCoupon : next;
        replay(card, 'pop');
      }, 900);
    }

    // Купон выезжает из коробки вторым сюрпризом.
    function showCoupon() {
      const c = box.coupon;
      card.innerHTML = `
        <p class="eyebrow">А ещё — вот это</p>
        <div class="coupon-wrap">
          <div class="coupon">
            <div class="coupon-stub"><span>№ 0001</span></div>
            <div class="coupon-main">
              <p class="coupon-kicker">Подарочный купон</p>
              <p class="coupon-title">${esc(c.title)}</p>
              ${c.note ? `<p class="coupon-note">${esc(c.note)}</p>` : ''}
              ${c.fine ? `<p class="coupon-fine">${esc(c.fine)}</p>` : ''}
            </div>
          </div>
        </div>
        ${c.tip ? `<p class="muted">${esc(c.tip)}</p>` : ''}
        <button class="btn">Дальше</button>`;
      card.querySelector('.btn').onclick = next;
      replay(card, 'pop');
      setTimeout(() => Art.burst(...centerOf(card.querySelector('.coupon')), 26), 600);
    }

    gift.addEventListener('pointerdown', hit);

    // Тряска телефона. На айфоне нужно отдельное разрешение, и спросить его можно только по нажатию.
    function onMotion(e) {
      let m;
      const a = e.acceleration;
      if (a && a.x != null) {
        m = Math.hypot(a.x, a.y, a.z);
      } else {
        const g = e.accelerationIncludingGravity;
        if (!g || g.x == null) return;
        m = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.8);
      }
      const now = performance.now();
      if (m > 13 && now - lastShake > 350) {
        lastShake = now;
        hit();
      }
    }

    if ('DeviceMotionEvent' in window) {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        shakeBtn.hidden = false;
        shakeBtn.onclick = async () => {
          shakeBtn.disabled = true;
          try {
            if (await DeviceMotionEvent.requestPermission() === 'granted') {
              window.addEventListener('devicemotion', onMotion);
              shakeBtn.textContent = 'Тряси!';
            } else {
              shakeBtn.textContent = 'Тогда просто стучи';
            }
          } catch (e) {
            shakeBtn.hidden = true;
          }
        };
      } else {
        window.addEventListener('devicemotion', onMotion);
      }
    }

    cleanup = () => window.removeEventListener('devicemotion', onMotion);
  }

  // ---------- 4. Воспоминания: стереть пальцем леопардовый слой ----------

  async function stageMemories(screen, next) {
    const list = C.memories || [];
    if (!list.length) return next();
    let i = 0;
    const card = el('<div class="card framed mem"></div>');
    screen.append(card);
    const pattern = await Art.leopardImage();
    if (document.fonts) await document.fonts.ready;

    // Если в карточке несколько фото — после открытия они сменяют друг друга.
    let slideTimer = 0;
    cleanup = () => clearInterval(slideTimer);

    async function show() {
      clearInterval(slideTimer);
      const m = list[i];
      const last = i + 1 >= list.length;
      const srcs = [].concat(m.photo || []); // одно фото или список фото
      const video = srcs.length === 1 && isVideo(srcs[0]);
      const urls = await Promise.all(srcs.map(playableSrc));
      const multi = urls.length > 1;
      let media = `<div class="no-photo">${Art.lilySVG()}</div>`;
      if (video) {
        // #t=0.001 — чтобы айфон показал первый кадр, пока видео на паузе
        media = `<video src="${esc(urls[0])}#t=0.001" playsinline muted loop preload="auto"></video>`;
      } else if (urls.length) {
        media = urls.map((u, k) =>
          `<img class="${k === 0 ? 'on' : ''}" src="${esc(u)}" alt="" onerror="this.outerHTML='<div class=&quot;no-photo&quot;>нет фото</div>'">`).join('');
      }
      card.innerHTML = `
        <p class="eyebrow">Наши моменты · ${i + 1} из ${list.length}</p>
        <div class="scratch${video ? ' is-video' : ''}">
          <div class="scratch-under${multi ? ' multi' : ''}">${media}</div>
          <canvas></canvas>
          ${multi ? `<div class="slide-dots" hidden>${urls.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        </div>
        <p class="caption">${m.title ? `<span class="caption-title">${esc(m.title)}</span>` : ''}${esc(m.caption)}</p>
        <button class="btn" hidden>${last ? 'Дальше' : 'Следующее воспоминание'}</button>`;
      replay(card, 'pop');

      const wrapEl = card.querySelector('.scratch');
      const cv = wrapEl.querySelector('canvas');
      const cx = cv.getContext('2d');
      const btn = card.querySelector('.btn');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cx.scale(dpr, dpr);

      // Рисуем «защитный слой»: кусок леопардового фото (у каждой карточки свой) + надпись.
      const k = Math.max(w / pattern.width, h / pattern.height) * 1.6;
      const pw = pattern.width * k, ph = pattern.height * k;
      const ox = ((i * 0.37) % 1) * (w - pw), oy = ((i * 0.61) % 1) * (h - ph);
      cx.drawImage(pattern, ox, oy, pw, ph);
      const shade = cx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
      shade.addColorStop(0, 'rgba(10,4,4,.15)');
      shade.addColorStop(1, 'rgba(10,4,4,.6)');
      cx.fillStyle = shade;
      cx.fillRect(0, 0, w, h);
      cx.textAlign = 'center';
      cx.fillStyle = '#f6ecdc';
      cx.shadowColor = 'rgba(0,0,0,.85)';
      cx.shadowBlur = 14;
      cx.font = 'italic 700 30px "Playfair Display", Georgia, serif';
      cx.fillText('сотри меня', w / 2, h / 2);
      cx.font = '600 11px "Cormorant Garamond", Georgia, serif';
      cx.fillStyle = '#d8b36a';
      cx.fillText('П А Л Ь Ц Е М', w / 2, h / 2 + 28);
      cx.shadowBlur = 0;

      // Дальше рисуем «ластиком».
      cx.globalCompositeOperation = 'destination-out';
      cx.lineCap = 'round';
      cx.lineJoin = 'round';
      const BRUSH = 46;
      cx.lineWidth = BRUSH;

      // Сколько стёрто — считаем по сетке клеток, а не по пикселям (так проще и быстрее).
      const COLS = 16, ROWS = 20;
      const cells = new Uint8Array(COLS * ROWS);
      let cleared = 0, revealed = false, drawing = false, lx = 0, ly = 0;

      function mark(x, y) {
        const cw = w / COLS, ch = h / ROWS, R = BRUSH / 2;
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const k = r * COLS + c;
            if (!cells[k] && Math.hypot((c + 0.5) * cw - x, (r + 0.5) * ch - y) < R) { cells[k] = 1; cleared++; }
          }
        }
      }

      function scratchTo(x, y) {
        cx.beginPath();
        cx.moveTo(lx, ly);
        cx.lineTo(x, y);
        cx.stroke();
        const steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / 8));
        for (let s = 1; s <= steps; s++) mark(lx + ((x - lx) * s) / steps, ly + ((y - ly) * s) / steps);
        lx = x;
        ly = y;
        if (!revealed && cleared / cells.length > 0.55) reveal();
      }

      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };

      cv.addEventListener('pointerdown', (e) => {
        drawing = true;
        cv.setPointerCapture(e.pointerId);
        [lx, ly] = pos(e);
        cx.beginPath();
        cx.arc(lx, ly, BRUSH / 2, 0, Math.PI * 2);
        cx.fill();
        mark(lx, ly);
      });
      cv.addEventListener('pointermove', (e) => { if (drawing) scratchTo(...pos(e)); });
      cv.addEventListener('pointerup', () => { drawing = false; });
      cv.addEventListener('pointercancel', () => { drawing = false; });

      function reveal() {
        revealed = true;
        cv.classList.add('gone');
        card.querySelector('.caption').classList.add('show');
        btn.hidden = false;
        Art.burst(...centerOf(wrapEl), 22);
        if (video) playVideo();
        if (multi) startSlides();
      }

      // Несколько фото: плавно сменяются каждые 2,6 секунды, точки показывают, какое сейчас.
      function startSlides() {
        const imgs = wrapEl.querySelectorAll('.scratch-under img');
        const dots = wrapEl.querySelectorAll('.slide-dots i');
        wrapEl.querySelector('.slide-dots').hidden = false;
        let k = 0;
        slideTimer = setInterval(() => {
          imgs[k].classList.remove('on');
          dots[k].classList.remove('on');
          k = (k + 1) % imgs.length;
          imgs[k].classList.add('on');
          dots[k].classList.add('on');
        }, 2600);
      }

      // Видео играет по кругу без звука.
      function playVideo() {
        const v = wrapEl.querySelector('video');
        if (!v) return;
        v.muted = true;
        v.play().catch(() => {});
      }

      btn.onclick = () => {
        i++;
        if (i < list.length) show(); else next();
      };
    }

    show();
  }

  // ---------- 5. Вопрос с убегающей кнопкой «Нет» ----------

  function stageQuestion(screen, next) {
    const NO = ['Нет', 'Точно?', 'Подумай ещё', 'Ну пожалуйста 🥺', 'Не поймаешь 😜', 'Кнопка сломалась', 'Попробуй другую 😏', 'Ладно, сдаюсь'];
    screen.innerHTML = `
      <div class="card framed ask">
        <div class="ask-lily">${Art.lilySVG()}</div>
        <h2>${esc(C.question)}</h2>
        <div class="ask-btns">
          <button class="btn yes">Да ❤️</button>
          <button class="btn btn-ghost no">Нет</button>
        </div>
      </div>`;

    const card = screen.querySelector('.ask');
    const yes = screen.querySelector('.yes');
    const no = screen.querySelector('.no');
    let tries = 0, scale = 1, answered = false, lastFlee = 0;

    function flee(e) {
      if (answered || no.classList.contains('surrender')) return;
      if (e && e.cancelable) e.preventDefault();
      // Наведение мышкой и нажатие приходят почти одновременно — считаем их за одну попытку.
      if (performance.now() - lastFlee < 300) return;
      lastFlee = performance.now();
      tries++;
      scale = Math.min(scale + 0.14, 2.1);
      yes.style.transform = `scale(${scale})`;

      if (tries >= NO.length) {
        // «Нет» сдаётся и превращается во второе «Да».
        no.textContent = 'Да 💕';
        no.classList.remove('btn-ghost');
        no.classList.add('surrender');
        return;
      }
      no.textContent = NO[tries];

      // Кнопка переезжает в случайное место экрана, подальше от пальца.
      if (no.parentElement !== screen) {
        const r = no.getBoundingClientRect();
        screen.append(no);
        no.classList.add('flying');
        no.style.left = r.left + 'px';
        no.style.top = r.top + 'px';
      }
      const bw = no.offsetWidth, bh = no.offsetHeight, pad = 16;
      const fx = e && e.clientX != null ? e.clientX : window.innerWidth / 2;
      const fy = e && e.clientY != null ? e.clientY : window.innerHeight / 2;
      let x = 0, y = 0;
      for (let guard = 0; guard < 25; guard++) {
        x = pad + Math.random() * Math.max(0, screen.clientWidth - bw - 2 * pad);
        y = 60 + Math.random() * Math.max(0, screen.clientHeight - bh - 60 - pad);
        if (Math.hypot(x + bw / 2 - fx, y + bh / 2 - fy) > 150) break;
      }
      no.style.left = x + 'px';
      no.style.top = y + 'px';
    }

    no.addEventListener('pointerdown', flee);
    no.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') flee(e); });
    no.addEventListener('click', () => { if (no.classList.contains('surrender')) sayYes(no); });
    yes.addEventListener('click', () => sayYes(yes));

    function sayYes(btn) {
      if (answered) return;
      answered = true;
      const [x, y] = centerOf(btn);
      Art.burst(x, y, 50);
      setTimeout(() => Art.burst(window.innerWidth / 2, window.innerHeight / 3, 30), 300);
      if (no.parentElement === screen) no.remove();
      card.innerHTML = `
        <div class="ask-lily">${Art.lilySVG({ seed: 8 })}</div>
        <h2>Ура! 💞</h2>
        <p class="muted">Другого ответа и не ждали 😌</p>`;
      replay(card, 'pop');
      setTimeout(next, 2300);
    }
  }

  // ---------- 6. Письмо от сердца ----------

  function stageLetter(screen, next) {
    screen.classList.add('letter-screen');
    screen.innerHTML = `
      <article class="paper">
        <div class="corner tl">${Art.lilySVG({ seed: 5 })}</div>
        <div class="corner br">${Art.lilySVG({ seed: 9, rotate: 40 })}</div>
        <p class="letter-text"><span class="typed"></span><span class="caret"></span></p>
        <p class="signature">${esc(C.signature)}</p>
      </article>
      <button class="btn btn-ghost again" hidden>↺ Пройти ещё раз</button>`;

    const typed = screen.querySelector('.typed');
    const caret = screen.querySelector('.caret');
    const sign = screen.querySelector('.signature');
    const again = screen.querySelector('.again');
    const text = String(C.letter || '');
    let i = 0, timer = 0, finished = false;

    // Лепестки падают всё время, пока открыто письмо.
    const petals = setInterval(Art.fallingPetal, 1400);
    for (let k = 0; k < 4; k++) setTimeout(Art.fallingPetal, k * 300);

    function nearBottom() {
      return screen.scrollHeight - screen.scrollTop - screen.clientHeight < 120;
    }

    function step() {
      const stick = nearBottom();
      i++;
      typed.textContent = text.slice(0, i);
      if (stick) screen.scrollTop = screen.scrollHeight;
      if (i >= text.length) return done();
      const ch = text[i - 1];
      const delay = ch === '\n' ? 350 : '.!?…'.includes(ch) ? 280 : ',;:—'.includes(ch) ? 140 : 38;
      timer = setTimeout(step, delay);
    }

    function done() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      typed.textContent = text;
      caret.remove();
      sign.classList.add('show');
      setTimeout(() => { again.hidden = false; }, 1200);
    }

    // Нажатие на письмо — допечатать сразу.
    screen.querySelector('.paper').addEventListener('click', done);
    again.onclick = () => go(0);

    timer = setTimeout(step, 900);
    cleanup = () => {
      clearInterval(petals);
      clearTimeout(timer);
    };
  }

  start();
})();
