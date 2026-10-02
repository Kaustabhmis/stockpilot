/**
 * Ashirbad Enterprise – shared layout & helpers
 * ---------------------------------------------------------------
 * headerHTML()/footerHTML() are pure so tools/build.mjs can pre-render
 * them into every page. In the browser, AE.layout() only renders them
 * when the page was not pre-rendered, then wires up the menu etc.
 *
 * window.AE_ROOT: path prefix to the site root ('' for root pages,
 * '../' for blog/<slug>.html). Set by the build.
 */
(function (root) {
    'use strict';

    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    const C = (root.APP_CONFIG) || {};
    const T = root.AET || (typeof require === 'function' ? require('./templates.js') : null);
    const K = root.AEC || (typeof require === 'function' ? require('./content.js') : null);
    const escapeHTML = T.esc;
    const R = () => (isBrowser && window.AE_ROOT) || '';

    /** Current website content (defaults until the saved settings load). */
    let CONTENT = K.build(isBrowser && window.AE_SETTINGS ? window.AE_SETTINGS : []);
    const content = () => CONTENT;
    const waLink = (text) => `https://wa.me/${CONTENT.whatsapp}?text=${encodeURIComponent(text)}`;

    const SOCIAL_ICONS = { facebook: 'fa-facebook-f', instagram: 'fa-instagram', youtube: 'fa-youtube', linkedin: 'fa-linkedin-in' };

    // Extra renderers for header/footer blocks (used by AEC.apply)
    const brandHTML = (name, accent) => {
        const parts = String(name || '').trim().split(/\s+/);
        if (parts.length < 2) return escapeHTML(name);
        const last = parts.pop();
        return `${escapeHTML(parts.join(' '))} <span class="${accent}">${escapeHTML(last)}</span>`;
    };
    K.RENDER['@brand'] = (_v, c) => brandHTML(c.business_name, 'text-brand-orange');
    K.RENDER['@brand_footer'] = (_v, c) => brandHTML(c.business_name, 'text-brand-gold');
    K.RENDER['@social'] = (_v, c) => (c.social.length ? `<nav aria-label="Social media"><ul class="flex gap-3 mt-5">${c.social.map(([k, url]) => `<li><a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer me" class="w-11 h-11 rounded-full bg-white/10 hover:bg-brand-orange text-white flex items-center justify-center" aria-label="${escapeHTML(c.business_name)} on ${k.charAt(0).toUpperCase() + k.slice(1)}"><i class="fab ${SOCIAL_ICONS[k] || 'fa-globe'}" aria-hidden="true"></i></a></li>`).join('')}</ul></nav>` : '');
    K.RENDER['@footer_phones'] = (_v, c) => [[c.phone, c.phone_href], [c.phone_alt, c.phone_alt_href]].filter(([p]) => p)
        .map(([p, href]) => `<p><a href="${escapeHTML(href)}" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Call ${escapeHTML(p)}"><i class="fas fa-phone mr-2" aria-hidden="true"></i>${escapeHTML(p).replace(/ /g, '&nbsp;')}</a></p>`).join('');

    /* ------------------------------------------------------------
     * Header / Footer markup (pure). Elements carry data-c markers so
     * AEC.apply() can update them when content changes.
     * ---------------------------------------------------------- */
    function headerHTML(active, rootPrefix, c) {
        const k = c || CONTENT;
        const r = rootPrefix == null ? R() : rootPrefix;
        const links = [
            { href: `${r}index.html`, label: 'Home', key: 'home' },
            { href: `${r}gallery.html`, label: 'Gallery', key: 'gallery' },
            { href: `${r}about.html`, label: 'About Us', key: 'about' },
            { href: `${r}blog.html`, label: 'Blog', key: 'blog' },
            { href: `${r}contact.html`, label: 'Contact', key: 'contact' }
        ];
        const isActive = (l) => l.key === active || (active === 'project' && l.key === 'gallery');
        const cls = (l) => (isActive(l) ? 'text-brand-orange after:scale-x-100' : 'text-brand-navy after:scale-x-0');
        const cur = (l) => (isActive(l) ? ' aria-current="page"' : '');
        return `
        <header id="site-header" class="bg-white/95 backdrop-blur border-b border-brand-sand fixed w-full z-[100] top-0 transition-all duration-300">
            <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
                <div class="flex justify-between h-20 items-center gap-4">
                    <a href="${r}index.html" class="flex-shrink-0 flex items-center gap-3 min-w-0" aria-label="${escapeHTML(k.business_name)} home" data-c-attr="aria-label:home_label">
                        <img src="${r}1000365300.jpg" alt="${escapeHTML(k.business_name)} logo" class="h-12 w-12 sm:h-14 sm:w-14 object-contain" width="56" height="56">
                        <span class="flex flex-col min-w-0">
                            <span class="font-display text-xl sm:text-2xl font-bold text-brand-navy leading-none truncate" data-c="business_name">${escapeHTML(k.business_name)}</span>
                            <span class="hidden sm:block text-[10px] tracking-[0.24em] text-brand-orange font-bold mt-1">BUILDERS &amp; DEVELOPERS</span>
                        </span>
                    </a>
                    <div class="hidden lg:flex items-center gap-8 text-[15px] font-semibold">
                        ${links.map((l) => `<a href="${l.href}" class="nav-link relative py-2 ${cls(l)} hover:text-brand-orange transition after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-0.5 after:bg-brand-flame after:origin-left after:transition-transform" aria-label="${l.label}"${cur(l)}>${l.label}</a>`).join('')}
                        <a href="${r}enquiry.html" class="bg-brand-navy hover:bg-brand-orange text-white px-5 py-3 rounded-sm transition whitespace-nowrap" aria-label="Book a Site Visit">Book a Site Visit</a>
                    </div>
                    <div class="flex lg:hidden items-center">
                        <button id="mobile-menu-btn" type="button" class="text-brand-navy hover:text-brand-orange focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-flame rounded p-3 -mr-2 transition-colors" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false">
                            <i class="fas fa-bars text-2xl w-6 text-center" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </nav>
            <div id="mobile-menu" class="hidden lg:hidden bg-white border-t border-brand-sand shadow-xl absolute w-full left-0 max-h-[calc(100vh-5rem)] overflow-y-auto">
                <nav class="px-4 pt-2 pb-6 flex flex-col space-y-1" aria-label="Mobile navigation">
                    ${links.map((l) => `<a href="${l.href}" class="mobile-link block px-4 py-3 text-base font-bold ${isActive(l) ? 'text-brand-orange' : 'text-brand-navy'} hover:bg-brand-cream rounded-md" aria-label="${l.label}"${cur(l)}>${l.label}</a>`).join('')}
                    <a href="${r}enquiry.html" class="mobile-link block px-4 py-3 text-base font-bold text-center bg-brand-navy text-white rounded-md mt-4" aria-label="Book a Site Visit">Book a Site Visit</a>
                </nav>
            </div>
        </header>`;
    }

    function footerHTML(rootPrefix, c, projectsHTML) {
        const k = c || CONTENT;
        const r = rootPrefix == null ? R() : rootPrefix;
        const kr = Object.assign({}, k, { _root: r });
        return `
        <footer class="bg-brand-ink text-gray-300 text-sm">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-10">
                <div class="lg:col-span-4">
                    <a href="${r}index.html" class="inline-flex items-center gap-3" aria-label="${escapeHTML(k.business_name)} home" data-c-attr="aria-label:home_label">
                        <img src="${r}1000365300.jpg" alt="${escapeHTML(k.business_name)} logo" class="h-14 w-14 rounded bg-brand-cream p-1 object-contain" width="56" height="56" loading="lazy">
                        <span class="font-display text-2xl font-bold text-white" data-c="business_name">${escapeHTML(k.business_name)}</span>
                    </a>
                    <p class="mt-5 max-w-sm leading-relaxed" data-c="footer_about">${escapeHTML(k.footer_about)}</p>
                    <div data-c-list="@social">${K.RENDER['@social'](null, k)}</div>
                </div>
                <nav class="lg:col-span-2" aria-label="Footer quick links">
                    <h2 class="!font-sans text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4">Quick Links</h2>
                    <ul class="space-y-1">
                        <li><a href="${r}index.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Home">Home</a></li>
                        <li><a href="${r}gallery.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Gallery">Gallery</a></li>
                        <li><a href="${r}about.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="About Us">About Us</a></li>
                        <li><a href="${r}blog.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Blog">Blog</a></li>
                        <li><a href="${r}contact.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Contact">Contact</a></li>
                        <li><a href="${r}enquiry.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Book a Site Visit">Book a Site Visit</a></li>
                    </ul>
                </nav>
                <nav class="lg:col-span-2" aria-label="Our projects">
                    <h2 class="!font-sans text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4">Our Projects</h2>
                    <ul class="space-y-1" id="footer-projects">${projectsHTML || ''}</ul>
                </nav>
                <nav class="lg:col-span-2" aria-label="Popular searches">
                    <h2 class="!font-sans text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4" data-c="seo_links_heading">${escapeHTML(k.seo_links_heading)}</h2>
                    <ul class="space-y-1" data-c-list="seo_links">${K.RENDER.seo_links(k.seo_links || [], kr)}</ul>
                </nav>
                <div class="lg:col-span-2">
                    <h2 class="!font-sans text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4">Contact</h2>
                    <address class="not-italic leading-relaxed">
                        <p data-c="address">${escapeHTML(k.address)}</p>
                        <div class="mt-2" data-c-list="@footer_phones">${K.RENDER['@footer_phones'](null, k)}</div>
                        <p><a href="${escapeHTML(k.email_href)}" class="inline-block py-1.5 hover:text-brand-gold break-all" aria-label="Email ${escapeHTML(k.email)}" data-c-attr="href:email_href"><span data-c="email">${escapeHTML(k.email)}</span></a></p>
                        <p class="mt-1" data-c="office_hours">${escapeHTML(k.office_hours)}</p>
                    </address>
                </div>
            </div>
            <div class="border-t border-white/10">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row justify-between items-center gap-3 text-center">
                    <div>
                        <p>&copy; <span data-c="year">${escapeHTML(k.year)}</span> <span data-c="business_legal_name">${escapeHTML(k.business_legal_name || k.business_name)}</span>. All rights reserved.</p>
                        <p class="text-xs text-gray-400 mt-1${k.registrations ? '' : ' hidden'}" data-c="registrations" data-c-show="registrations">${escapeHTML(k.registrations)}</p>
                    </div>
                    <a href="${r}privacy.html" class="inline-block py-1.5 hover:text-brand-gold" aria-label="Privacy Policy">Privacy Policy</a>
                </div>
            </div>
        </footer>`;
    }

    if (!isBrowser) {
        module.exports = { headerHTML, footerHTML };
        return;
    }

    /* ------------------------------------------------------------
     * Browser-only behaviour
     * ---------------------------------------------------------- */
    function renderHeader(active) {
        const slot = document.getElementById('site-header-root');
        if (slot) slot.outerHTML = headerHTML(active);
        initMobileMenu();
        initHeaderShadow();
    }

    function renderFooter() {
        const slot = document.getElementById('site-footer-root');
        if (slot) slot.outerHTML = footerHTML();
    }

    function initMobileMenu() {
        const btn = document.getElementById('mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        if (!btn || !menu) return;
        const icon = btn.querySelector('i');
        const setOpen = (open) => {
            menu.classList.toggle('hidden', !open);
            btn.setAttribute('aria-expanded', String(open));
            btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            icon.classList.toggle('fa-bars', !open);
            icon.classList.toggle('fa-xmark', open);
        };
        btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); });
        menu.querySelectorAll('.mobile-link').forEach((a) => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('click', (e) => {
            if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setOpen(false); btn.focus(); }
        });
        window.addEventListener('resize', () => { if (window.innerWidth >= 1024) setOpen(false); });
    }

    function initHeaderShadow() {
        const header = document.getElementById('site-header');
        const onScroll = () => header && header.classList.toggle('shadow-xl', window.scrollY > 10);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    function renderWhatsApp() {
        if (document.getElementById('wa-fab')) return;
        const a = document.createElement('a');
        a.id = 'wa-fab';
        a.href = waLink(`Hi ${CONTENT.business_name}, I would like to know more about your projects.`);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'wa-pulse fixed bottom-5 right-5 md:bottom-8 md:right-8 z-[90] w-14 h-14 md:w-16 md:h-16 rounded-full bg-[#1a9e51] hover:bg-[#15803d] text-white flex items-center justify-center shadow-2xl transition-transform hover:scale-110';
        a.setAttribute('aria-label', `Chat with ${CONTENT.business_name} on WhatsApp`);
        a.innerHTML = '<i class="fab fa-whatsapp text-3xl md:text-4xl" aria-hidden="true"></i>';
        document.body.appendChild(a);
    }

    /** Optional Google Analytics 4 (ID set in Admin → Website Content). Never on the admin page. */
    let analyticsOn = false;
    function initAnalytics() {
        const id = String(CONTENT.ga_id || '').trim();
        if (analyticsOn || !/^G-[A-Z0-9]+$/.test(id) || document.body.dataset.page === 'admin') return;
        analyticsOn = true;
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', id, { anonymize_ip: true });
    }

    /* ------------------------------------------------------------
     * Modal manager: overflow lock, focus trap, Escape, focus restore.
     * Closed modals are `inert` so hidden controls cannot be focused.
     * ---------------------------------------------------------- */
    const Modal = {
        active: null,
        lastFocus: null,
        onClose: {},
        open(id) {
            const modal = document.getElementById(id);
            if (!modal) return;
            if (this.active && this.active !== modal) this.close(false);
            this.lastFocus = document.activeElement;
            this.active = modal;
            modal.inert = false;
            modal.removeAttribute('inert');
            modal.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            const f = this.focusable(modal);
            if (f.length) setTimeout(() => f[0].focus(), 50);
        },
        close(restore = true) {
            const modal = this.active;
            if (!modal) return;
            modal.classList.remove('is-open');
            modal.inert = true;
            modal.setAttribute('inert', '');
            document.body.style.overflow = '';
            this.active = null;
            if (typeof this.onClose[modal.id] === 'function') this.onClose[modal.id]();
            if (restore && this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
        },
        focusable(el) {
            return Array.from(el.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'))
                .filter((n) => n.offsetParent !== null);
        },
        init() {
            document.querySelectorAll('.modal').forEach((m) => { if (!m.classList.contains('is-open')) { m.inert = true; m.setAttribute('inert', ''); } });
            document.addEventListener('click', (e) => {
                if (this.active && e.target.closest('[data-close-modal]')) this.close();
            });
            document.addEventListener('keydown', (e) => {
                if (!this.active) return;
                if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
                if (e.key !== 'Tab') return;
                const f = this.focusable(this.active);
                if (!f.length) return;
                const first = f[0], last = f[f.length - 1];
                if (!this.active.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
                else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            });
        }
    };

    /**
     * Centred confirmation dialog (replaces the browser's confirm()).
     * await AE.confirmDialog({ title, message, confirmText, cancelText, tone: 'danger' | 'warning' | 'primary' }) → true / false
     */
    function confirmDialog(opts = {}) {
        const o = Object.assign({ title: 'Are you sure?', message: '', confirmText: 'Confirm', cancelText: 'Cancel', tone: 'primary' }, opts);
        const tones = {
            danger: { ring: 'bg-red-50 text-red-600', btn: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-300', icon: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>' },
            warning: { ring: 'bg-amber-50 text-brand-orange', btn: 'bg-brand-orange hover:bg-brand-navy focus-visible:ring-amber-300', icon: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' },
            primary: { ring: 'bg-brand-cream text-brand-navy', btn: 'bg-brand-navy hover:bg-brand-orange focus-visible:ring-blue-200', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>' }
        };
        const t = tones[o.tone] || tones.primary;
        const last = document.activeElement;
        return new Promise((resolve) => {
            const root = document.createElement('div');
            root.className = 'ae-dialog fixed inset-0 z-[400] flex items-center justify-center p-4';
            root.innerHTML = `
                <div class="ae-dialog-backdrop absolute inset-0 bg-brand-ink/60 backdrop-blur-sm" data-dlg-cancel></div>
                <div class="ae-dialog-panel relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" role="alertdialog" aria-modal="true" aria-labelledby="ae-dlg-title" aria-describedby="ae-dlg-msg">
                    <div class="h-1.5 bg-gradient-to-r from-brand-navy via-brand-flame to-brand-gold" aria-hidden="true"></div>
                    <div class="p-6 sm:p-7 text-center">
                        <span class="mx-auto w-14 h-14 rounded-full ${t.ring} flex items-center justify-center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg></span>
                        <h2 id="ae-dlg-title" class="mt-4 text-xl font-extrabold text-brand-navy">${escapeHTML(o.title)}</h2>
                        <div id="ae-dlg-msg" class="mt-2 text-sm text-gray-600 leading-relaxed space-y-2">${String(o.message).split(/\n{2,}/).map((x) => `<p>${escapeHTML(x)}</p>`).join('')}</div>
                    </div>
                    <div class="px-6 sm:px-7 pb-6 sm:pb-7 flex flex-col-reverse sm:flex-row gap-3">
                        <button type="button" class="flex-1 px-5 py-3 rounded-lg border border-gray-300 text-brand-navy font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-200 transition" data-dlg-cancel>${escapeHTML(o.cancelText)}</button>
                        <button type="button" class="flex-1 px-5 py-3 rounded-lg text-white font-bold shadow-lg ${t.btn} focus:outline-none focus-visible:ring-4 transition" data-dlg-ok>${escapeHTML(o.confirmText)}</button>
                    </div>
                </div>`;
            const close = (val) => {
                document.removeEventListener('keydown', onKey, true);
                root.classList.add('is-closing');
                setTimeout(() => { root.remove(); document.body.style.overflow = prevOverflow; }, 160);
                if (last && last.focus) last.focus();
                resolve(val);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); close(false); }
                if (e.key === 'Tab') { // keep focus inside the dialog
                    const f = [...root.querySelectorAll('button')];
                    const i = f.indexOf(document.activeElement);
                    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
                    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
                }
            };
            root.addEventListener('click', (e) => {
                if (e.target.closest('[data-dlg-ok]')) close(true);
                else if (e.target.closest('[data-dlg-cancel]')) close(false);
            });
            const prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(root);
            root.querySelector(o.tone === 'danger' ? '[data-dlg-cancel].flex-1' : '[data-dlg-ok]').focus();
        });
    }

    function toast(message, type = 'success') {
        let wrap = document.getElementById('toast-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'toast-wrap';
            wrap.className = 'fixed top-24 right-4 left-4 sm:left-auto z-[300] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none';
            wrap.setAttribute('role', 'status');
            wrap.setAttribute('aria-live', 'polite');
            document.body.appendChild(wrap);
        }
        const colors = { success: 'bg-green-700', error: 'bg-red-700', info: 'bg-brand-navy' };
        const icons = { success: 'fa-circle-check', error: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        const el = document.createElement('div');
        el.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 pointer-events-auto sm:max-w-sm`;
        el.innerHTML = `<i class="fas ${icons[type] || icons.info}" aria-hidden="true"></i><span>${escapeHTML(message)}</span>`;
        wrap.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3500);
        setTimeout(() => el.remove(), 3900);
    }

    /** Validate a text/tel/email input against required/minlength/pattern; toggles its error element. */
    function validateField(el) {
        const err = document.getElementById(`${el.id}-error`);
        const value = el.value.trim();
        let valid = !el.required || value.length > 0;
        if (valid && value && el.minLength > 0) valid = value.length >= el.minLength;
        if (valid && value && el.pattern) valid = new RegExp(el.pattern).test(value);
        if (valid && value && el.type === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        el.classList.toggle('border-red-500', !valid);
        el.setAttribute('aria-invalid', String(!valid));
        if (err) err.classList.toggle('hidden', valid);
        return valid;
    }

    const PHONE_PATTERN = '^(\\+91[\\s-]?)?[6-9]\\d{4}[\\s-]?\\d{5}$';
    const manifest = () => window.AE_BUILD || { posts: [] };

    /* ------------------------------------------------------------
     * Website content: apply saved business info & texts to the page
     * ---------------------------------------------------------- */
    const contentListeners = [];
    const SITE = () => String(C.SITE_URL || '').replace(/\/$/, '');
    function setContent(c) {
        CONTENT = c;
        K.apply(document, Object.assign({}, c, { _root: R() }), SITE());
        const fab = document.getElementById('wa-fab');
        if (fab) {
            fab.href = waLink(`Hi ${c.business_name}, I would like to know more about your projects.`);
            fab.setAttribute('aria-label', `Chat with ${c.business_name} on WhatsApp`);
        }
        initAnalytics();
        contentListeners.forEach((fn) => { try { fn(c); } catch (e) { console.error(e); } });
    }
    /** Fill the footer "Our Projects" list (live first, then completed/sold). */
    async function loadFooterProjects() {
        const ul = document.getElementById('footer-projects');
        if (!ul || !window.Store) return;
        try {
            const all = await window.Store.list('projects');
            const ordered = all.filter((p) => p.stage === 'live').concat(all.filter((p) => p.stage !== 'live'));
            const html = T.footerProjects(ordered, window.AE.ctx());
            if (ul.innerHTML.trim() !== html.trim()) ul.innerHTML = html;
        } catch (e) { /* keep pre-rendered list */ }
    }

    async function loadContent() {
        if (!window.Store) return CONTENT;
        try { setContent(K.build(await window.Store.list('settings'))); }
        catch (e) { console.warn('Could not load website content', e); }
        return CONTENT;
    }

    window.AE = {
        C, escapeHTML, waLink, formatDate: T.formatDate, renderRichText: T.richText, T, K,
        /** Current website content (business info + page texts). */
        content,
        /** Run fn whenever website content is (re)loaded. */
        onContent(fn) { contentListeners.push(fn); },
        loadContent,
        headerHTML, footerHTML, renderHeader, renderFooter, renderWhatsApp,
        Modal, toast, confirmDialog, validateField, PHONE_PATTERN,
        /** Context for templates: site root + list of pre-rendered post slugs. */
        ctx: () => ({ root: R(), builtPosts: manifest().posts || [], builtProjects: manifest().projects || [], c: CONTENT }),
        root: R,
        /** Render header + footer (if not pre-rendered), WhatsApp button, modals, analytics. */
        layout(active) {
            renderHeader(active);
            renderFooter();
            renderWhatsApp();
            Modal.init();
            setContent(CONTENT);
            loadContent();
            if (window.Store) {
                window.Store.onChange((col) => { if (col === 'settings') loadContent(); if (col === 'projects') loadFooterProjects(); });
                loadFooterProjects();
            }
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
