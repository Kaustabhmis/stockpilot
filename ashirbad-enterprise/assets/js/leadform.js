/**
 * Ashirbad Enterprise – site-visit lead form (#leadForm)
 * Shared by the home page and the enquiry landing page.
 * Usage: AE.initLeadForm({ source: 'Home page – site visit' })
 */
(function () {
    'use strict';
    const AE = window.AE;

    AE.initLeadForm = function ({ source = 'Landing page – site visit', cards = null } = {}) {
        const form = document.getElementById('leadForm');
        if (!form) return;
        const { escapeHTML, waLink, validateField, PHONE_PATTERN } = AE;
        const $ = (id) => document.getElementById(id);

        const params = new URLSearchParams(location.search);
        const utm = {};
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((k) => { if (params.get(k)) utm[k] = params.get(k); });

        const setContactLinks = (c) => { const wa = $('landing-wa'); if (wa) wa.href = waLink(`Hi ${c.business_name}, I would like to book a site visit.`); };
        setContactLinks(AE.content());
        AE.onContent(setContactLinks);

        $('lf-visit').min = new Date().toISOString().slice(0, 10);

        /* ---------- Live projects (dropdown + optional cards) ---------- */
        async function loadProjects() {
            try {
                const live = (await Store.list('projects')).filter((p) => p.stage === 'live');
                const select = $('lf-project');
                const current = select.value || params.get('project') || '';
                select.innerHTML = '<option value="">Not decided yet</option>' +
                    live.map((p) => `<option value="${escapeHTML(p.title)}">${escapeHTML(p.title)} – ${escapeHTML(p.location)}</option>`).join('');
                if (current && live.some((p) => p.title === current)) select.value = current;
                if (cards) cards(live);
            } catch (ex) {
                console.error(ex);
            }
        }

        /** Pre-select a project and jump to the form (any element with data-pick="Project title"). */
        document.addEventListener('click', (e) => {
            const pick = e.target.closest('[data-pick]');
            if (!pick) return;
            e.preventDefault();
            const select = $('lf-project');
            if ([...select.options].some((o) => o.value === pick.dataset.pick)) select.value = pick.dataset.pick;
            $('enquiry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => $('lf-name').focus({ preventScroll: true }), 500);
        });

        /* ---------- Form ---------- */
        const nameEl = $('lf-name');
        const phoneEl = $('lf-phone');
        const emailEl = $('lf-email');
        const consent = $('lf-consent');
        const btn = $('lf-submit');
        const errBox = $('lf-error');
        phoneEl.pattern = PHONE_PATTERN;
        [nameEl, phoneEl, emailEl].forEach((el) => el.addEventListener('blur', () => { if (el.value) validateField(el); }));

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errBox.classList.add('hidden');
            const invalid = [nameEl, phoneEl, emailEl].filter((el) => !validateField(el));
            const consentOk = consent.checked;
            $('lf-consent-error').classList.toggle('hidden', consentOk);
            if (invalid.length) { invalid[0].focus(); return; }
            if (!consentOk) { consent.focus(); return; }

            const fd = new FormData(form);
            if (fd.get('website')) return; // honeypot triggered – silently ignore bots

            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Processing...</span>';
            const lead = {
                name: fd.get('name').trim(),
                phone: fd.get('phone').trim(),
                email: fd.get('email').trim(),
                interest: fd.get('interest'),
                project: fd.get('project'),
                config: fd.get('config'),
                budget: fd.get('budget'),
                location: fd.get('location'),
                visit_date: fd.get('visit_date'),
                message: [fd.get('message').trim(), fd.get('call_time') ? `Best time to call: ${fd.get('call_time')}` : ''].filter(Boolean).join('\n'),
                source,
                utm: Object.keys(utm).length ? utm : null
            };
            try {
                await Promise.all([Store.addLead(lead), new Promise((r) => setTimeout(r, 800))]);
                $('ls-name').textContent = lead.name.split(' ')[0];
                $('ls-wa').href = waLink(`Hi, I'm ${lead.name}. I just requested a site visit${lead.project ? ` for ${lead.project}` : ''}.`);
                $('lead-form-wrap').classList.add('hidden');
                const ok = $('lead-success');
                ok.classList.remove('hidden');
                ok.focus();
                // Conversion hooks for analytics / ad pixels, if installed
                if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { event_category: 'enquiry', event_label: lead.project || 'general' });
                if (typeof window.fbq === 'function') window.fbq('track', 'Lead');
            } catch (ex) {
                console.error(ex);
                errBox.textContent = `Sorry, something went wrong. Please call ${AE.content().phone} or message us on WhatsApp.`;
                errBox.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        });

        $('ls-again').addEventListener('click', () => {
            form.reset();
            $('lead-success').classList.add('hidden');
            $('lead-form-wrap').classList.remove('hidden');
            nameEl.focus();
        });

        loadProjects();
        Store.onChange((c) => { if (c === 'projects') loadProjects(); });
    };
})();
