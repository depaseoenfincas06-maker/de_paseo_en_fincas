/* ═══════════════════════════════════════════════════
   Shared Navigation — De Paseo en Fincas
   Auto-highlights active page, handles SPA tabs
   ═══════════════════════════════════════════════════ */
(function () {
  var nav = document.getElementById('main-nav');
  if (!nav) return;

  var path = window.location.pathname;
  var hash = window.location.hash;

  // Determine current page from URL
  var currentPage = 'simulator';
  if (path.includes('monitoring')) currentPage = 'monitoring';
  else if (path.includes('kanban')) currentPage = 'kanban';
  else if (path.includes('settings') || hash === '#settings') currentPage = 'settings';

  // Highlight the right link
  nav.querySelectorAll('.kb-nav__link').forEach(function (link) {
    link.classList.toggle('kb-nav__link--active', link.dataset.page === currentPage);
  });

  // Handle SPA tab clicks (simulator/settings are tabs on index.html)
  nav.addEventListener('click', function (e) {
    var link = e.target.closest('.kb-nav__link[data-tab]');
    if (!link) return;

    e.preventDefault();

    // Update highlight
    nav.querySelectorAll('.kb-nav__link').forEach(function (a) {
      a.classList.remove('kb-nav__link--active');
    });
    link.classList.add('kb-nav__link--active');

    // Trigger hidden workspace-tab (index.html SPA)
    var wsTab = document.querySelector('.workspace-tab[data-tab="' + link.dataset.tab + '"]');
    if (wsTab) wsTab.click();
  });
})();
