document.addEventListener('DOMContentLoaded', () => {
  const logoCanvas = document.getElementById('dotLogo');
  const logoContext = logoCanvas?.getContext('2d');
  const logoDots = [];
  const pointer = { x: -2000, y: -2000 };

  const particlesContainer = document.getElementById('particles');
  if (particlesContainer) {
    const particleCount = 30;
    for (let i = 0; i < particleCount; i += 1) {
      const particle = document.createElement('div');
      particle.classList.add('particle');
      const size = Math.random() * 3 + 1;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.left = `${Math.random() * 100}vw`;
      particle.style.top = `${Math.random() * 100}vh`;
      particle.style.background = '#ffffff';
      particle.style.opacity = `${Math.random() * 0.45 + 0.15}`;
      particlesContainer.appendChild(particle);
      particle.animate([
        { transform: 'translate(0, 0)', opacity: particle.style.opacity },
        { transform: `translate(${(Math.random() - 0.5) * 120}px, -${Math.random() * 180 + 80}px)`, opacity: 0 }
      ], {
        duration: Math.random() * 7000 + 4000,
        iterations: Infinity,
        delay: Math.random() * 3000
      });
    }
  }

  let targetScatter = 0;
  let currentScatter = 0;
  let startTime = null;

  function updateScroll() {
    const scrollDistance = window.innerHeight * 0.85;
    targetScatter = Math.min(1, Math.max(0, window.scrollY / Math.max(1, scrollDistance)));
  }

  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('wheel', () => requestAnimationFrame(updateScroll), { passive: true });
  window.addEventListener('touchmove', () => requestAnimationFrame(updateScroll), { passive: true });

  function buildLogo() {
    if (!logoCanvas || !logoContext) return;
    const scale = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!width || !height) return;

    logoCanvas.width = Math.floor(width * scale);
    logoCanvas.height = Math.floor(height * scale);
    logoCanvas.style.width = `${width}px`;
    logoCanvas.style.height = `${height}px`;
    logoContext.setTransform(scale, 0, 0, scale, 0, 0);

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const sampleContext = sampleCanvas.getContext('2d');
    const centerX = width / 2;
    const centerY = height / 2;
    const fontSize = Math.min(width / 7.2, height * 0.22, 170);
    sampleContext.font = `800 ${fontSize}px "Space Grotesk", sans-serif`;
    sampleContext.textAlign = 'center';
    sampleContext.textBaseline = 'middle';
    sampleContext.fillStyle = '#ffffff';

    sampleContext.clearRect(0, 0, width, height);
    sampleContext.fillText('MAILMATE', centerX, centerY);
    const pixels = sampleContext.getImageData(0, 0, width, height).data;
    const step = width < 700 ? 3 : 4;
    const startY = Math.max(0, Math.floor(centerY - fontSize));
    const endY = Math.min(height, Math.ceil(centerY + fontSize));
    const targets = [];

    for (let y = startY; y < endY; y += step) {
      for (let x = 0; x < width; x += step) {
        if (pixels[(y * width + x) * 4 + 3] > 70) targets.push({ x, y });
      }
    }

    const maxScreenDistance = Math.hypot(width, height);
    logoDots.length = 0;
    targets.forEach((target, index) => {
      const scatterAngle = Math.random() * Math.PI * 2;
      const scatterDistance = (Math.random() * 0.85 + 0.45) * maxScreenDistance * 0.75;
      const initialAngle = Math.random() * Math.PI * 2;
      const initialDistance = Math.random() * 180 + 50;
      logoDots.push({
        x: target.x + Math.cos(initialAngle) * initialDistance,
        y: target.y + Math.sin(initialAngle) * initialDistance,
        baseX: target.x,
        baseY: target.y,
        scatterX: Math.cos(scatterAngle) * scatterDistance,
        scatterY: Math.sin(scatterAngle) * scatterDistance,
        delay: (index % 150) * 3,
        size: Math.random() * 0.5 + 1.45
      });
    });
  }

  function animateLogo(time) {
    if (!logoCanvas || !logoContext) return;
    if (!startTime) startTime = time;
    const elapsed = time - startTime;
    const width = window.innerWidth;
    const height = window.innerHeight;
    logoContext.clearRect(0, 0, width, height);
    currentScatter += (targetScatter - currentScatter) * 0.085;

    const scrollPrompt = document.getElementById('scrollPrompt');
    if (scrollPrompt) scrollPrompt.style.opacity = Math.max(0, 0.85 - currentScatter * 3.5);

    const heroIdentity = document.querySelector('.hero-identity');
    if (heroIdentity) {
      heroIdentity.style.opacity = Math.max(0, 1 - currentScatter * 2.7);
      heroIdentity.style.transform = `translateX(-50%) translateY(${-currentScatter * 18}px)`;
    }

    const authContainer = document.getElementById('authContainer');
    if (authContainer) {
      const authProgress = Math.max(0, Math.min(1, (currentScatter - 0.32) / 0.68));
      authContainer.style.opacity = authProgress;
      authContainer.style.transform = `translate(-50%, calc(-50% + ${(1 - authProgress) * 45}px)) scale(${0.92 + authProgress * 0.08})`;
      authContainer.style.pointerEvents = authProgress > 0.65 ? 'auto' : 'none';
    }

    logoDots.forEach(dot => {
      const entryProgress = Math.max(0, Math.min(1, (elapsed - dot.delay) / 600));
      const targetX = dot.baseX + dot.scatterX * currentScatter;
      const targetY = dot.baseY + dot.scatterY * currentScatter;
      const springRate = 0.085 * (0.3 + entryProgress * 0.7);
      dot.x += (targetX - dot.x) * springRate;
      dot.y += (targetY - dot.y) * springRate;

      if (currentScatter < 0.04) {
        const distance = Math.hypot(dot.x - pointer.x, dot.y - pointer.y);
        if (distance < 65) {
          const force = (65 - distance) / 65;
          dot.x += (dot.x - pointer.x) * force * 0.08;
          dot.y += (dot.y - pointer.y) * force * 0.08;
        }
      }

      const fade = Math.max(0, 1 - currentScatter * 1.15);
      const alpha = fade * (0.35 + entryProgress * 0.65);
      if (alpha <= 0.005) return;

      logoContext.fillStyle = '#ffffff';
      logoContext.globalAlpha = Math.min(1, alpha);
      logoContext.beginPath();
      logoContext.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
      logoContext.fill();
    });

    logoContext.globalAlpha = 1;
    requestAnimationFrame(animateLogo);
  }

  function setAuthStatus(text, kind = '') {
    const status = document.getElementById('authStatusMsg');
    if (!status) return;
    status.className = `auth-status-msg ${kind}`.trim();
    status.textContent = text;
  }

  async function hydrateAuth() {
    const button = document.getElementById('googleAuthBtn');
    const buttonText = document.getElementById('btnText');
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    if (!button) return;

    try {
      const response = await fetch(`/api/user/profile?ts=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const profile = await response.json();
      button.dataset.authenticated = 'true';
      button.classList.add('is-authenticated');
      if (buttonText) buttonText.textContent = 'Enter dashboard';
      if (title) title.textContent = 'Your inbox is ready.';
      if (subtitle) subtitle.textContent = `Continue as ${profile.name || profile.email || 'your Google account'}.`;
      setAuthStatus('Google account connected.', 'is-success');
    } catch (error) {
      console.info('[MailMate] No active Google session.', error);
    }
  }

  document.getElementById('googleAuthBtn')?.addEventListener('click', event => {
    const button = event.currentTarget;
    if (button.dataset.authenticated === 'true') {
      window.location.href = './dashboard.html';
      return;
    }
    button.classList.add('is-loading');
    setAuthStatus('Redirecting to Google authorization...');
    window.location.href = '/auth/google';
  });

  const handlePointer = event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };
  window.addEventListener('pointermove', handlePointer, { passive: true });
  window.addEventListener('pointerleave', () => {
    pointer.x = -2000;
    pointer.y = -2000;
  });

  if (document.fonts?.ready) document.fonts.ready.then(buildLogo);
  else buildLogo();
  window.addEventListener('resize', buildLogo);
  hydrateAuth();
  requestAnimationFrame(animateLogo);
});
