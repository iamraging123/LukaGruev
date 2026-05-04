(() => {
  // ---------- Hero: kick off intro animation ----------
  requestAnimationFrame(() => {
    const hero = document.getElementById('hero');
    if (hero) hero.classList.add('ready');
  });

  // ---------- Hero photo: intro zoom + mouse parallax ----------
  // Single rAF loop drives BOTH the intro dolly (scale 1.30 -> 1.18 over
  // ~6s) and the live cursor-follow (translate up to MAX_SHIFT px in any
  // direction). All output goes to one inline `transform` so there's no
  // CSS-transition / standalone-property compatibility surprise.
  const heroImg = document.querySelector('.hero-image-wrap img');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (heroImg) {
    const MAX_SHIFT = 50;          // px max parallax in any direction
    const EASE      = 0.10;        // higher = snappier mouse follow
    const INTRO_MS  = 6000;        // intro dolly duration
    const SCALE_FROM = 1.30;       // starting zoom
    const SCALE_TO   = 1.18;       // resting zoom (must be > 1 for shift headroom)

    let tx = 0, ty = 0;            // target parallax offset (px)
    let cx = 0, cy = 0;            // current (eased) parallax offset (px)
    let introStart = 0;
    let raf = 0;

    const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

    const tick = (now) => {
      if (!introStart) introStart = now;
      const introP = Math.min(1, (now - introStart) / INTRO_MS);
      const scl = reduceMotion
        ? SCALE_TO
        : SCALE_FROM + (SCALE_TO - SCALE_FROM) * easeOutCubic(introP);

      cx += (tx - cx) * EASE;
      cy += (ty - cy) * EASE;

      heroImg.style.transform =
        `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) scale(${scl.toFixed(4)})`;

      const settling = Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05;
      if (introP < 1 || settling) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    // Always run at least once so the intro dolly plays.
    kick();

    if (!reduceMotion) {
      window.addEventListener('mousemove', (e) => {
        const nx = (e.clientX / window.innerWidth)  - 0.5;  // -0.5..0.5
        const ny = (e.clientY / window.innerHeight) - 0.5;
        tx = nx * 2 * MAX_SHIFT;
        ty = ny * 2 * MAX_SHIFT;
        kick();
      }, { passive: true });

      document.addEventListener('mouseleave', () => { tx = 0; ty = 0; kick(); });
    }
  }

  // ---------- Background image preloader ----------
  // Walk every <img> after first paint and force fetch + async decode so
  // they're already rasterized by the time they enter the viewport.
  const preloadOne = (img) => new Promise((resolve) => {
    img.decoding = 'async';
    img.loading  = 'eager';   // override loading="lazy" so the fetch starts now
    const decodeAndResolve = () => {
      // .decode() runs the bitmap decode off the main thread when supported.
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(resolve);
      } else {
        resolve();
      }
    };
    if (img.complete && img.naturalWidth > 0) {
      decodeAndResolve();
    } else {
      img.addEventListener('load',  decodeAndResolve, { once: true });
      img.addEventListener('error', resolve,          { once: true });
    }
  });

  const runPreload = async () => {
    // Sequential so we don't spike bandwidth or contend with hero rendering.
    for (const img of Array.from(document.images)) {
      await preloadOne(img);
    }
  };

  // Start once the page is past first paint; don't fight the hero animation.
  const schedulePreload = () => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(runPreload, { timeout: 1500 });
    } else {
      setTimeout(runPreload, 800);
    }
  };
  if (document.readyState === 'complete') {
    schedulePreload();
  } else {
    window.addEventListener('load', schedulePreload, { once: true });
  }

  // ---------- Scroll-triggered reveals ----------
  // Tag elements with .reveal + data-reveal direction, then let an
  // IntersectionObserver flip them to .in-view when they scroll into the
  // viewport. Galleries and the project grid also get .reveal-stagger so
  // their children cascade in.
  if (!reduceMotion) {
    const tagReveal = (el, dir) => {
      el.classList.add('reveal');
      el.setAttribute('data-reveal', dir);
    };

    // Feature sections: head slides up, hero zooms, body fades up,
    // gallery rolls in from the section's side (left or right).
    document.querySelectorAll('.feature').forEach((feat) => {
      const side = feat.getAttribute('data-side') === 'right' ? 'right' : 'left';
      const head    = feat.querySelector('.feature-head');
      const hero    = feat.querySelector('.feature-hero');
      const body    = feat.querySelector('.feature-body');
      const gallery = feat.querySelector('.gallery');

      if (head) tagReveal(head, 'up');
      if (hero) tagReveal(hero, 'zoom');
      if (body) tagReveal(body, 'up');
      if (gallery) {
        gallery.classList.add('reveal-stagger');
        Array.from(gallery.children).forEach((fig) => tagReveal(fig, side));
      }
    });

    // "More projects" grid: cards cascade up.
    const projGrid = document.querySelector('.proj-grid');
    if (projGrid) {
      projGrid.classList.add('reveal-stagger');
      projGrid.querySelectorAll('.proj-card').forEach((card) => tagReveal(card, 'up'));
    }

    // More-section heading slides up too.
    const moreHead = document.querySelector('.more-head');
    if (moreHead) tagReveal(moreHead, 'up');

    // Footer card big lines slide up.
    document.querySelectorAll('.footer-card .big-line, .footer-card .footer-copy, .footer-card .footer-cta')
      .forEach((el) => tagReveal(el, 'up'));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }

  // ---------- Live local clock in footer ----------
  const clock = document.getElementById('clock');
  if (clock) {
    const tick = () => {
      const d = new Date();
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      clock.textContent = `${h}:${m} ${ampm}`;
    };
    tick();
    setInterval(tick, 30 * 1000);
  }
})();
