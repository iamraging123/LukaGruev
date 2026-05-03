(() => {
  // ---------- Hero: kick off intro animation ----------
  requestAnimationFrame(() => {
    const hero = document.getElementById('hero');
    if (hero) hero.classList.add('ready');
  });

  // ---------- Scroll reveal ----------
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view'); });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });

  document.querySelectorAll('.feature, .statement, .footer-card').forEach(el => io.observe(el));

  // (Accordion removed. More projects is now a static gallery grid.)

  // ---------- Hero photo: mouse parallax ----------
  const heroImg = document.querySelector('.hero-image-wrap img');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (heroImg && !reduceMotion) {
    const MAX_SHIFT = 22;          // px max in any direction
    const EASE = 0.09;             // 0..1, higher = snappier
    let tx = 0, ty = 0;            // target offset
    let cx = 0, cy = 0;            // current (eased) offset
    let raf = 0;

    const loop = () => {
      cx += (tx - cx) * EASE;
      cy += (ty - cy) * EASE;
      heroImg.style.setProperty('--mx', cx.toFixed(2) + 'px');
      heroImg.style.setProperty('--my', cy.toFixed(2) + 'px');
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = 0;
      }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

    window.addEventListener('mousemove', (e) => {
      const nx = (e.clientX / window.innerWidth)  - 0.5;  // -0.5..0.5
      const ny = (e.clientY / window.innerHeight) - 0.5;
      tx = nx * 2 * MAX_SHIFT;
      ty = ny * 2 * MAX_SHIFT;
      kick();
    }, { passive: true });

    // Glide back to center when the cursor leaves the window.
    document.addEventListener('mouseleave', () => { tx = 0; ty = 0; kick(); });
  }

  // ---------- Smooth / slowed page scroll ----------
  // Intercepts mouse-wheel and eases the document toward the target offset
  // so vertical scrolling has weight & glide. Touch / reduced-motion users
  // keep the native scroll behaviour.
  const isCoarsePointer = matchMedia('(pointer: coarse)').matches;
  if (!reduceMotion && !isCoarsePointer) {
    let sTarget  = window.scrollY;
    let sCurrent = window.scrollY;
    let sRaf     = 0;

    const FRICTION   = 0.075;   // lower = slower glide (try 0.06–0.12)
    const WHEEL_MULT = 0.55;    // <1 = each wheel tick travels less ground

    const maxScroll = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clampS = (v) => Math.max(0, Math.min(maxScroll(), v));

    const step = () => {
      sCurrent += (sTarget - sCurrent) * FRICTION;
      if (Math.abs(sTarget - sCurrent) < 0.5) {
        sCurrent = sTarget;
        window.scrollTo(0, sCurrent);
        sRaf = 0;
        return;
      }
      window.scrollTo(0, sCurrent);
      sRaf = requestAnimationFrame(step);
    };
    const kickScroll = () => { if (!sRaf) sRaf = requestAnimationFrame(step); };

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;          // leave browser pinch-zoom alone
      e.preventDefault();
      sTarget = clampS(sTarget + e.deltaY * WHEEL_MULT);
      kickScroll();
    }, { passive: false });

    // Stay in sync when the page is scrolled by other means
    // (anchor links, keyboard, scrollbar drag, programmatic scroll).
    window.addEventListener('scroll', () => {
      if (!sRaf) {
        sTarget  = window.scrollY;
        sCurrent = window.scrollY;
      }
    }, { passive: true });
  }

  // ---------- Background image preloader ----------
  // Big images decoded at scroll-time stall the smooth-scroll loop. Instead,
  // walk every <img> after first paint and force fetch + async decode so
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
