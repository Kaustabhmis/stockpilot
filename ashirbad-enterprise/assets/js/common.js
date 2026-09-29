/**
 * Ashirbad Enterprise – shared layout & helpers
 * Load synchronously right after the Tailwind CDN script so the theme applies.
 */
(function () {
    'use strict';

    if (window.tailwind) {
        window.tailwind.config = {
            theme: {
                extend: {
                    colors: { brand: { navy: '#12304d', orange: '#e66825', gold: '#e6a845', cream: '#fdf8ee' } },
                    fontFamily: {
                        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
                    }
                }
            }
        };
    }

    const C = window.APP_CONFIG || {};

    const escapeHTML = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const waLink = (text) => `https://wa.me/${C.WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

    const formatDate = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (isNaN(d)) return String(value);
        return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    };

    /** Safe mini-markup for blog content: blank line = paragraph, "## " = heading, "- " = bullet. */
    function renderRichText(text) {
        const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
        return blocks.map((block) => {
            const lines = block.split('\n').filter((l) => l.trim() !== '');
            if (!lines.length) return '';
            let html = '';
            let list = [];
            const flushList = () => {
                if (list.length) html += `<ul class="list-disc pl-6 space-y-1 my-4">${list.map((li) => `<li>${escapeHTML(li)}</li>`).join('')}</ul>`;
                list = [];
            };
            let para = [];
            const flushPara = () => {
                if (para.length) html += `<p class="my-4 leading-relaxed">${para.map(escapeHTML).join('<br>')}</p>`;
                para = [];
            };
            lines.forEach((line) => {
                const l = line.trim();
                if (/^###?\s+/.test(l)) {
                    flushPara(); flushList();
                    html += `<h2 class="text-xl md:text-2xl font-bold text-brand-navy mt-8 mb-3">${escapeHTML(l.replace(/^###?\s+/, ''))}</h2>`;
                } else if (/^[-*]\s+/.test(l)) {
                    flushPara();
                    list.push(l.replace(/^[-*]\s+/, ''));
                } else {
                    flushList();
                    para.push(l);
                }
            });
            flushPara(); flushList();
            return html;
        }).join('');
    }

    /* ------------------------------------------------------------
     * Header / Footer / WhatsApp
     * ---------------------------------------------------------- */
    function renderHeader(active) {
        const onHome = active === 'home';
        const h = (hash) => (onHome ? hash : `index.html${hash}`);
        const links = [
            { href: h('#ongoing-projects'), label: 'Ongoing Projects', aria: 'View ongoing projects' },
            { href: h('#commercial-properties'), label: 'Commercial', aria: 'View commercial properties' },
            { href: h('#past-projects-gallery'), label: 'Gallery', aria: 'View completed projects gallery' },
            { href: h('#project-locations'), label: 'Map View', aria: 'View project locations on map' },
            { href: h('#about-us'), label: 'About Us', aria: 'Learn about Ashirbad Enterprise' },
            { href: 'blog.html', label: 'Blog', aria: 'Read our blog', key: 'blog' },
            { href: h('#contact-us'), label: 'Contact', aria: 'Contact Ashirbad Enterprise' }
        ];
        const cls = (l) => (l.key && l.key === active ? 'text-brand-orange' : 'text-brand-navy');
        const root = document.getElementById('site-header-root');
        if (!root) return;
        root.outerHTML = `
        <header id="site-header" class="bg-white shadow-md fixed w-full z-[100] top-0 transition-all duration-300">
            <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main Navigation">
                <div class="flex justify-between h-20 items-center gap-4">
                    <a href="${onHome ? '#ongoing-projects' : 'index.html'}" class="flex-shrink-0 flex items-center gap-2 sm:gap-3 min-w-0" aria-label="Ashirbad Enterprise - Go to home page">
                        <img src="1000365300.jpg" alt="Ashirbad Enterprise logo - Om, kalash and lotus above city towers" class="h-12 w-12 sm:h-14 sm:w-14 object-contain rounded" width="56" height="56">
                        <span class="font-extrabold text-lg sm:text-2xl text-brand-navy tracking-tight truncate">Ashirbad <span class="text-brand-orange">Enterprise</span></span>
                    </a>
                    <div class="hidden xl:flex items-center gap-6 text-[15px]">
                        ${links.map((l) => `<a href="${l.href}" class="nav-link ${cls(l)} font-medium hover:text-brand-orange transition whitespace-nowrap" aria-label="${l.aria}"${l.key === active ? ' aria-current="page"' : ''}>${l.label}</a>`).join('')}
                        <a href="enquiry.html" class="bg-brand-orange text-white font-semibold px-4 py-2.5 rounded shadow hover:bg-brand-navy transition whitespace-nowrap" aria-label="Book a site visit">Book Site Visit</a>
                    </div>
                    <div class="flex xl:hidden items-center">
                        <button id="mobile-menu-btn" type="button" class="text-brand-navy hover:text-brand-orange focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange rounded p-3 -mr-2 transition-colors" aria-label="Open mobile menu" aria-controls="mobile-menu" aria-expanded="false">
                            <i class="fas fa-bars text-2xl w-6 text-center" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </nav>
            <div id="mobile-menu" class="hidden xl:hidden bg-white border-t border-gray-100 shadow-xl absolute w-full left-0 max-h-[calc(100vh-5rem)] overflow-y-auto">
                <div class="px-4 pt-2 pb-6 flex flex-col space-y-1">
                    ${links.map((l) => `<a href="${l.href}" class="mobile-link block px-4 py-3 text-base font-bold ${cls(l)} hover:text-brand-orange hover:bg-amber-50 rounded-md" aria-label="${l.aria}">${l.label}</a>`).join('')}
                    <a href="enquiry.html" class="mobile-link block px-4 py-3 text-base font-bold text-center bg-brand-orange text-white rounded-md mt-4 hover:bg-brand-navy shadow-md" aria-label="Book a site visit">Book Site Visit</a>
                </div>
            </div>
        </header>`;
        initMobileMenu();
        initHeaderShadow();
    }

    function initMobileMenu() {
        const btn = document.getElementById('mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        if (!btn || !menu) return;
        const icon = btn.querySelector('i');
        const setOpen = (open) => {
            menu.classList.toggle('hidden', !open);
            btn.setAttribute('aria-expanded', String(open));
            btn.setAttribute('aria-label', open ? 'Close mobile menu' : 'Open mobile menu');
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
        window.addEventListener('resize', () => { if (window.innerWidth >= 1280) setOpen(false); });
    }

    function initHeaderShadow() {
        const header = document.getElementById('site-header');
        const onScroll = () => header && header.classList.toggle('shadow-xl', window.scrollY > 10);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    function renderFooter() {
        const root = document.getElementById('site-footer-root');
        if (!root) return;
        const year = new Date().getFullYear();
        root.outerHTML = `
        <footer class="bg-[#0b1f33] text-gray-400 text-sm">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                <div class="lg:col-span-2">
                    <a href="index.html" class="inline-flex items-center gap-3" aria-label="Ashirbad Enterprise home">
                        <img src="1000365300.jpg" alt="Ashirbad Enterprise logo" class="h-14 w-14 rounded bg-white p-1 object-contain" width="56" height="56" loading="lazy">
                        <span class="text-white font-extrabold text-xl">Ashirbad <span class="text-brand-orange">Enterprise</span></span>
                    </a>
                    <p class="mt-4 max-w-md leading-relaxed">RERA registered real estate builders and developers in Kolkata, delivering residential apartments and commercial property built on trust for over 15 years.</p>
                </div>
                <nav aria-label="Footer quick links">
                    <h2 class="text-white font-bold mb-3">Quick Links</h2>
                    <ul class="space-y-2">
                        <li><a href="index.html#ongoing-projects" class="hover:text-brand-gold" aria-label="Ongoing projects">Ongoing Projects</a></li>
                        <li><a href="index.html#past-projects-gallery" class="hover:text-brand-gold" aria-label="Completed projects gallery">Completed Projects</a></li>
                        <li><a href="blog.html" class="hover:text-brand-gold" aria-label="Blog and market insights">Blog &amp; Insights</a></li>
                        <li><a href="enquiry.html" class="hover:text-brand-gold" aria-label="Book a site visit">Book a Site Visit</a></li>
                    </ul>
                </nav>
                <address class="not-italic">
                    <h2 class="text-white font-bold mb-3">Contact</h2>
                    <p class="leading-relaxed">${escapeHTML(C.ADDRESS)}</p>
                    <p class="mt-2"><a href="tel:${escapeHTML(C.PHONE)}" class="hover:text-brand-gold" aria-label="Call ${escapeHTML(C.PHONE_DISPLAY)}"><i class="fas fa-phone mr-2" aria-hidden="true"></i>${escapeHTML(C.PHONE_DISPLAY)}</a></p>
                    <p class="mt-1"><a href="mailto:${escapeHTML(C.EMAIL)}" class="hover:text-brand-gold break-all" aria-label="Email us"><i class="fas fa-envelope mr-2" aria-hidden="true"></i>${escapeHTML(C.EMAIL)}</a></p>
                </address>
            </div>
            <div class="border-t border-white/10">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row justify-between items-center gap-3 text-center">
                    <p>&copy; ${year} Ashirbad Enterprise. All rights reserved.</p>
                    <nav class="flex items-center gap-5" aria-label="Legal">
                        <a href="privacy.html" class="hover:text-brand-gold" aria-label="Read our privacy policy">Privacy Policy</a>
                    </nav>
                </div>
            </div>
        </footer>`;
    }

    function renderWhatsApp() {
        if (document.getElementById('wa-fab')) return;
        const a = document.createElement('a');
        a.id = 'wa-fab';
        a.href = waLink('Hi Ashirbad Enterprise, I would like to know more about your projects.');
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'wa-pulse fixed bottom-5 right-5 md:bottom-8 md:right-8 z-[90] w-14 h-14 md:w-16 md:h-16 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] text-white flex items-center justify-center shadow-2xl transition-transform hover:scale-110';
        a.setAttribute('aria-label', 'Chat with Ashirbad Enterprise on WhatsApp');
        a.innerHTML = '<i class="fab fa-whatsapp text-3xl md:text-4xl" aria-hidden="true"></i>';
        document.body.appendChild(a);
    }

    /* ------------------------------------------------------------
     * Modal manager: overflow lock, focus trap, Escape, focus restore
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
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            const f = this.focusable(modal);
            if (f.length) setTimeout(() => f[0].focus(), 50);
        },
        close(restore = true) {
            const modal = this.active;
            if (!modal) return;
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
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

    /* ------------------------------------------------------------
     * Toast
     * ---------------------------------------------------------- */
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
        const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-brand-navy' };
        const icons = { success: 'fa-circle-check', error: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        const el = document.createElement('div');
        el.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 pointer-events-auto sm:max-w-sm`;
        el.innerHTML = `<i class="fas ${icons[type] || icons.info}" aria-hidden="true"></i><span>${escapeHTML(message)}</span>`;
        wrap.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3500);
        setTimeout(() => el.remove(), 3900);
    }

    /** Validate a required text/tel input against its minlength/pattern; toggles its error element. */
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

    window.AE = {
        C, escapeHTML, waLink, formatDate, renderRichText,
        renderHeader, renderFooter, renderWhatsApp,
        Modal, toast, validateField, PHONE_PATTERN,
        /** Render header + footer + WhatsApp button and wire modals. */
        layout(active) {
            renderHeader(active);
            renderFooter();
            renderWhatsApp();
            Modal.init();
        }
    };
})();
