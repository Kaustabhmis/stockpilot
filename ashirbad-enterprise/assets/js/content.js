/**
 * Ashirbad Enterprise – editable website content
 * ---------------------------------------------------------------
 * Every business detail and page text is defined here with its default
 * value. Admins edit them in Admin → Website Content; values are stored
 * in the "settings" tab of the private Google Sheet (one row per key).
 *
 * Pages mark editable spots with attributes, filled by apply():
 *   data-c="key"                   text content
 *   data-c="key" data-c-mode="lines"  text with line breaks
 *   data-c="key" data-c-mode="paras"  paragraphs (blank line = new paragraph)
 *   data-c-attr="href:phone_href;aria-label:phone"  attributes
 *   data-c-list="key"              list rendered by RENDER[key]
 *   data-c-show="key"              hidden when the value/list is empty
 * The same apply() runs in the browser and in tools/build.mjs, so the
 * pre-rendered SEO pages always match what the admin saved.
 */
(function (root) {
    'use strict';

    const T = root.AET || (typeof require === 'function' ? require('./templates.js') : null);
    const esc = T.esc;

    /* ------------------------------------------------------------
     * Schema: groups → fields (type, label, default, help)
     * ---------------------------------------------------------- */
    const GROUPS = [
        {
            id: 'business', title: 'Business Information', icon: 'fa-building',
            description: 'Company name, contact details, address, registration numbers and office hours. Used across every page, the footer, WhatsApp buttons and Google structured data.',
            fields: [
                { key: 'business_name', label: 'Business name', default: 'Ashirbad Enterprise', required: true },
                { key: 'business_legal_name', label: 'Legal / registered name', default: 'Ashirbad Enterprise', help: 'Shown in the copyright line and structured data.' },
                { key: 'tagline', label: 'Tagline', default: 'RERA Approved Real Estate Builders in Kolkata' },
                { key: 'phone', label: 'Phone number (display)', default: '+91 98765 43210', required: true, help: 'As visitors should see it. The call link is created automatically.' },
                { key: 'phone_alt', label: 'Second phone number (optional)', default: '' },
                { key: 'whatsapp', label: 'WhatsApp number', default: '919876543210', required: true, help: 'Country code + number, digits only (e.g. 919876543210).' },
                { key: 'email', label: 'Email', default: 'info@ashirbadenterprise.com', required: true },
                { key: 'address_street', label: 'Street address', default: 'Rajarhat Expressway' },
                { key: 'address_city', label: 'City', default: 'Kolkata' },
                { key: 'address_state', label: 'State', default: 'West Bengal' },
                { key: 'address_pin', label: 'PIN code', default: '700156' },
                { key: 'office_lat', label: 'Office latitude', default: '22.5979', help: 'For Google Maps and local SEO. Right-click your office in Google Maps to copy it.' },
                { key: 'office_lng', label: 'Office longitude', default: '88.4608' },
                { key: 'office_hours', label: 'Office hours (display)', default: 'Mon – Sat: 10:00 AM – 7:00 PM' },
                { key: 'open_days', label: 'Open days', default: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday', help: 'Comma separated – used by Google.' },
                { key: 'open_time', label: 'Opening time (24h)', default: '10:00' },
                { key: 'close_time', label: 'Closing time (24h)', default: '19:00' },
                { key: 'company_rera', label: 'Company WBRERA registration no.', default: '', help: 'Promoter / agent registration. Project numbers are set on each project.' },
                { key: 'gstin', label: 'GSTIN (optional)', default: '' },
                { key: 'cin', label: 'CIN / company registration (optional)', default: '' },
                { key: 'founded_year', label: 'Founded (year)', default: '2010' },
                { key: 'service_areas', label: 'Areas served', default: 'Kolkata, Rajarhat, New Town, Salt Lake, Behala, West Bengal', help: 'Comma separated.' },
                { key: 'languages', label: 'Languages spoken', default: 'English, Hindi, Bengali', help: 'Comma separated.' },
                { key: 'footer_about', label: 'Footer description', type: 'textarea', default: 'RERA registered real estate builders and developers in Kolkata, delivering residential apartments and commercial property built on trust for over 15 years.' }
            ]
        },
        {
            id: 'social', title: 'Social Media & Integrations', icon: 'fa-share-nodes',
            description: 'Social profiles appear in the footer and in Google structured data. Integrations switch on the map, analytics and search-engine verification.',
            fields: [
                { key: 'social_facebook', label: 'Facebook page URL', type: 'url', default: '' },
                { key: 'social_instagram', label: 'Instagram URL', type: 'url', default: '' },
                { key: 'social_youtube', label: 'YouTube URL', type: 'url', default: '' },
                { key: 'social_linkedin', label: 'LinkedIn URL', type: 'url', default: '' },
                { key: 'google_maps_key', label: 'Google Maps API key', default: '', help: 'Enables the interactive map. Restrict the key to your domain in Google Cloud Console.' },
                { key: 'ga_id', label: 'Google Analytics 4 ID', default: '', help: 'Looks like G-XXXXXXXXXX.' },
                { key: 'google_verification', label: 'Google Search Console verification code', default: '', help: 'Only the content="…" value of the HTML tag.' },
                { key: 'bing_verification', label: 'Bing Webmaster verification code', default: '' },
                { key: 'carousel_seconds', label: 'Carousel: seconds per project', type: 'number', default: '10' }
            ]
        },
        {
            id: 'seo', title: 'SEO (Google Titles & Descriptions)', icon: 'fa-magnifying-glass',
            description: 'What Google shows in search results. Keep titles under 60 and descriptions under 160 characters.',
            fields: [
                { key: 'seo_home_title', label: 'Home page title', default: 'Ashirbad Enterprise | RERA Approved Builders in Kolkata', max: 60 },
                { key: 'seo_home_description', label: 'Home page description', type: 'textarea', default: 'RERA approved flats & commercial property in Kolkata by Ashirbad Enterprise. Projects in New Town, Rajarhat, Salt Lake & Behala. 15+ years, 25 delivered.', max: 160 },
                { key: 'seo_home_keywords', label: 'Home page keywords', type: 'textarea', default: 'Real estate builders in Kolkata, RERA approved projects Kolkata, commercial property Kolkata, flats in Rajarhat, apartments in New Town, office space Salt Lake, retail shops Kolkata, residential plots West Bengal, property developer Kolkata, 2 BHK flats Kolkata, 3 BHK flats Kolkata' },
                { key: 'seo_share_description', label: 'Social share description (WhatsApp / Facebook)', type: 'textarea', default: 'RERA approved residential projects and commercial property in Kolkata. Explore ongoing projects, completed landmarks and book a free site visit.', max: 200 },
                { key: 'seo_blog_title', label: 'Blog page title', default: 'Real Estate Blog Kolkata | Ashirbad Enterprise', max: 60 },
                { key: 'seo_blog_description', label: 'Blog page description', type: 'textarea', default: 'Kolkata property guides, RERA tips, commercial investment advice and construction updates from Ashirbad Enterprise, RERA approved builders.', max: 160 },
                { key: 'seo_enquiry_title', label: 'Landing page title', default: 'Book a Free Site Visit – Flats in Kolkata | Ashirbad', max: 60 },
                { key: 'seo_enquiry_description', label: 'Landing page description', type: 'textarea', default: 'Buying a flat in Kolkata? Book a free site visit to RERA approved 1–4 BHK apartments in New Town, Rajarhat, Salt Lake & Behala. Get the price list today.', max: 160 }
            ]
        },
        {
            id: 'home', title: 'Home Page', icon: 'fa-house',
            description: 'Headings and text for each section of the home page.',
            fields: [
                { key: 'hero_heading', label: 'Top heading over the carousel (H1)', default: 'RERA Approved Real Estate Builders in Kolkata' },
                { key: 'commercial_eyebrow', label: 'Commercial – small label', default: 'For Business' },
                { key: 'commercial_heading', label: 'Commercial – heading', default: 'Commercial Property in Kolkata' },
                { key: 'commercial_intro', label: 'Commercial – intro', type: 'textarea', default: 'Prime office spaces, retail showrooms and warehouses engineered for enterprise growth and high rental yields.' },
                { key: 'gallery_eyebrow', label: 'Gallery – small label', default: 'Our Legacy' },
                { key: 'gallery_heading', label: 'Gallery – heading', default: 'Completed & Sold Out Projects' },
                { key: 'gallery_intro', label: 'Gallery – intro', type: 'textarea', default: 'Explore our legacy of delivered promises and sold-out landmarks across Kolkata. Tap any project to view its photo gallery.' },
                { key: 'map_eyebrow', label: 'Map – small label', default: 'Map View' },
                { key: 'map_heading', label: 'Map – heading', default: 'Explore Our Project Locations' },
                { key: 'map_intro', label: 'Map – intro', type: 'textarea', default: 'Interactive map featuring our ongoing developments and successfully delivered projects across Kolkata.' },
                { key: 'about_eyebrow', label: 'About – small label', default: 'About Us' },
                { key: 'about_heading', label: 'About – heading', default: 'Building The Future with Trust in Kolkata' },
                { key: 'about_body', label: 'About – text', type: 'textarea', rows: 6, help: 'Leave a blank line between paragraphs.', default: 'At Ashirbad Enterprise, we specialise in transforming prime plots into landmark residential and commercial infrastructure. Guided by traditional values and modern engineering, we oversee every phase of development, from soil testing and groundwork to final handover.\n\nOur in-house architectural planning, transparent pricing and strict adherence to WBRERA compliance ensure that your investment is secure and built to stand the test of time.' },
                { key: 'about_image', label: 'About – image', type: 'image', default: 'https://images.unsplash.com/photo-1541881451962-7e045053420b?ixlib=rb-4.0.3&auto=format&fit=crop&w=900&q=80' },
                { key: 'about_image_alt', label: 'About – image description (alt text)', default: 'Construction site with cranes and a residential tower under development in Kolkata' },
                { key: 'about_badge', label: 'About – badge on image', type: 'textarea', rows: 2, default: '100% RERA\nCompliant' },
                { key: 'about_points', label: 'About – key points', type: 'list', item: [{ key: 'text', label: 'Point' }], default: [{ text: 'RERA registered projects' }, { text: 'On-time possession record' }, { text: 'Bank loan assistance' }, { text: 'Earthquake resistant design' }] },
                { key: 'stats', label: 'About – numbers', type: 'list', item: [{ key: 'value', label: 'Number (e.g. 15+)' }, { key: 'label', label: 'Label' }], default: [{ value: '15+', label: 'Years Experience' }, { value: '25', label: 'Projects Delivered' }] },
                { key: 'blog_eyebrow', label: 'Blog – small label', default: 'Knowledge Hub' },
                { key: 'blog_heading', label: 'Blog – heading', default: 'Market Insights & News' },
                { key: 'blog_intro', label: 'Blog – intro', type: 'textarea', default: 'Expert guides and updates on the Kolkata real estate market.' },
                { key: 'contact_eyebrow', label: 'Contact – small label', default: 'Get In Touch' },
                { key: 'contact_heading', label: 'Contact – heading', default: 'Contact The Builders Directly' },
                { key: 'contact_intro', label: 'Contact – intro', type: 'textarea', default: 'Share your requirements and our project head will get back to you within 24 hours.' },
                { key: 'contact_success', label: 'Contact – thank-you message', type: 'textarea', default: 'Your enquiry has been received. Our project head will contact you shortly.' }
            ]
        },
        {
            id: 'landing', title: 'Landing Page (Book Site Visit)', icon: 'fa-bullhorn',
            description: 'Texts on enquiry.html – the page you link from ads and WhatsApp.',
            fields: [
                { key: 'lp_badge', label: 'Top badge', default: 'WBRERA Registered Projects' },
                { key: 'lp_heading', label: 'Heading (line 1)', default: 'Your Dream Home in Kolkata' },
                { key: 'lp_heading_highlight', label: 'Heading (line 2, highlighted)', default: 'Starts With One Visit' },
                { key: 'lp_intro', label: 'Intro text', type: 'textarea', default: 'Tell us what you are looking for and get the latest price list, floor plans and a free site visit to our RERA approved 1, 2, 3 & 4 BHK apartments.' },
                { key: 'lp_benefits', label: 'Benefits (4 recommended)', type: 'list', item: [{ key: 'title', label: 'Title' }, { key: 'text', label: 'Short text' }], default: [
                    { title: 'Free pick-up & drop', text: 'For site visits within Kolkata' },
                    { title: 'Transparent pricing', text: 'No hidden charges' },
                    { title: 'Home loan assistance', text: 'Approved by leading banks' },
                    { title: 'On-time possession', text: '25 projects delivered' }] },
                { key: 'lp_form_title', label: 'Form heading', default: 'Book Your Free Site Visit' },
                { key: 'lp_submit', label: 'Form button text', default: 'Get Price List & Book Visit' },
                { key: 'lp_success', label: 'Thank-you message', type: 'textarea', default: 'Your enquiry has been received. Our sales team will call you shortly to confirm your site visit.' },
                { key: 'lp_budgets', label: 'Budget options', type: 'list', item: [{ key: 'text', label: 'Option' }], default: ['Under ₹40 Lakh', '₹40 – 60 Lakh', '₹60 – 80 Lakh', '₹80 Lakh – 1 Cr', '₹1 – 1.5 Cr', 'Above ₹1.5 Cr'].map((text) => ({ text })) },
                { key: 'lp_locations', label: 'Location options', type: 'list', item: [{ key: 'text', label: 'Option' }], default: ['New Town', 'Rajarhat', 'Salt Lake', 'Behala', 'EM Bypass', 'North Kolkata', 'South Kolkata', 'Howrah'].map((text) => ({ text })) },
                { key: 'lp_projects_eyebrow', label: 'Projects – small label', default: 'Now Selling' },
                { key: 'lp_projects_heading', label: 'Projects – heading', default: 'Choose Your New Address' },
                { key: 'lp_steps_heading', label: 'Steps – heading', default: 'Buying With Us Is Simple' },
                { key: 'lp_steps', label: 'Steps', type: 'list', item: [{ key: 'title', label: 'Title' }, { key: 'text', label: 'Short text' }], default: [
                    { title: 'Share Your Needs', text: 'Fill the form with your budget and preferred location.' },
                    { title: 'Get a Callback', text: 'Our advisor shares price lists and floor plans.' },
                    { title: 'Free Site Visit', text: 'See the site, show flat and documents in person.' },
                    { title: 'Book Your Home', text: 'Choose your unit with a milestone-linked payment plan.' }] },
                { key: 'testimonials_heading', label: 'Testimonials – heading', default: 'What Our Home Owners Say' },
                { key: 'testimonials', label: 'Testimonials (real customers only)', type: 'list', help: 'Use genuine reviews with the customer\'s permission. The section is hidden while empty.', item: [{ key: 'name', label: 'Customer name' }, { key: 'project', label: 'Project' }, { key: 'quote', label: 'Review', type: 'textarea' }, { key: 'rating', label: 'Stars (1–5)', type: 'number' }], default: [] },
                { key: 'faq_heading', label: 'FAQ – heading', default: 'Frequently Asked Questions' },
                { key: 'faq', label: 'FAQ (also shown to Google)', type: 'list', item: [{ key: 'q', label: 'Question' }, { key: 'a', label: 'Answer', type: 'textarea' }], default: [
                    { q: 'Are your projects RERA approved?', a: 'Yes. Every residential project we sell is registered with WBRERA and the registration number is shared before booking.' },
                    { q: 'Is the site visit free?', a: 'Yes. Site visits are completely free and we can arrange pick-up and drop within Kolkata on request.' },
                    { q: 'Do you help with home loans?', a: 'Our projects are approved by leading banks and our team assists with the home loan paperwork at no extra cost.' },
                    { q: 'What is the booking amount?', a: 'The booking amount depends on the project and unit. Our sales team will share the exact payment plan, linked to construction milestones, during your visit.' }] },
                { key: 'lp_cta', label: 'Bottom button text', default: 'Book My Free Site Visit' }
            ]
        },
        {
            id: 'blogpage', title: 'Blog Page', icon: 'fa-newspaper',
            description: 'Heading and intro at the top of the blog page.',
            fields: [
                { key: 'blogpage_heading', label: 'Heading', default: 'Market Insights & News' },
                { key: 'blogpage_intro', label: 'Intro', type: 'textarea', default: 'Home-buying guides, RERA tips, commercial investment advice and construction updates from our projects across Kolkata.' },
                { key: 'post_cta_heading', label: 'Article box – heading', default: 'Looking for a home in Kolkata?' },
                { key: 'post_cta_text', label: 'Article box – text', type: 'textarea', default: 'Get the price list and book a free site visit to our RERA approved projects.' }
            ]
        },
        {
            id: 'privacy', title: 'Privacy Policy', icon: 'fa-shield-halved',
            description: 'The privacy policy page. Have it reviewed for the Digital Personal Data Protection Act, 2023.',
            fields: [
                { key: 'privacy_updated', label: 'Last updated', default: 'September 2026' },
                { key: 'privacy_sections', label: 'Sections', type: 'list', item: [{ key: 'heading', label: 'Heading' }, { key: 'text', label: 'Text', type: 'textarea' }], default: [
                    { heading: 'Information we collect', text: 'When you submit an enquiry or site-visit form we collect the details you provide: name, mobile number, email address (optional), property preferences (project, configuration, budget, location), preferred visit date and your message. We also record the page you enquired from and any campaign parameters in the link (for example utm_source) so we know which advertisements are useful.' },
                    { heading: 'How we use it', text: 'Your information is used only to respond to your enquiry, arrange site visits, share project documents and price lists, and send updates about projects you showed interest in. With your consent we may contact you by call, SMS, email or WhatsApp.' },
                    { heading: 'Sharing', text: 'We do not sell or rent your personal data. We may share it with our banking or legal partners only when you ask us to (for example for home-loan assistance), or where required by law.' },
                    { heading: 'Third-party services', text: 'This website uses Google Maps to display project locations and may load fonts and scripts from trusted content delivery networks. These providers may collect technical data such as your IP address in line with their own privacy policies.' },
                    { heading: 'Retention & your rights', text: 'We keep enquiry data only as long as needed to serve you. You may ask us to access, correct or delete your data at any time by writing to the email address below.' }] }
            ]
        }
    ];

    const FIELDS = {};
    GROUPS.forEach((g) => g.fields.forEach((f) => { FIELDS[f.key] = f; }));

    /* ------------------------------------------------------------
     * Values: defaults + saved settings rows ({ id: key, value })
     * ---------------------------------------------------------- */
    const clone = (v) => JSON.parse(JSON.stringify(v));

    function parseValue(field, raw) {
        if (field.type === 'list') {
            if (Array.isArray(raw)) return raw;
            try { const v = JSON.parse(raw); return Array.isArray(v) ? v : clone(field.default); } catch (e) { return clone(field.default); }
        }
        return raw == null ? '' : String(raw);
    }

    /** Build the content object from settings rows, adding derived values. */
    function build(rows) {
        const c = {};
        Object.values(FIELDS).forEach((f) => { c[f.key] = clone(f.default); });
        (rows || []).forEach((r) => { if (r && FIELDS[r.id] && r.value != null) c[r.id] = parseValue(FIELDS[r.id], r.value); });

        // Derived values (used by pages; not stored)
        const digits = (s) => String(s || '').replace(/[^\d+]/g, '');
        c.phone_href = c.phone ? `tel:${digits(c.phone)}` : '';
        c.phone_alt_href = c.phone_alt ? `tel:${digits(c.phone_alt)}` : '';
        c.email_href = c.email ? `mailto:${c.email}` : '';
        c.whatsapp = String(c.whatsapp || '').replace(/\D/g, '');
        c.whatsapp_url = `https://wa.me/${c.whatsapp}`;
        c.address = [c.address_street, c.address_city, [c.address_state, c.address_pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        c.phone_nbsp = String(c.phone || '').replace(/ /g, ' ');
        c.geo_position = c.office_lat && c.office_lng ? `${c.office_lat};${c.office_lng}` : '';
        c.icbm = c.office_lat && c.office_lng ? `${c.office_lat}, ${c.office_lng}` : '';
        c.year = String(new Date().getFullYear());
        c.home_label = `${c.business_name} home`;
        c.carousel_ms = Math.max(3, Number(c.carousel_seconds) || 10) * 1000;
        c.social = [['facebook', c.social_facebook], ['instagram', c.social_instagram], ['youtube', c.social_youtube], ['linkedin', c.social_linkedin]].filter(([, u]) => /^https?:\/\//.test(u || ''));
        c.registrations = [
            c.company_rera ? `WBRERA Reg. No: ${c.company_rera}` : '',
            c.gstin ? `GSTIN: ${c.gstin}` : '',
            c.cin ? `CIN: ${c.cin}` : ''
        ].filter(Boolean).join(' · ');
        return c;
    }

    /** Convert edited values back to settings rows for storage. */
    function toRows(values) {
        return Object.keys(values).filter((k) => FIELDS[k]).map((k) => ({
            id: k,
            value: FIELDS[k].type === 'list' ? JSON.stringify(values[k] || []) : String(values[k] == null ? '' : values[k]),
            updated_at: new Date().toISOString()
        }));
    }

    const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

    /* ------------------------------------------------------------
     * List renderers
     * ---------------------------------------------------------- */
    const BENEFIT_ICONS = ['fa-car', 'fa-file-invoice', 'fa-building-columns', 'fa-key', 'fa-shield-halved', 'fa-handshake'];
    const lines = (s) => esc(s).replace(/\n/g, '<br>');
    const paras = (s, cls) => String(s || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
        .map((p) => `<p class="${cls || ''}">${lines(p)}</p>`).join('');

    const RENDER = {
        about_points: (list) => list.filter((x) => x.text).map((x) => `<li class="flex items-center gap-2"><i class="fas fa-check-circle text-brand-orange" aria-hidden="true"></i> ${esc(x.text)}</li>`).join(''),
        stats: (list) => list.filter((x) => x.value || x.label).map((x, i, all) => `
            <div class="text-center${i < all.length - 1 ? ' border-r border-gray-300 pr-6 md:pr-8' : ''}">
                <span class="block text-3xl md:text-4xl font-bold text-brand-orange">${esc(x.value)}</span>
                <span class="text-[10px] md:text-xs text-brand-navy font-bold uppercase tracking-wider mt-1 block">${esc(x.label)}</span>
            </div>`).join(''),
        lp_benefits: (list) => list.filter((x) => x.title).map((x, i) => `
            <li class="flex items-start gap-3"><span class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0"><i class="fas ${BENEFIT_ICONS[i % BENEFIT_ICONS.length]} text-brand-gold" aria-hidden="true"></i></span><span><strong class="block">${esc(x.title)}</strong><span class="text-sm text-gray-300">${esc(x.text)}</span></span></li>`).join(''),
        lp_steps: (list) => list.filter((x) => x.title).map((x, i, all) => `
            <li class="text-center p-6 rounded-xl bg-amber-50/70 border border-amber-100"><span class="w-14 h-14 rounded-full ${i === all.length - 1 ? 'bg-brand-orange' : 'bg-brand-navy'} text-white text-xl font-bold flex items-center justify-center mx-auto">${i + 1}</span><h3 class="font-bold text-brand-navy mt-4">${esc(x.title)}</h3><p class="text-sm text-gray-600 mt-2">${esc(x.text)}</p></li>`).join(''),
        testimonials: (list) => T.testimonials(list.filter((t) => t && t.quote && t.name)),
        faq: (list) => list.filter((x) => x.q).map((x) => `
            <details class="group bg-amber-50/60 border border-amber-100 rounded-lg p-4 open:bg-white open:shadow"><summary class="font-bold text-brand-navy cursor-pointer list-none flex justify-between items-center gap-4">${esc(x.q)}<i class="fas fa-chevron-down text-brand-orange group-open:rotate-180 transition" aria-hidden="true"></i></summary><p class="mt-3 text-gray-600 text-sm">${lines(x.a)}</p></details>`).join(''),
        lp_budgets: (list, c, el) => optionList(list, el, 'Select budget'),
        lp_locations: (list, c, el) => optionList(list, el, 'Any location'),
        privacy_sections: (list) => list.filter((x) => x.heading || x.text).map((x) => `
            <section><h2 class="text-xl font-bold text-brand-navy mb-2">${esc(x.heading)}</h2>${paras(x.text, 'mb-2')}</section>`).join(''),
        /* Derived blocks */
        '@contact_cards': (_v, c) => {
            const card = (icon, title, body) => `
                <div class="bg-white/10 backdrop-blur rounded-xl p-5 flex gap-4 items-start">
                    <span class="w-11 h-11 flex-shrink-0 rounded-full bg-brand-orange flex items-center justify-center"><i class="fas ${icon}" aria-hidden="true"></i></span>
                    <div><h3 class="font-bold text-brand-gold">${title}</h3>${body}</div>
                </div>`;
            return [
                c.address ? card('fa-location-dot', 'Head Office', `<p class="text-gray-200 text-sm mt-1">${esc(c.address)}</p>`) : '',
                c.phone ? card('fa-phone', 'Call Us', `<a href="${esc(c.phone_href)}" class="text-gray-200 text-sm mt-1 block hover:text-white" aria-label="Call ${esc(c.business_name)} at ${esc(c.phone)}">${esc(c.phone_nbsp)}</a>${c.phone_alt ? `<a href="${esc(c.phone_alt_href)}" class="text-gray-200 text-sm mt-1 block hover:text-white" aria-label="Call ${esc(c.phone_alt)}">${esc(c.phone_alt.replace(/ /g, ' '))}</a>` : ''}`) : '',
                c.email ? card('fa-envelope', 'Email', `<a href="${esc(c.email_href)}" class="text-gray-200 text-sm mt-1 block hover:text-white break-all" aria-label="Email ${esc(c.business_name)}">${esc(c.email)}</a>`) : '',
                c.office_hours ? card('fa-clock', 'Office Hours', `<p class="text-gray-200 text-sm mt-1">${esc(c.office_hours)}</p>`) : ''
            ].join('');
        }
    };

    function optionList(list, el, placeholder) {
        const current = el && el.value;
        const opts = `<option value="">${esc(placeholder)}</option>` + list.map((x) => (typeof x === 'string' ? x : x.text)).filter(Boolean)
            .map((t) => `<option${current === t ? ' selected' : ''}>${esc(t)}</option>`).join('');
        return opts;
    }

    /* ------------------------------------------------------------
     * Structured data built from content
     * ---------------------------------------------------------- */
    function businessJsonLd(c, site) {
        const hasGeo = c.office_lat && c.office_lng && !isNaN(Number(c.office_lat)) && !isNaN(Number(c.office_lng));
        const ld = {
            '@context': 'https://schema.org',
            '@type': 'RealEstateAgent',
            '@id': `${site}/#organization`,
            name: c.business_name,
            legalName: c.business_legal_name || undefined,
            description: c.footer_about || c.tagline,
            slogan: c.tagline || undefined,
            url: `${site}/`,
            logo: `${site}/1000365300.jpg`,
            image: `${site}/og-image.jpg`,
            telephone: c.phone || undefined,
            email: c.email || undefined,
            priceRange: '₹₹₹',
            foundingDate: c.founded_year || undefined,
            address: {
                '@type': 'PostalAddress',
                streetAddress: c.address_street || undefined,
                addressLocality: c.address_city || undefined,
                addressRegion: c.address_state || undefined,
                postalCode: c.address_pin || undefined,
                addressCountry: 'IN'
            },
            areaServed: csv(c.service_areas).map((name) => ({ '@type': 'Place', name })),
            contactPoint: {
                '@type': 'ContactPoint', telephone: c.phone || undefined, contactType: 'sales', areaServed: 'IN',
                availableLanguage: csv(c.languages)
            },
            knowsAbout: ['Residential Real Estate', 'Commercial Property', 'RERA Compliance', 'Property Development']
        };
        if (hasGeo) {
            ld.geo = { '@type': 'GeoCoordinates', latitude: Number(c.office_lat), longitude: Number(c.office_lng) };
            ld.hasMap = `https://www.google.com/maps?q=${Number(c.office_lat)},${Number(c.office_lng)}`;
        }
        const days = csv(c.open_days);
        if (days.length && c.open_time && c.close_time) {
            ld.openingHoursSpecification = [{ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: c.open_time, closes: c.close_time }];
        }
        const ids = [];
        if (c.company_rera) ids.push({ '@type': 'PropertyValue', propertyID: 'WBRERA', value: c.company_rera });
        if (c.gstin) ids.push({ '@type': 'PropertyValue', propertyID: 'GSTIN', value: c.gstin });
        if (c.cin) ids.push({ '@type': 'PropertyValue', propertyID: 'CIN', value: c.cin });
        if (ids.length) ld.identifier = ids;
        if (c.social.length) ld.sameAs = c.social.map(([, u]) => u);
        return ld;
    }

    function faqJsonLd(c) {
        const items = (c.faq || []).filter((x) => x.q && x.a);
        if (!items.length) return null;
        return {
            '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } }))
        };
    }

    const ldText = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

    /* ------------------------------------------------------------
     * apply(document, content, site): fill every marked element.
     * Works with the browser DOM and with linkedom in the build.
     * ---------------------------------------------------------- */
    function apply(doc, c, site) {
        doc.querySelectorAll('[data-c]').forEach((el) => {
            const key = el.getAttribute('data-c');
            if (!(key in c)) return;
            const v = c[key];
            const mode = el.getAttribute('data-c-mode');
            if (mode === 'lines') el.innerHTML = lines(v);
            else if (mode === 'paras') el.innerHTML = paras(v, el.getAttribute('data-c-pclass') || '');
            else el.textContent = v;
        });
        doc.querySelectorAll('[data-c-attr]').forEach((el) => {
            el.getAttribute('data-c-attr').split(';').forEach((pair) => {
                const i = pair.indexOf(':');
                if (i < 0) return;
                const attr = pair.slice(0, i).trim();
                const key = pair.slice(i + 1).trim();
                if (key in c) el.setAttribute(attr, String(c[key]));
            });
        });
        doc.querySelectorAll('[data-c-list]').forEach((el) => {
            const key = el.getAttribute('data-c-list');
            const fn = RENDER[key];
            if (fn) el.innerHTML = fn(c[key] || [], c, el);
        });
        doc.querySelectorAll('[data-c-show]').forEach((el) => {
            const key = el.getAttribute('data-c-show');
            const v = key === 'testimonials' ? (c.testimonials || []).filter((t) => t && t.quote && t.name) : c[key];
            if (isEmpty(v)) el.classList.add('hidden'); else el.classList.remove('hidden');
        });
        const biz = doc.getElementById('ld-business');
        if (biz && site) biz.textContent = ldText(businessJsonLd(c, site));
        const faq = doc.getElementById('ld-faq');
        if (faq) { const f = faqJsonLd(c); faq.textContent = f ? ldText(f) : '{}'; }
        if (T.setBrand) T.setBrand(c.business_name);
    }

    const AEC = { GROUPS, FIELDS, build, toRows, apply, businessJsonLd, faqJsonLd, RENDER, csv };
    if (typeof module !== 'undefined' && module.exports) module.exports = AEC;
    else root.AEC = AEC;
})(typeof window !== 'undefined' ? window : globalThis);
