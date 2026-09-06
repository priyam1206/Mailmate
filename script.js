document.addEventListener('DOMContentLoaded', () => {
  const LOAD_DELAY_MS = 4200;
  const PARTICLE_COUNT = 45;

  const particlesContainer = document.getElementById('particles');
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    const size = Math.random() * 3 + 1;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}vw`;
    particle.style.top = `${Math.random() * 100}vh`;
    particlesContainer.appendChild(particle);
  }

  anime({
    targets: '.particle',
    translateY: () => anime.random(-180, -420),
    translateX: () => anime.random(-120, 120),
    scale: [() => Math.random() * 0.5 + 0.5, () => Math.random() * 1.5 + 0.5],
    opacity: [
      { value: 0, duration: 0 },
      { value: () => Math.random() * 0.7 + 0.3, duration: 800 },
      { value: 0, duration: 1000, delay: 1500 }
    ],
    easing: 'easeOutSine',
    duration: () => anime.random(2500, 3500),
    loop: false
  });

  const logoCanvas = document.getElementById('dotLogo');
  const logoContext = logoCanvas.getContext('2d');
  const logoStage = logoCanvas.parentElement;
  const logoDots = [];
  const pointer = { x: -1000, y: -1000 };
  const airCursor = document.getElementById('airCursor');
  const enterButton = document.getElementById('enterButton');
  const mainContent = document.getElementById('mainContent');
  const splashScreen = document.getElementById('splashScreen');
  const backButton = document.getElementById('backButton');

  function buildLogo() {
    const scale = window.devicePixelRatio || 1;
    const width = logoStage.clientWidth;
    const height = logoStage.clientHeight;
    if (!width || !height) {
      requestAnimationFrame(buildLogo);
      return;
    }
    logoCanvas.width = width * scale;
    logoCanvas.height = height * scale;
    logoContext.setTransform(scale, 0, 0, scale, 0, 0);
    logoContext.clearRect(0, 0, width, height);
    logoContext.font = `700 ${Math.min(height * 0.82, width / 9.5)}px "Space Grotesk"`;
    logoContext.textAlign = 'center';
    logoContext.textBaseline = 'middle';
    logoContext.fillStyle = '#fff';
    logoContext.fillText('CIPHERSQUAD', width / 2, height / 2);
    const pixels = logoContext.getImageData(0, 0, width, height).data;
    const targets = [];
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        if (pixels[(y * width + x) * 4 + 3] > 80) targets.push({ x, y });
      }
    }
    logoDots.length = 0;
    targets.forEach((target, index) => logoDots.push({
      x: Math.random() * width,
      y: height + Math.random() * 100,
      targetX: target.x,
      targetY: target.y,
      delay: index * 1.5
    }));
  }

  function animateLogo(time) {
    const width = logoStage.clientWidth;
    const height = logoStage.clientHeight;
    logoContext.clearRect(0, 0, width, height);
    logoDots.forEach((dot) => {
      const lift = Math.max(0, Math.min(1, (time - dot.delay) / 900));
      dot.x += (dot.targetX - dot.x) * 0.055 * lift;
      dot.y += (dot.targetY - dot.y) * 0.055 * lift;
      const distance = Math.hypot(dot.x - pointer.x, dot.y - pointer.y);
      if (distance < 90) {
        const force = (90 - distance) / 90;
        dot.x += (dot.x - pointer.x) * force * 0.08;
        dot.y += (dot.y - pointer.y) * force * 0.08 - force * 0.8;
      }
      logoContext.fillStyle = `rgba(255, 255, 255, ${0.35 + lift * 0.65})`;
      logoContext.beginPath();
      logoContext.arc(dot.x, dot.y, 1.45, 0, Math.PI * 2);
      logoContext.fill();
    });
    requestAnimationFrame(animateLogo);
  }

  buildLogo();
  requestAnimationFrame(animateLogo);
  window.addEventListener('resize', buildLogo);
  logoCanvas.addEventListener('pointermove', (event) => {
    const bounds = logoCanvas.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    airCursor.style.left = `${event.clientX}px`;
    airCursor.style.top = `${event.clientY}px`;
    airCursor.classList.add('is-active');
  });
  document.addEventListener('pointermove', (event) => {
    const bounds = logoCanvas.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    airCursor.style.left = `${event.clientX}px`;
    airCursor.style.top = `${event.clientY}px`;
    airCursor.classList.add('is-active');
  });
  document.addEventListener('pointerleave', () => airCursor.classList.remove('is-active'));
  enterButton.addEventListener('pointerenter', () => airCursor.classList.add('is-hovering'));
  enterButton.addEventListener('pointerleave', () => airCursor.classList.remove('is-hovering'));

  anime({
    targets: '#brandContainer',
    opacity: [0, 1],
    translateY: [30, 0],
    duration: 1200,
    easing: 'easeOutCubic'
  });

  anime({
    targets: '#loaderProgress',
    width: '100%',
    duration: LOAD_DELAY_MS,
    easing: 'easeInOutQuad'
  });

  setTimeout(() => {
    enterButton.classList.add('is-visible');
    enterButton.classList.add('is-ready');
  }, LOAD_DELAY_MS);

  function loadWebsite() {
    if (!enterButton.classList.contains('is-ready')) return;
    enterButton.disabled = true;
    let transitionComplete = false;
    const showWebsite = () => {
      if (transitionComplete) return;
      transitionComplete = true;
      document.body.classList.add('website-loaded');
      mainContent.setAttribute('aria-hidden', 'false');
      mainContent.classList.add('is-visible');
    };
    anime({
      targets: splashScreen,
      opacity: 0,
      scale: 1.04,
      duration: 700,
      easing: 'easeInOutCubic',
      complete: showWebsite
    });
    setTimeout(showWebsite, 900);
  }

  enterButton.addEventListener('click', loadWebsite);
  backButton.addEventListener('click', () => {
    document.body.classList.remove('website-loaded');
    mainContent.classList.remove('is-visible');
    mainContent.setAttribute('aria-hidden', 'true');
    splashScreen.style.opacity = '1';
    splashScreen.style.transform = 'scale(1)';
    enterButton.disabled = false;
  });
});