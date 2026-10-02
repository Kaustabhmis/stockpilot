/**
 * Ashirbad Enterprise – free "lite" map (Leaflet + OpenStreetMap / CARTO light tiles)
 * No API key, no billing. Leaflet loads only when the map scrolls into view.
 *
 *   AE.liteMap(el, pins, { zoom })   pins: [{ lat, lng, title, color, popup }]
 *   <div data-lite-map data-lat=".." data-lng=".." data-title=".."></div>   auto-initialised
 */
(function () {
    'use strict';
    const AE = window.AE || (window.AE = {});
    const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
    let loading = null;

    function loadLeaflet() {
        if (window.L) return Promise.resolve(window.L);
        if (loading) return loading;
        loading = new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = CDN + 'leaflet.min.css';
            document.head.appendChild(css);
            const s = document.createElement('script');
            s.src = CDN + 'leaflet.min.js';
            s.async = true;
            s.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet missing')));
            s.onerror = () => { loading = null; reject(new Error('Map library could not load')); };
            document.head.appendChild(s);
        });
        return loading;
    }

    /** Run fn once el is near the viewport (keeps the page fast). */
    function whenVisible(el, fn) {
        if (!('IntersectionObserver' in window)) return fn();
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
        }, { rootMargin: '300px' });
        io.observe(el);
    }

    const pinIcon = (L, color) => L.divIcon({
        className: 'ae-pin',
        html: `<svg width="30" height="40" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.5 12 32 12 32s12-11.5 12-20.3C24 5.2 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11.5" r="4.2" fill="#fff"/></svg>`,
        iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36]
    });

    const valid = (p) => p && p.lat !== '' && p.lng !== '' && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng));

    /**
     * Draw (or redraw) a map in el. Returns a promise of the Leaflet map, or null when it could not load
     * (the element then keeps its fallback content).
     */
    AE.liteMap = function (el, pins, opts = {}) {
        const list = (pins || []).filter(valid);
        return new Promise((resolve) => {
            whenVisible(el, async () => {
                let L;
                try { L = await loadLeaflet(); } catch (e) { if (opts.onFail) opts.onFail(e); resolve(null); return; }
                if (el._aeMap) { el._aeMap.remove(); el._aeMap = null; }
                el.innerHTML = '';
                const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
                el._aeMap = map;
                L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                    subdomains: 'abcd', maxZoom: 19,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                }).addTo(map);
                // Scroll-zoom only after the visitor clicks the map, so the page scrolls normally
                map.on('click focus', () => map.scrollWheelZoom.enable());
                map.on('mouseout blur', () => map.scrollWheelZoom.disable());

                const markers = list.map((p) => {
                    const m = L.marker([Number(p.lat), Number(p.lng)], { icon: pinIcon(L, p.color || '#12304d'), title: p.title, alt: p.title, keyboard: true }).addTo(map);
                    if (p.popup) m.bindPopup(p.popup, { maxWidth: 260, minWidth: 220, className: 'ae-popup' });
                    return m;
                });
                if (markers.length > 1) map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [40, 40], maxZoom: 15 });
                else if (markers.length === 1) map.setView(markers[0].getLatLng(), opts.zoom || 15);
                else map.setView([22.5726, 88.3939], 11); // Kolkata
                resolve(map);
            });
        });
    };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    /** Single-pin maps written into the page as <div data-lite-map …> (project page, contact page). */
    AE.initLiteMaps = function (root = document) {
        root.querySelectorAll('[data-lite-map]').forEach((el) => {
            const p = { lat: el.dataset.lat, lng: el.dataset.lng, title: el.dataset.title || '', color: el.dataset.color };
            if (!valid(p)) return;
            const key = `${p.lat},${p.lng},${p.title}`;
            if (el.dataset.mapKey === key) return;
            el.dataset.mapKey = key;
            p.popup = `<strong style="font-family:Manrope,sans-serif;color:#12304d">${esc(p.title)}</strong>${el.dataset.address ? `<br><span style="font-size:12px;color:#555">${esc(el.dataset.address)}</span>` : ''}`;
            AE.liteMap(el, [p], { zoom: Number(el.dataset.zoom) || 15 });
        });
    };

    const boot = () => AE.initLiteMaps();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
