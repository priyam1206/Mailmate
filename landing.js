document.addEventListener('DOMContentLoaded', () => {
  const pages = [...document.querySelectorAll('[data-story-page]')];
  const buttons = [...document.querySelectorAll('[data-story-target]')];
  if (!pages.length) return;

  let activePage = 0;
  const setActivePage = index => {
    activePage = Math.max(0, Math.min(pages.length - 1, index));
    document.body.classList.toggle('is-story-scrolled', activePage > 0);
    pages.forEach((page, pageIndex) => page.classList.toggle('is-active', pageIndex === activePage));
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === activePage;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  };

  const goToPage = index => pages[index]?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  });

  buttons.forEach(button => button.addEventListener('click', () => goToPage(Number(button.dataset.storyTarget))));

  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActivePage(pages.indexOf(visible.target));
  }, { threshold: [0.45, 0.65, 0.82] });
  pages.forEach(page => observer.observe(page));

  window.addEventListener('keydown', event => {
    if (/input|textarea|button/i.test(event.target?.tagName || '')) return;
    if (['ArrowDown', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      goToPage(Math.min(pages.length - 1, activePage + 1));
    } else if (['ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      goToPage(Math.max(0, activePage - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      goToPage(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goToPage(pages.length - 1);
    }
  });

  setActivePage(Math.max(0, Math.round(window.scrollY / Math.max(1, window.innerHeight))));
});
