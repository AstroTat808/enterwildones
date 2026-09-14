(() => {
  const body = document.body;
  const links = [...document.querySelectorAll('[data-realm-link]')];
  const setRealmLink = realm => {
    links.forEach(link => {
      if (link.dataset.realmLink === realm) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };

  const onScroll = () => body.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if ('MutationObserver' in window) {
    new MutationObserver(() => setRealmLink(body.dataset.realm || 'cycle'))
      .observe(body, { attributes: true, attributeFilter: ['data-realm'] });
  }
  setRealmLink(body.dataset.realm || 'cycle');
})();
