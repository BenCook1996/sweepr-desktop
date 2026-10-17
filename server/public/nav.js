/**
 * Sweepr Cleaner Navigation Interactions
 * Handles dropdown flyout menus, mobile responsiveness, and click-outside dismissal.
 */
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('navDropdownBtn');
  const menu = document.getElementById('navDropdownMenu');
  const chevron = document.getElementById('navDropdownChevron');

  if (btn && menu) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      if (isHidden) {
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('bg-emerald-50/80', 'text-emerald-700');
        if (chevron) chevron.classList.add('rotate-180');
      } else {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('bg-emerald-50/80', 'text-emerald-700');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('bg-emerald-50/80', 'text-emerald-700');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('bg-emerald-50/80', 'text-emerald-700');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });
  }
});
