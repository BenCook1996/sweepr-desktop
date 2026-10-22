/**
 * Sweepr Cleaner Navigation Interactions
 * Handles desktop dropdown flyout menus, automatic mobile hamburger drawer injection,
 * mobile responsiveness, and click-outside / Escape dismissal.
 */
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('navDropdownBtn');
  const menu = document.getElementById('navDropdownMenu');
  const chevron = document.getElementById('navDropdownChevron');

  function closeDesktopDropdown() {
    if (!menu || !btn) return;
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('bg-emerald-50/80', 'text-emerald-700');
    if (chevron) chevron.classList.remove('rotate-180');
  }

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
        closeDesktopDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        closeDesktopDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDesktopDropdown();
      }
    });
  }

  // Inject responsive mobile hamburger button & slide-down navigation drawer on all .glass-nav headers
  const nav = document.querySelector('nav.glass-nav');
  if (nav && !document.getElementById('mobileMenuBtn')) {
    const rightGroup = nav.lastElementChild;
    if (rightGroup) {
      const mobileBtn = document.createElement('button');
      mobileBtn.type = 'button';
      mobileBtn.id = 'mobileMenuBtn';
      mobileBtn.className = 'md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-gray-200/80 bg-white/80 text-gray-700 hover:text-emerald-600 hover:border-emerald-300 transition-colors cursor-pointer shrink-0';
      mobileBtn.setAttribute('aria-expanded', 'false');
      mobileBtn.setAttribute('aria-label', 'Open navigation menu');
      mobileBtn.innerHTML = `
        <svg id="mobileMenuIconOpen" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
        <svg id="mobileMenuIconClose" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      `;
      rightGroup.appendChild(mobileBtn);

      const drawer = document.createElement('div');
      drawer.id = 'mobileNavDrawer';
      drawer.className = 'hidden md:hidden fixed left-0 right-0 top-[68px] z-50 mx-3 rounded-2xl bg-white/98 backdrop-blur-xl border border-gray-200/90 shadow-2xl p-4 space-y-3';
      drawer.innerHTML = `
        <div class="grid grid-cols-1 gap-1 text-sm font-semibold text-gray-800">
          <a href="/#features" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>⚡ Features &amp; Overview</span>
            <span class="text-gray-400">&rarr;</span>
          </a>
          <a href="/pricing" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>💎 Pricing &amp; Pro Plans</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">Save 58%</span>
          </a>
          <a href="/clean" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>🗂️ Storage &amp; Cache Directory</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">40+ Guides</span>
          </a>
          <a href="/vs/ccleaner" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>⚖️ SWEEPR vs CCleaner</span>
            <span class="text-gray-400">&rarr;</span>
          </a>
          <a href="/alternatives/ccleaner" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>🏆 Top CCleaner Alternatives</span>
            <span class="text-gray-400">&rarr;</span>
          </a>
          <a href="/support" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>🛟 Support &amp; Help Center</span>
            <span class="text-gray-400">&rarr;</span>
          </a>
          <a href="/login" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-colors no-underline text-gray-800">
            <span>🔑 Customer Portal Sign In</span>
            <span class="text-gray-400">&rarr;</span>
          </a>
        </div>
        <div class="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <a href="/order?plan=annual" class="btn btn-go w-full justify-center gap-2 text-sm py-2.5">
            <span>Get Pro Now</span>
            <svg class="arrow-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </a>
          <a href="/download" class="btn w-full justify-center bg-white border border-gray-300 text-gray-800 text-sm py-2.5">
            <span>Free PC Download</span>
          </a>
        </div>
      `;
      nav.insertAdjacentElement('afterend', drawer);

      const iconOpen = mobileBtn.querySelector('#mobileMenuIconOpen');
      const iconClose = mobileBtn.querySelector('#mobileMenuIconClose');

      function closeMobileDrawer() {
        drawer.classList.add('hidden');
        mobileBtn.setAttribute('aria-expanded', 'false');
        if (iconOpen) iconOpen.classList.remove('hidden');
        if (iconClose) iconClose.classList.add('hidden');
      }

      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = drawer.classList.contains('hidden');
        if (isHidden) {
          drawer.classList.remove('hidden');
          mobileBtn.setAttribute('aria-expanded', 'true');
          if (iconOpen) iconOpen.classList.add('hidden');
          if (iconClose) iconClose.classList.remove('hidden');
        } else {
          closeMobileDrawer();
        }
      });

      drawer.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => closeMobileDrawer());
      });

      document.addEventListener('click', (e) => {
        if (!drawer.contains(e.target) && !mobileBtn.contains(e.target)) {
          closeMobileDrawer();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileDrawer();
      });
    }
  }
});
