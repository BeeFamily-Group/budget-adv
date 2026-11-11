// Schermata gialla di caricamento (proposta B "Tag", 11/11/2026): firma spray che si disegna, frasi di attesa,
// poi l'adesivo vola nella barra in alto. Compare solo se i dati tardano più di 400 ms e resta almeno 1,1 s,
// il tempo di finire la firma. Solo alla prima apertura: i ricaricamenti dopo un salvataggio non la mostrano.

// Logica dei tempi, separata dal DOM per poterla provare in node.
export function splashTimer({ show, hide, now, setTimer, clearTimer, delay = 400, minVisible = 1100 }) {
  let timer = null;
  let shownAt = null;
  let ending = null;
  return {
    start() {
      timer = setTimer(() => { timer = null; shownAt = now(); show(); }, delay);
    },
    done() {
      if (ending) return ending;
      if (shownAt === null) {
        if (timer !== null) clearTimer(timer);
        timer = null;
        ending = Promise.resolve();
        return ending;
      }
      const wait = Math.max(0, minVisible - (now() - shownAt));
      ending = new Promise((resolve) => setTimer(() => Promise.resolve(hide()).then(resolve, resolve), wait));
      return ending;
    },
  };
}

const MESSAGES = ['Leggo il piano…', 'Conto la spesa di ieri…', 'Allineo Meta e Google…', 'Quasi fatto…'];
const EXIT_MS = 450;

export function startSplash() {
  const el = document.getElementById('splash');
  const body = document.body;
  if (!el) return { done: () => Promise.resolve() };
  const fly = el.querySelector('.splash-fly');
  const msg = el.querySelector('.splash-msg');
  const theme = document.querySelector('meta[name="theme-color"]');
  const themeColor = theme ? theme.getAttribute('content') : null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cycle = null;

  function show() {
    let i = 0;
    msg.textContent = MESSAGES[0];
    body.classList.add('splash-on', 'splash-mini-off');
    el.hidden = false;
    if (theme) theme.setAttribute('content', '#ffc400');
    if (!reduced) cycle = setInterval(() => { i = Math.min(i + 1, MESSAGES.length - 1); msg.textContent = MESSAGES[i]; }, 1400);
  }

  function finish() {
    el.hidden = true;
    el.classList.remove('leaving');
    fly.style.transform = '';
    body.classList.remove('splash-on', 'splash-mini-off');
  }

  function hide() {
    clearInterval(cycle);
    if (theme && themeColor) theme.setAttribute('content', themeColor);
    const target = document.querySelector('.topbar .rh-mini');
    const to = target ? target.getBoundingClientRect() : null;
    if (reduced || !to || !to.width) { finish(); return Promise.resolve(); }
    const sticker = el.querySelector('.splash-sticker');
    const from = sticker.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    const scale = target.offsetWidth / sticker.offsetWidth;
    body.classList.remove('splash-on'); // le card salgono mentre il giallo si scioglie
    el.classList.add('leaving');
    fly.style.transform = `translate(${dx}px, ${dy}px) scale(${scale}) rotate(3deg)`;
    return new Promise((resolve) => setTimeout(() => { finish(); resolve(); }, EXIT_MS));
  }

  const t = splashTimer({ show, hide, now: () => performance.now(), setTimer: setTimeout, clearTimer: clearTimeout });
  t.start();
  return t;
}
