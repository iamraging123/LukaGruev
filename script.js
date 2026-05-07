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
    const MAX_SHIFT = 25;          // px max parallax in any direction
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

  // ---------- Project detail modal ----------
  // Click a [data-project-trigger="<id>"] button to open the modal with the
  // matching entry from PROJECTS rendered inside it. Single shared modal,
  // populated dynamically — avoids 12 hidden modals in the DOM.
  // Each project's `sections` mirrors the section structure used in the
  // reference Markdown files (text / split / code / flowchart / gallery).
  const PROJECTS = {
    krocket: {
      number: '01',
      title: 'KROCKET V1',
      subtitle: 'Actively Controlled Rocket · 2026',
      hero: 'assets/01/top-01.jpg',
      meta: { Year: '2026', Domain: 'Hardware · Software', Stack: 'C++ · KiCad · MATLAB · CFD', Status: 'In progress' },
      sections: [
        { type: 'text', heading: 'About',
          text: "After building my previous rockets, I wanted to push myself further and make one that's actively controlled. Everything in this rocket, from the PCBs to the code, was designed and built by me from scratch. Enjoy some of the highlights below!" },
        { type: 'flowchart', heading: 'Logic flowchart', steps: [
          { label: 'SENSE',    text: 'Use the onboard sensors to stream data' },
          { label: 'ESTIMATE', text: 'Kalman filter fuses sensor data to calculate state' },
          { label: 'DECIDE',   text: 'PID algorithm computes fin commands' },
          { label: 'ACTUATE',  text: 'Servos drive the active fins, and repeat!' }
        ]},
        { type: 'code', heading: 'Code example', lang: 'c++',
          text: "On the right is a sample of code running on the rocket. This method updates the rocket's altitude using barometer data (pressure) and acceleration measurements.\n\nBy fusing the barometer readings with the acceleration data through a Kalman filter, I can estimate the altitude far more precisely than either sensor could alone.\n\nThe full codebase is long and complex, but if you'd like to see more, feel free to reach out!",
          code: "void AltitudeKFUpdate(float z_meas_m, float R_meas) {\n  float y = z_meas_m - altitude_m;\n  float S = altitude_kf_P00 + R_meas;\n  float inv_S = 1.0f / S;\n\n  float K0 = altitude_kf_P00 * inv_S;\n  float K1 = altitude_kf_P01 * inv_S;\n\n  altitude_m            += K0 * y;\n  vertical_velocity_mps += K1 * y;\n\n  float P00 = altitude_kf_P00 - K0 * altitude_kf_P00;\n  float P01 = altitude_kf_P01 - K0 * altitude_kf_P01;\n  float P11 = altitude_kf_P11 - K1 * altitude_kf_P01;\n\n  altitude_kf_P00 = P00;\n  altitude_kf_P01 = P01;\n  altitude_kf_P11 = P11;\n}" },
        { type: 'split', heading: 'PCB', side: 'right',
          text: "I designed this two-PCB stack from the ground up in KiCad. It runs on an STM32F7 and integrates barometers, IMUs, GNSS, magnetometers, LoRa, and more.\n\nThe stacked layout shrinks the electronics' footprint, letting me pack in more sensors while keeping weight down, which means higher altitudes on every flight.",
          images: ['assets/01/pcb-01.jpg', 'assets/01/pcb-04.png', 'assets/01/pcb-03.png'] },
        { type: 'split', heading: 'MATLAB', side: 'left',
          text: "I built this MATLAB system to tune and verify the PID gains before flight. It pairs a Simulink 6-DOF model with Barrowman equations, cross-checked against CFD data for accuracy.\n\nRight now the PID stabilizes the rocket in the roll axis, with pitch and yaw control planned for the future.\n\nThis setup lets me test the rocket virtually before it ever leaves the ground, making the whole process cheaper, safer, and more reliable.",
          images: ['assets/01/matlab-01.png', 'assets/01/matlab-02.png', 'assets/01/matlab-03.png'] },
        { type: 'split', heading: 'CFD', side: 'right',
          text: "I used Computational Fluid Dynamics (CFD) to verify the forces generated by the fins at various deflection angles, as well as to calculate the drag coefficient.\n\nCFD gave me a low-cost alternative to a wind tunnel, while still revealing aerodynamic detail that physical testing alone couldn't capture.\n\nI'm currently building a test stand that mounts the rocket to a car with a scale attached, which will let me measure the actual forces in real-world conditions and validate the CFD results.",
          images: ['assets/01/cfd-01.png', 'assets/01/cfd-02.png', 'assets/01/cfd-03.png'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/01/top-01.jpg', 'assets/01/top-02.jpg', 'assets/01/top-03.jpg', 'assets/01/top-04.jpg'] }
      ]
    },

    lukser: {
      number: '02',
      title: 'LUKSER',
      subtitle: 'A Ground-Up 3D Printer · 2023',
      hero: 'assets/02/front.jpg',
      meta: { Year: '2023', Domain: 'Hardware', Stack: 'CAD · Linux · DFM', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "After spending some time 3D printing with my Ender 3 and SV06+, I wanted to design a printer of my own, one that would be both fast and reliable. Building from scratch gave me full control over every design choice, letting me add custom features like LEDs and plenty of other touches you won't find on off-the-shelf printers.\n\nCheck out some of the highlights and design decisions below!" },
        { type: 'split', heading: 'Aluminum parts', side: 'right',
          text: "One choice I'm particularly happy with was machining the stepper motor mounts out of aluminum. The improved heat transfer lets me overdrive the motors without overheating them or melting a plastic mount.\n\nThe parts were also cheap to produce, since the same piece works for both the left and right mounts, just flipped. This cut the unique part count in half and saved roughly 50% when ordering from Send Cut Send.",
          images: ['assets/02/aluminum-01.png', 'assets/02/aluminum-02.png', 'assets/02/aluminum-03.png'] },
        { type: 'split', heading: 'Frame', side: 'left',
          text: "The base of the printer is built from 1.5-inch aluminum extrusions I had lying around. The result is a sturdy frame that can absorb the forces of high-speed printing without resonating, which directly improves print quality.\n\nThe total frame weight comes in at about 30 pounds, giving the printer a solid foundation to work from.",
          images: ['assets/02/frame-01.jpg', 'assets/02/frame-02.jpg'] },
        { type: 'split', heading: 'Hotend', side: 'right',
          text: "I went with a custom-machined high-flow hotend that uses high-wattage nichrome wiring for heating, pushing volumetric flow up to 100 mm³/s continuously. For reference, a typical nozzle like the one on an Ender 3 maxes out around 12 mm³/s. This was crucial for keeping the plastic melting fast enough to match my print speeds!",
          images: ['assets/02/hotend-01.jpg', 'assets/02/hotend-02.png'] },
        { type: 'split', heading: 'Motion system', side: 'left',
          text: "Fun fact: the motion system on this printer uses 7 independent motors, while most printers only use 3. The X and Y axes each get 2 dedicated motors for maximum speed, and the Z axis runs on 3. Pairing the triple Z motors with a ball bearing mechanism enables automatic bed alignment.\n\nThe X beam, visible in the photos, was custom machined from aluminum to keep weight low while maximizing rigidity.",
          images: ['assets/02/gantry-01.jpg', 'assets/02/gantry-02.jpg', 'assets/02/gantry-03.jpg'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/02/print-01.png', 'assets/02/build-01.png', 'assets/02/build-04.jpg', 'assets/02/build-05.jpg'] }
      ]
    },

    rgsound: {
      number: '03',
      title: 'RGSOUND',
      subtitle: 'A Custom Controller Built to Drive LEDs · 2025',
      hero: 'assets/05/desk-01.jpg',
      meta: { Year: '2025', Domain: 'Hardware · Software', Stack: 'C++ · KiCad · ESP32', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "I built RGSOUND because I wanted a clean, custom way to drive the LED strips on my desk with full control over them. The off-the-shelf controllers I tried were either too limited in their capabilities, too bulky, or too expensive — so I decided to design my own from scratch.\n\nThis project later inspired the CAPSOUND application — feel free to also check that out!\n\nBelow are some of the highlights of the build and the result!" },
        { type: 'split', heading: 'Design', side: 'right',
          text: "I made a custom PCB designed from scratch in KiCad. The board hosts the MCU, an ESP32, an antenna, and other components that help drive the WS2812B LED strip.\n\nThe layout went through a couple of revisions to reduce board size and layers; I managed to put everything on a two-layer board to reduce cost.",
          images: ['assets/05/build-01.jpg', 'assets/05/build-02.jpg', 'assets/05/build-03.jpg'] },
        { type: 'split', heading: 'Result', side: 'left',
          text: "Installed on my desk, driving the LED strip. The controller responds to audio in real time, so the lights actually move with whatever music is playing.\n\nIt has been running daily without issue and has become the centerpiece of my workspace lighting.",
          images: ['assets/05/desk-01.jpg', 'assets/05/desk-02.jpg', 'assets/05/desk-03.jpg'] }
      ]
    },

    locket: {
      number: '04',
      title: 'LOCKET',
      subtitle: 'High Power Rocket · 2024',
      hero: 'assets/03/front-01.jpg',
      meta: { Year: '2024', Domain: 'Hardware · Software', Stack: 'C++ · KiCad · MATLAB', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "After gaining some experience with rocketry from my previous rockets, I wanted to make a better rocket. LOCKET V1 is a high-power rocket that I designed from scratch, including the avionics that I designed in KiCad, simulations in OpenRocket, and the airframe in CAD.\n\nBelow are some of the aspects of the project and how they came together to create LOCKET V1." },
        { type: 'split', heading: 'Avionics', side: 'right',
          text: "This board was designed in KiCad and served as the brains of the rocket. It featured an ESP32-C3, IMU, barometer, GPS, LoRa, and much more. The board was designed to be compact and lightweight, allowing the rocket to reach higher altitudes.\n\nThe board had two main revisions: the first one (green) had some issues with USB connectivity, but the second revision (purple) fixed those issues and was flown on the rocket.",
          images: ['assets/03/pcb-01.jpg', 'assets/03/pcb-02.jpg', 'assets/03/pcb-03.jpg'] },
        { type: 'split', heading: 'Simulation', side: 'left',
          text: "Before designing anything in CAD, I created an OpenRocket simulation to tune the rocket's stability and predict apogee. This allowed me to easily modify parts of the rocket and see how it would affect the flight, and gain a sense of how the rocket would react in different conditions.\n\nUsing OpenRocket allowed me to plan and iterate on the design of the rocket before building it, saving time and money.",
          images: ['assets/03/simulation-01.png', 'assets/03/simulation-02.png', 'assets/03/simulation-03.png'] },
        { type: 'split', heading: 'Paint & fiberglass', side: 'right',
          text: "Before painting, I laid up a layer of fiberglass over the fins to increase structural stability during flight and reduce the chance of the fins snapping on impact.\n\nOnce the fiberglass cured and was sanded flat, I sprayed a black and red theme over the airframe. I cut the decals on a Cricut and spray-painted over them to make the rocket look as good as it flies!",
          images: ['assets/03/fiberglass-01.jpg', 'assets/03/fiberglass-02.jpg', 'assets/03/paint-01.jpg', 'assets/03/paint-02.jpg'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/03/front-01.jpg', 'assets/03/front-02.jpg', 'assets/03/front-03.jpg', 'assets/03/build-01.jpg', 'assets/03/build-02.jpg', 'assets/03/code-01.jpg'] }
      ]
    },

    batbot: {
      number: '05',
      title: 'BatBot V2',
      subtitle: 'A Smart Battlebot · 2023',
      hero: 'assets/04/front.jpg',
      meta: { Year: '2023', Domain: 'Hardware · Software', Stack: 'C++ · KiCad', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "BatBot V2 is a smart battlebot with custom electronics made in KiCad, a chassis designed with carbon fiber polycarbonate plastic, and a Bluetooth telemetry system.\n\nBelow are some of the highlights of the build!" },
        { type: 'split', heading: 'Electronics', side: 'right',
          text: "Here are the custom electronics that drive the bot. The board is based on a DIP-32 ATmega microcontroller, allowing an easy-to-debug and replace system. In addition I'm using an L298N motor driver to control the wheels.\n\nThe board uses an external antenna to be controlled via Bluetooth. The PCB also drives an external brushless motor to power the weapon on a separate power source to reduce electrical noise.",
          images: ['assets/04/pcb-01.jpg', 'assets/04/pcb-02.jpg', 'assets/04/pcb-03.jpg'] },
        { type: 'split', heading: 'Chassis', side: 'left',
          text: "The frame uses a two-part system as shown in the photos. The main chassis holds the wheels while the top part holds the weapon. Both parts are held together with heat-set thread inserts and screws.\n\nThe frame is 3D printed out of an impact-resistant filament blend, Polycarbonate Carbon Fiber. Check out the photos!",
          images: ['assets/04/chassis-01.jpg', 'assets/04/chassis-02.jpg', 'assets/04/chassis-03.jpg'] },
        { type: 'split', heading: 'Programming', side: 'right',
          text: "I programmed the ATmega MCU as shown in the photos with my computer. The robot uses a Bluetooth telemetry system, allowing quick and easy connection from my computer to control it.",
          images: ['assets/04/programming-01.jpg'] },
        { type: 'split', heading: 'Competition', side: 'left',
          text: "Photos and footage from the actual competition! I placed 2nd overall but I unfortunately had a bad battery and lost a few battles, but when the battery was working the battlebot was great!",
          images: ['assets/04/comp-01.jpg'] }
      ]
    },

    unihigh: {
      number: '06',
      title: 'Uni High Rocket',
      subtitle: 'Miniature Smart Rocket · 2024',
      hero: 'assets/06/front-01.jpg',
      meta: { Year: '2024', Domain: 'Hardware · Software', Stack: 'C++ · KiCad', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "The Uni High Rocket was my introduction to rocketry. It built the foundation that would later lead to more advanced builds like KROCKET and LOCKET (check those out too!). I designed the airframe with OpenRocket and CAD, and designed the avionics with KiCad.\n\nBelow are some of the highlights of the build!" },
        { type: 'split', heading: 'Avionics', side: 'right',
          text: "Here is the avionics board. It hosts multiple sensors such as accelerometers, gyroscopes, and barometers. The microcontroller is an ESP32-C3 and logs all of the data from the sensors to the EEPROM to later be recovered over serial.\n\nThe board was designed to fit inside the nosecone along with the battery, creating the small circular shape.",
          images: ['assets/06/pcb-01.jpg', 'assets/06/pcb-02.jpg', 'assets/06/pcb-03.jpg', 'assets/06/pcb-04.jpg', 'assets/06/pcb-05.jpg'] },
        { type: 'split', heading: 'Launch', side: 'left',
          text: "First flight on a small black powder motor at a local field. The rocket lifted off straight, hit apogee cleanly, and the recovery system deployed exactly when the avionics commanded it to.\n\nBeyond the flight itself, the launch validated the avionics stack end to end — the flight computer logged the full profile, the recovery circuit fired on time, and the airframe came back intact and ready to fly again.",
          images: ['assets/06/launch-01.jpg', 'assets/06/launch-02.jpg'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/06/front-01.jpg', 'assets/06/front-02.jpg', 'assets/06/airframe-01.png', 'assets/06/airframe-02.png', 'assets/06/build-01.jpg'] }
      ]
    },

    lorase: {
      number: '07',
      title: 'LoRase',
      subtitle: 'Long Range Telemetry System · 2025',
      hero: 'assets/07/cover.png',
      meta: { Year: '2025', Domain: 'Hardware · Software', Stack: 'C++ · KiCad · LoRa', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "LoRase is a long-range telemetry system I built to send sensor data from a remote node back to a base station. Built around the LoRa radio standard for kilometer-class link budgets at low power.\n\nBelow are some of the highlights of the build." },
        { type: 'text', heading: 'Hardware',
          text: "Custom PCB hosting the LoRa radio module, MCU, antenna matching network, and battery management.\n\nLayout was carefully done around the RF traces — keeping return paths clean is what gets you the long range." },
        { type: 'text', heading: 'Range test',
          text: "Tested in the field by walking the receiver away from the transmitter until packets started dropping. The link held up well past line-of-sight horizon.\n\nReal-world range matched the link budget calculations within a small margin." }
      ]
    },

    lg06plus: {
      number: '08',
      title: 'LG06+',
      subtitle: 'Modified 3D Printer · 2023',
      hero: 'assets/08/front-01.jpg',
      meta: { Year: '2023', Domain: 'Hardware · Software', Stack: 'C++ · CAD', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "LG06+ is my modified Sovol SV06+ 3D printer. The base machine is solid, but I made a long list of upgrades to push it further on speed, quality, and reliability.\n\nBelow are some of the highlights of the upgrades." },
        { type: 'split', heading: 'Upgrades', side: 'right',
          text: "Hardware upgrades — better hotend, lighter toolhead, stiffer mounts, and a custom electronics enclosure.\n\nEach change targeted a specific bottleneck, so the upgrades stack rather than overlap.",
          images: ['assets/08/software-01.jpg', 'assets/08/build-01.jpg'] },
        { type: 'split', heading: 'Prints', side: 'left',
          text: "Sample prints showing the quality and speed improvements. Same models, before and after the upgrade list.\n\nSurface finish tightened up noticeably on the corners and overhangs that the stock machine struggled with.",
          images: ['assets/08/front-01.jpg'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/08/build-01.jpg', 'assets/08/build-02.jpg', 'assets/08/build-03.jpg'] }
      ]
    },

    capsound: {
      number: '09',
      title: 'CAPSOUND',
      subtitle: 'Open-Source Audio Visualization Software · 2026',
      hero: 'assets/09/front-01.png',
      meta: { Year: '2026', Domain: 'Software', Stack: 'JavaScript', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "CAPSOUND is an open-source audio visualization tool I wrote. It takes any audio input — a file or live audio — and renders a real-time visualization driven by the FFT of the signal.\n\nBuilt to be a lightweight, hackable starting point for anyone who wants to make their own visuals." },
        { type: 'code', heading: 'Code', lang: 'js',
          text: "On the right is the core of the visualizer — the routine that takes a chunk of audio, runs an FFT on it, and produces the bin amplitudes that the renderer uses to draw the visuals.\n\nThe full project is a few hundred lines on top of this kernel.",
          code: "function visualize(audioBuffer) {\n  const fft = new FFT(audioBuffer.length);\n  const spectrum = fft.forward(audioBuffer);\n\n  const bins = new Float32Array(BIN_COUNT);\n  for (let i = 0; i < BIN_COUNT; i++) {\n    const start = Math.floor(i * spectrum.length / BIN_COUNT);\n    const end   = Math.floor((i + 1) * spectrum.length / BIN_COUNT);\n    let sum = 0;\n    for (let k = start; k < end; k++) sum += Math.abs(spectrum[k]);\n    bins[i] = sum / (end - start);\n  }\n  return bins;\n}" },
        { type: 'split', heading: 'Example', side: 'right',
          text: "Quick clip of CAPSOUND running on a track — the bins react to the FFT output in real time, and the renderer maps them straight to the on-screen visuals.\n\nWhat you're watching is the same kernel from the code section above, just wired up to a renderer instead of the console.",
          images: ['assets/09/front-01.png', 'assets/09/front-02.png'] }
      ]
    },

    ctesttube: {
      number: '10',
      title: 'CTestTube',
      subtitle: '3D Printed Medical Equipment · 2025',
      hero: 'assets/10/front.jpg',
      meta: { Year: '2025', Domain: 'Hardware', Stack: 'CAD', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "CTestTube is a set of 3D printed test tube racks and lab accessories I designed for a small lab setup. The goal was to make functional, sterilizable lab gear for a fraction of what off-the-shelf parts cost.\n\nBelow are some of the highlights of the design." },
        { type: 'split', heading: 'Design', side: 'right',
          text: "CAD designs tuned for FDM printing — geometry chosen so each part prints flat without supports.\n\nWall thicknesses and hole diameters were tuned for the tube sizes the lab actually uses.",
          images: ['assets/10/design-01.png'] },
        { type: 'split', heading: 'In use', side: 'left',
          text: "The racks have been in regular lab use since the first print. They hold the tubes securely, sterilize without warping, and survive repeated cleaning cycles.\n\nSurface finish came out smooth enough that the parts wipe down cleanly between runs — no rough edges trapping anything.",
          images: ['assets/10/in-use-01.jpg', 'assets/10/in-use-02.jpg'] },
        { type: 'gallery', heading: 'Build photos',
          images: ['assets/10/front.jpg'] }
      ]
    },

    dice: {
      number: '11',
      title: 'Dice Design',
      subtitle: 'Website-Based Dice Designer · 2026',
      hero: 'assets/11/cover.png',
      meta: { Year: '2026', Domain: 'Software', Stack: 'JavaScript · Three.js', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "Dice Design is a web-based tool for designing custom dice. Configure the geometry, the face icons, and the materials — then export the model for 3D printing.\n\nBuilt as a lightweight tool for tabletop hobbyists who want to make their own dice." },
        { type: 'text', heading: 'Interface',
          text: "Single-page web interface — pick the die shape, drop in the face artwork, see the live 3D preview update in real time.\n\nBuilt with a tight feedback loop so changes show up instantly without a re-render step." },
        { type: 'gallery', heading: 'Examples',
          images: ['assets/11/example-01.png', 'assets/11/example-02.png'] }
      ]
    },

    lightsim: {
      number: '12',
      title: 'LightSim',
      subtitle: 'Fin Force Simulator for Rockets · 2026',
      hero: 'assets/12/cover.png',
      meta: { Year: '2026', Domain: 'Software', Stack: 'Python', Status: 'Complete' },
      sections: [
        { type: 'text', heading: 'About',
          text: "LightSim is a fin force simulator I wrote to predict the side force and moment a rocket fin will produce at a given angle of attack and airspeed. Saves running a full CFD pass when I just need a quick number.\n\nBuilt around Barrowman-style equations with empirical corrections for the fin shapes I usually use." },
        { type: 'code', heading: 'Code', lang: 'py',
          text: "On the right is the core of the simulator — given fin geometry, airspeed, and angle of attack, it returns the lift force and pitching moment.\n\nFast enough to sweep across a flight envelope in seconds.",
          code: "def fin_force(geom, airspeed, alpha):\n    rho = 1.225  # kg/m^3 sea-level air density\n    q   = 0.5 * rho * airspeed ** 2\n\n    cl_alpha = 2 * math.pi * geom.aspect_ratio / (geom.aspect_ratio + 2)\n    cl       = cl_alpha * alpha\n\n    lift     = q * geom.area * cl\n    moment   = lift * geom.chord_root * 0.25\n    return lift, moment" }
      ]
    }
  };

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Convert section text (which uses \n\n as paragraph breaks) into <p> tags.
  const proseHtml = (text) => String(text || '')
    .split(/\n\n+/)
    .map((par) => `<p>${escapeHtml(par).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const figuresHtml = (paths, alt) => (paths || [])
    .map((src) => `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" loading="lazy"></figure>`)
    .join('');

  // Carousel for split sections — one image visible at a time, prev/next
  // arrows hidden when there's only a single image.
  const carouselHtml = (paths, alt) => {
    const list = paths || [];
    if (!list.length) return '';
    const single = list.length < 2 ? ' ms-carousel--single' : '';
    const slides = list.map((src, i) =>
      `<figure class="ms-carousel-slide${i === 0 ? ' active' : ''}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}" loading="lazy">
      </figure>`
    ).join('');
    return `<div class="ms-carousel${single}">
      <div class="ms-carousel-stage">${slides}</div>
      <button class="ms-carousel-prev" aria-label="Previous image" type="button">&larr;</button>
      <button class="ms-carousel-next" aria-label="Next image" type="button">&rarr;</button>
      <span class="ms-carousel-counter">1 / ${list.length}</span>
    </div>`;
  };

  const renderSection = (s) => {
    if (s.type === 'text') {
      return `<section class="ms ms-text">
        <h3 class="ms-heading">${escapeHtml(s.heading)}</h3>
        <div class="ms-prose">${proseHtml(s.text)}</div>
      </section>`;
    }
    if (s.type === 'split') {
      const side = s.side === 'left' ? 'left' : 'right';
      return `<section class="ms ms-split ms-split--${side}">
        <div class="ms-split-text">
          <h3 class="ms-heading">${escapeHtml(s.heading)}</h3>
          <div class="ms-prose">${proseHtml(s.text)}</div>
        </div>
        <div class="ms-split-images">${carouselHtml(s.images, s.heading)}</div>
      </section>`;
    }
    if (s.type === 'code') {
      return `<section class="ms ms-code">
        <div class="ms-code-text">
          <h3 class="ms-heading">${escapeHtml(s.heading)}</h3>
          <div class="ms-prose">${proseHtml(s.text)}</div>
        </div>
        <pre class="ms-code-block"><code>${escapeHtml(s.code)}</code></pre>
      </section>`;
    }
    if (s.type === 'flowchart') {
      const items = (s.steps || []).map((step) =>
        `<li><span class="ms-step-label">${escapeHtml(step.label)}</span><span class="ms-step-text">${escapeHtml(step.text)}</span></li>`
      ).join('');
      return `<section class="ms ms-flowchart">
        <h3 class="ms-heading">${escapeHtml(s.heading)}</h3>
        <ol class="ms-flow">${items}</ol>
      </section>`;
    }
    if (s.type === 'gallery') {
      return `<section class="ms ms-gallery">
        <h3 class="ms-heading">${escapeHtml(s.heading)}</h3>
        <div class="ms-gallery-grid">${figuresHtml(s.images, s.heading)}</div>
      </section>`;
    }
    return '';
  };

  const renderProject = (p) => {
    const metaItems = Object.entries(p.meta)
      .map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`)
      .join('');
    const sectionsHtml = (p.sections || []).map(renderSection).join('');

    return `
      ${p.hero ? `<div class="modal-hero"><img src="${escapeHtml(p.hero)}" alt="${escapeHtml(p.title)}"></div>` : ''}
      <div class="modal-head">
        <span class="modal-num">${escapeHtml(p.number)} · DETAIL</span>
        <h2 class="modal-title" id="modal-title">${escapeHtml(p.title)}</h2>
        <p class="modal-subtitle">${escapeHtml(p.subtitle)}</p>
      </div>
      <ul class="modal-meta">${metaItems}</ul>
      <div class="modal-sections">${sectionsHtml}</div>
    `;
  };

  // Wire prev/next arrows on every carousel inside `root` after render.
  // Each carousel tracks its own active index — independent of siblings.
  const wireCarousels = (root) => {
    root.querySelectorAll('.ms-carousel').forEach((car) => {
      const slides  = Array.from(car.querySelectorAll('.ms-carousel-slide'));
      const counter = car.querySelector('.ms-carousel-counter');
      const prev    = car.querySelector('.ms-carousel-prev');
      const next    = car.querySelector('.ms-carousel-next');
      if (slides.length < 2) return;
      let i = 0;
      const update = () => {
        slides.forEach((s, j) => s.classList.toggle('active', j === i));
        if (counter) counter.textContent = `${i + 1} / ${slides.length}`;
      };
      if (prev) prev.addEventListener('click', (e) => {
        e.stopPropagation();
        i = (i - 1 + slides.length) % slides.length;
        update();
      });
      if (next) next.addEventListener('click', (e) => {
        e.stopPropagation();
        i = (i + 1) % slides.length;
        update();
      });
    });
  };

  // Lightbox: shows a single image full-screen. Click the image to toggle
  // 2x zoom; click the backdrop or the close button (or hit Esc) to dismiss.
  const lightbox = document.getElementById('lightbox');
  const lightboxImg   = lightbox && lightbox.querySelector('.lightbox-img');
  const lightboxStage = lightbox && lightbox.querySelector('.lightbox-stage');

  const openLightbox = (src, alt) => {
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightboxStage.classList.remove('zoomed');
    lightboxStage.scrollTo(0, 0);
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
  };
  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxStage.classList.remove('zoomed');
  };

  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target.closest('[data-lightbox-close]')) { closeLightbox(); return; }
      if (e.target === lightboxImg) {
        lightboxStage.classList.toggle('zoomed');
        // Reset scroll when un-zooming so the next zoom starts centered.
        if (!lightboxStage.classList.contains('zoomed')) {
          lightboxStage.scrollTo(0, 0);
        }
        return;
      }
      // Click on the backdrop / stage area outside the image closes.
      closeLightbox();
    });
  }

  const modal = document.getElementById('proj-modal');
  if (modal) {
    const modalContent = modal.querySelector('.modal-content');
    let lastFocus = null;

    const openModal = (id) => {
      const project = PROJECTS[id];
      if (!project) return;
      lastFocus = document.activeElement;
      modalContent.innerHTML = renderProject(project);
      modalContent.scrollTop = 0;
      wireCarousels(modalContent);
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      const close = modal.querySelector('.modal-close');
      if (close) close.focus();
    };

    const closeModal = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    };

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-project-trigger]');
      if (trigger) {
        e.preventDefault();
        openModal(trigger.getAttribute('data-project-trigger'));
        return;
      }
      if (e.target.closest('[data-modal-close]')) {
        closeModal();
        return;
      }
      // Any <img> anywhere on the page opens the lightbox — except clicks
      // inside the lightbox itself, which the lightbox handler manages.
      const img = e.target.closest('img');
      if (img && !e.target.closest('#lightbox')) {
        openLightbox(img.currentSrc || img.src, img.alt);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // Lightbox always wins — close it first if it's open.
      if (lightbox && lightbox.classList.contains('open')) {
        closeLightbox();
        return;
      }
      if (modal.classList.contains('open')) closeModal();
    });
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
