/**
 * Ashirbad Enterprise – HTML templates
 * ---------------------------------------------------------------
 * Pure functions (data → HTML string). Used in the browser to render
 * live data AND by tools/build.mjs to pre-render static HTML, so search
 * engines and link previews see real content without running JS.
 * Works in browsers (window.AET) and Node (module.exports).
 */
(function (root) {
    'use strict';

    let BRAND = 'Ashirbad Enterprise';
    /** Business name used in alt texts and structured data (set from Website Content). */
    const setBrand = (name) => { if (name) BRAND = String(name); };

    const esc = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const formatDate = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (isNaN(d)) return String(value);
        return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);
    };

    /** Request a smaller rendition of Google-hosted or Unsplash images. */
    function imgUrl(url, width) {
        if (!url || !width) return url || '';
        if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[^=?]+$/.test(url)) return `${url}=w${width}`;
        if (/^https:\/\/images\.unsplash\.com\//.test(url)) return url.replace(/([?&])w=\d+/, `$1w=${width}`);
        return url;
    }

    /** Link to a blog post: the pre-rendered static page when it exists, otherwise the dynamic viewer. */
    function postUrl(slug, ctx) {
        const r = (ctx && ctx.root) || '';
        const built = (ctx && ctx.builtPosts) || [];
        return built.indexOf(slug) !== -1 ? `${r}blog/${encodeURIComponent(slug)}.html` : `${r}blog.html?post=${encodeURIComponent(slug)}`;
    }

    /** Safe mini-markup for blog content: blank line = paragraph, "## " = heading, "- " = bullet. */
    function richText(text) {
        return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
            const lines = block.split('\n').filter((l) => l.trim() !== '');
            let html = '';
            let list = [];
            let para = [];
            const flushList = () => { if (list.length) html += `<ul class="list-disc pl-6 space-y-1 my-4">${list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>`; list = []; };
            const flushPara = () => { if (para.length) html += `<p class="my-4 leading-relaxed">${para.map(esc).join('<br>')}</p>`; para = []; };
            lines.forEach((line) => {
                const l = line.trim();
                if (/^###?\s+/.test(l)) {
                    flushPara(); flushList();
                    html += `<h2 class="text-xl md:text-2xl font-bold text-brand-navy mt-8 mb-3">${esc(l.replace(/^###?\s+/, ''))}</h2>`;
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

    const galleryImages = (p) => Array.from(new Set([p.img].concat(p.images || []).filter(Boolean)));

    const stageBadge = (p) => p.stage === 'sold'
        ? '<span class="bg-red-700 text-white text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">Sold Out</span>'
        : `<span class="text-brand-gold text-[11px] font-bold uppercase tracking-wider">Completed${p.completed_year ? ' ' + esc(p.completed_year) : ''}</span>`;

    /* ---------------- Home: hero ---------------- */
    function heroSlides(live) {
        if (!live.length) {
            return `
                <div class="swiper-slide relative">
                    <img src="https://images.unsplash.com/photo-1460317442991-0ec209397118?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=75" alt="Kolkata skyline with residential towers" class="absolute inset-0 w-full h-full object-cover" fetchpriority="high" width="1600" height="900">
                    <div class="absolute inset-0 bg-brand-navy/80" aria-hidden="true"></div>
                    <div class="relative z-10 h-full max-w-4xl mx-auto px-6 flex flex-col items-center justify-center text-center">
                        <span class="bg-brand-gold text-brand-navy text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">Coming Soon</span>
                        <h2 class="text-3xl sm:text-5xl font-extrabold text-white mt-4">New Projects Launching Soon</h2>
                        <p class="text-gray-200 mt-3 max-w-xl">All our current projects are sold out. Register your interest to get early access to our next launch.</p>
                        <a href="enquiry.html" class="mt-6 bg-brand-orange hover:bg-white hover:text-brand-navy text-white font-bold px-6 py-3.5 rounded-md shadow-lg transition" aria-label="Register Your Interest">Register Your Interest</a>
                    </div>
                </div>`;
        }
        return live.map((p, i) => `
            <div class="swiper-slide relative" role="group" aria-label="Project ${i + 1} of ${live.length}: ${esc(p.title)}">
                <img src="${esc(imgUrl(p.img, 1600))}" alt="${esc(p.title)} - ${esc(p.config || 'residential project')} at ${esc(p.location)} by ${esc(BRAND)}"
                     class="absolute inset-0 w-full h-full object-cover" width="1600" height="900" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
                <div class="absolute inset-0 bg-gradient-to-t from-brand-navy/95 via-brand-navy/50 to-black/20" aria-hidden="true"></div>
                <div class="relative z-10 h-full max-w-7xl mx-auto px-5 sm:px-10 lg:px-16 flex flex-col justify-end pb-14 md:pb-20">
                    <span class="self-start inline-flex items-center gap-2 bg-brand-orange text-white text-[11px] sm:text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full shadow">
                        <i class="fas fa-helmet-safety" aria-hidden="true"></i>${esc(p.status_label || 'Ongoing')}
                    </span>
                    <h2 class="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white mt-4 leading-tight drop-shadow-lg">${esc(p.title)}</h2>
                    <p class="text-gray-100 text-sm sm:text-lg mt-2 sm:mt-3 flex items-center gap-2"><i class="fas fa-location-dot text-brand-gold" aria-hidden="true"></i>${esc(p.location)}</p>
                    ${p.config || p.price ? `<p class="text-brand-gold font-semibold text-sm sm:text-base mt-1">${[p.config, p.price].filter(Boolean).map(esc).join(' &middot; ')}</p>` : ''}
                    ${p.rera_no ? `<p class="text-gray-200 text-xs mt-1">WBRERA Reg. No: ${esc(p.rera_no)}</p>` : ''}
                    <button type="button" data-open-project="${esc(p.id)}"
                            class="self-start mt-6 bg-brand-orange hover:bg-white hover:text-brand-navy text-white font-bold px-6 py-3.5 rounded-md shadow-lg transition flex items-center gap-2 text-sm sm:text-base"
                            aria-label="View development details for ${esc(p.title)}">
                        View Development Details <i class="fas fa-arrow-right" aria-hidden="true"></i>
                    </button>
                </div>
            </div>`).join('');
    }

    /* ---------------- Home: commercial ---------------- */
    function commercialCards(items) {
        if (!items.length) return '<p class="col-span-full text-center text-gray-500">New commercial spaces coming soon.</p>';
        return items.map((b) => `
            <article class="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden group hover:shadow-2xl hover:-translate-y-1 transition duration-300 flex flex-col">
                <div class="relative overflow-hidden h-52 bg-gray-100">
                    <img src="${esc(imgUrl(b.img, 800))}" alt="${esc(b.title)} - ${esc(b.type || 'commercial space')} in ${esc(b.area)}, Kolkata"
                         class="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" width="800" height="416">
                    ${b.type ? `<span class="absolute top-3 left-3 bg-brand-navy/90 text-white text-xs font-bold px-3 py-1 rounded-full">${esc(b.type)}</span>` : ''}
                </div>
                <div class="p-5 md:p-6 flex flex-col flex-1">
                    <h3 class="font-bold text-lg md:text-xl text-brand-navy">${esc(b.title)}</h3>
                    <ul class="mt-3 space-y-2 text-sm text-gray-600 flex-1">
                        <li class="flex items-center gap-2"><i class="fas fa-map-marker-alt text-brand-orange w-4" aria-hidden="true"></i><span><span class="sr-only">Area: </span>${esc(b.area)}</span></li>
                        ${b.size ? `<li class="flex items-center gap-2"><i class="fas fa-expand text-brand-orange w-4" aria-hidden="true"></i><span><span class="sr-only">Size: </span>${esc(b.size)}</span></li>` : ''}
                    </ul>
                    <a href="#contact-us" data-enquire="${esc(b.title)}" data-interest="Commercial"
                       class="mt-5 inline-flex items-center justify-center gap-2 border-2 border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-white font-bold py-2.5 px-4 rounded-md transition"
                       aria-label="Enquire about ${esc(b.title)} in ${esc(b.area)}">Enquire Now <i class="fas fa-arrow-right text-sm" aria-hidden="true"></i></a>
                </div>
            </article>`).join('');
    }

    /* ---------------- Home: gallery ---------------- */
    function galleryCards(past) {
        if (!past.length) return '<p class="col-span-full text-center text-gray-500">Our completed projects will appear here.</p>';
        return past.map((p) => {
            const n = galleryImages(p).length;
            return `
            <button type="button" data-open-gallery="${esc(p.id)}"
                    class="group relative block w-full aspect-[4/3] rounded-xl overflow-hidden shadow-md hover:shadow-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-flame transition text-left bg-gray-200"
                    aria-label="Open photo gallery of ${esc(p.title)}, ${esc(p.location)} (${n} photos)">
                <img src="${esc(imgUrl(p.img, 700))}" alt="${esc(p.title)} - ${p.stage === 'sold' ? 'sold out' : 'completed'} project by ${esc(BRAND)} in ${esc(p.location)}"
                     class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition duration-700" loading="lazy" width="700" height="525">
                <span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden="true"></span>
                <span class="absolute top-3 right-3 bg-white/90 text-brand-navy text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><i class="fas fa-images" aria-hidden="true"></i> ${n}</span>
                <span class="absolute bottom-0 left-0 right-0 p-4 sm:p-5 text-white block">
                    ${stageBadge(p)}
                    <span class="block font-bold text-lg sm:text-xl leading-tight mt-1">${esc(p.title)}</span>
                    <span class="text-gray-200 text-sm flex items-center gap-1.5 mt-0.5"><i class="fas fa-location-dot text-brand-gold" aria-hidden="true"></i>${esc(p.location)}</span>
                </span>
            </button>`;
        }).join('');
    }

    /* ---------------- Blog cards ---------------- */
    function blogCard(p, ctx, heading) {
        const h = heading || 'h3';
        const url = postUrl(p.slug, ctx);
        return `
            <article class="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden group hover:shadow-xl transition flex flex-col">
                <a href="${esc(url)}" class="block overflow-hidden h-48 bg-gray-100" tabindex="-1" aria-hidden="true">
                    <img src="${esc(imgUrl(p.cover, 600))}" alt="${esc(p.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" width="600" height="384">
                </a>
                <div class="p-5 md:p-6 flex flex-col flex-1">
                    <div class="flex items-center justify-between gap-2 text-xs">
                        <span class="text-brand-orange font-bold uppercase tracking-wider">${esc(p.category || 'News')}</span>
                        <span class="text-gray-500">${esc(p.read_time || '')}</span>
                    </div>
                    <${h} class="font-bold text-lg md:text-xl text-brand-navy mt-2 mb-2"><a href="${esc(url)}" class="hover:text-brand-orange" aria-label="${esc(p.title)}">${esc(p.title)}</a></${h}>
                    <p class="text-gray-600 text-sm mb-4 flex-1 line-clamp-3">${esc(p.excerpt || '')}</p>
                    <div class="flex items-center justify-between">
                        <time datetime="${esc(p.published_at || '')}" class="text-xs text-gray-500"><i class="far fa-calendar mr-1" aria-hidden="true"></i>${formatDate(p.published_at)}</time>
                        <a href="${esc(url)}" class="text-brand-orange font-bold hover:text-brand-navy text-sm" aria-label="Read article: ${esc(p.title)}">Read &rarr;</a>
                    </div>
                </div>
            </article>`;
    }

    function featuredPost(p, ctx) {
        const url = postUrl(p.slug, ctx);
        return `
            <article class="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden grid grid-cols-1 md:grid-cols-2 group">
                <a href="${esc(url)}" class="block overflow-hidden h-56 md:h-full bg-gray-100" tabindex="-1" aria-hidden="true">
                    <img src="${esc(imgUrl(p.cover, 1000))}" alt="${esc(p.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" width="1000" height="640">
                </a>
                <div class="p-6 md:p-10 flex flex-col justify-center">
                    <span class="text-xs font-bold uppercase tracking-wider text-brand-orange"><i class="fas fa-star mr-1" aria-hidden="true"></i> Latest · ${esc(p.category || 'News')}</span>
                    <h2 class="text-2xl md:text-3xl font-extrabold text-brand-navy mt-3"><a href="${esc(url)}" class="hover:text-brand-orange" aria-label="${esc(p.title)}">${esc(p.title)}</a></h2>
                    <p class="text-gray-600 mt-3">${esc(p.excerpt || '')}</p>
                    <p class="text-xs text-gray-500 mt-4"><time datetime="${esc(p.published_at || '')}">${formatDate(p.published_at)}</time>${p.read_time ? ' · ' + esc(p.read_time) : ''}</p>
                    <a href="${esc(url)}" class="self-start mt-6 bg-brand-orange hover:bg-brand-navy text-white font-bold px-5 py-3 rounded-md transition" aria-label="Read article: ${esc(p.title)}">Read Article</a>
                </div>
            </article>`;
    }

    function categoryFilters(posts, active) {
        const cats = ['All'].concat(Array.from(new Set(posts.map((p) => p.category).filter(Boolean))));
        return cats.map((c) => `
            <button type="button" data-cat="${esc(c)}" aria-pressed="${c === active}"
                    class="px-4 py-2.5 rounded-full text-sm font-bold border transition ${c === active ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white text-brand-navy border-gray-300 hover:border-brand-orange'}" aria-label="Show ${esc(c)} articles">${esc(c)}</button>`).join('');
    }

    /* ---------------- Landing page project cards ---------------- */
    function landingProjectCards(live) {
        if (!live.length) return '<p class="col-span-full text-center text-gray-500">All current projects are sold out – register above to hear about our next launch first.</p>';
        return live.map((p) => `
            <article class="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden flex flex-col">
                <div class="relative h-40 bg-gray-100">
                    <img src="${esc(imgUrl(p.img, 600))}" alt="${esc(p.title)} - ${esc(p.config || 'apartments')} in ${esc(p.location)}" class="w-full h-full object-cover" loading="lazy" width="600" height="320">
                    <span class="absolute top-2 left-2 bg-brand-orange text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full">${esc(p.status_label || 'Ongoing')}</span>
                </div>
                <div class="p-4 flex flex-col flex-1">
                    <h3 class="font-bold text-brand-navy">${esc(p.title)}</h3>
                    <p class="text-xs text-gray-500 mt-1"><i class="fas fa-location-dot text-brand-orange mr-1" aria-hidden="true"></i>${esc(p.location)}</p>
                    <p class="text-sm text-gray-700 mt-2">${esc(p.config || '')}</p>
                    <p class="text-brand-orange font-bold mt-1 flex-1">${esc(p.price || 'Price on request')}</p>
                    ${p.rera_no ? `<p class="text-[11px] text-gray-500 mt-1">WBRERA: ${esc(p.rera_no)}</p>` : ''}
                    <button type="button" data-pick="${esc(p.title)}" class="mt-3 w-full border-2 border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-white font-bold py-2.5 rounded-md text-sm transition" aria-label="Enquire about ${esc(p.title)}">Enquire About This</button>
                </div>
            </article>`).join('');
    }


    /* ---------------- Blog: single article ---------------- */
    function postArticle(p, related, ctx, url) {
        const r = (ctx && ctx.root) || '';
        const share = encodeURIComponent(url);
        return `
        <article id="post-view" aria-labelledby="post-title">
            <header class="bg-brand-navy text-white pt-12 md:pt-16 pb-28 md:pb-36">
                <div class="max-w-3xl mx-auto px-4 sm:px-6">
                    <nav aria-label="Breadcrumb" class="text-sm text-gray-300">
                        <ol class="flex flex-wrap gap-1.5">
                            <li><a href="${r}index.html" class="hover:text-white" aria-label="Home">Home</a> <span aria-hidden="true">/</span></li>
                            <li><a href="${r}blog.html" class="hover:text-white" aria-label="Blog">Blog</a> <span aria-hidden="true">/</span></li>
                            <li aria-current="page" class="text-gray-200">${esc(p.title)}</li>
                        </ol>
                    </nav>
                    <span class="inline-block mt-5 bg-brand-orange text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">${esc(p.category || 'News')}</span>
                    <h1 id="post-title" class="text-3xl sm:text-4xl md:text-5xl font-extrabold mt-4 leading-tight">${esc(p.title)}</h1>
                    <p class="mt-4 text-gray-300 text-sm flex flex-wrap gap-x-5 gap-y-1">
                        <span><i class="fas fa-user-pen mr-1.5 text-brand-gold" aria-hidden="true"></i>${esc(p.author || BRAND)}</span>
                        <span><i class="far fa-calendar mr-1.5 text-brand-gold" aria-hidden="true"></i><time datetime="${esc(p.published_at || '')}">${formatDate(p.published_at)}</time></span>
                        ${p.read_time ? `<span><i class="far fa-clock mr-1.5 text-brand-gold" aria-hidden="true"></i>${esc(p.read_time)}</span>` : ''}
                    </p>
                </div>
            </header>
            <div class="max-w-4xl mx-auto px-4 sm:px-6 -mt-20 md:-mt-28">
                <img src="${esc(imgUrl(p.cover, 1400) || r + '1000365300.jpg')}" alt="${esc(p.title)}" class="w-full aspect-[16/9] object-cover rounded-2xl shadow-2xl border-4 border-white bg-gray-200" width="1400" height="788" fetchpriority="high">
            </div>
            <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                ${p.excerpt ? `<p class="text-lg md:text-xl text-gray-600 leading-relaxed font-medium border-l-4 border-brand-flame pl-4">${esc(p.excerpt)}</p>` : ''}
                <div id="post-content" class="mt-6 text-gray-800 text-base md:text-lg">${richText(p.content)}</div>

                <div class="mt-10 pt-6 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <span class="font-bold text-brand-navy">Share this article</span>
                    <div class="flex gap-2">
                        <a href="https://wa.me/?text=${encodeURIComponent(p.title + ' – ' + url)}" target="_blank" rel="noopener noreferrer" class="w-11 h-11 rounded-full bg-[#15803d] text-white flex items-center justify-center hover:scale-110 transition" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp text-lg" aria-hidden="true"></i></a>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${share}" target="_blank" rel="noopener noreferrer" class="w-11 h-11 rounded-full bg-[#1877f2] text-white flex items-center justify-center hover:scale-110 transition" aria-label="Share on Facebook"><i class="fab fa-facebook-f" aria-hidden="true"></i></a>
                        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${share}" target="_blank" rel="noopener noreferrer" class="w-11 h-11 rounded-full bg-[#0a66c2] text-white flex items-center justify-center hover:scale-110 transition" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in" aria-hidden="true"></i></a>
                        <button type="button" data-copy-link="${esc(url)}" class="w-11 h-11 rounded-full bg-gray-200 text-brand-navy flex items-center justify-center hover:scale-110 transition" aria-label="Copy article link"><i class="fas fa-link" aria-hidden="true"></i></button>
                    </div>
                </div>

                <aside class="mt-10 bg-brand-navy text-white rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6" aria-label="Book a site visit">
                    <img src="${r}1000365300.jpg" alt="${esc(BRAND)} logo" class="w-20 h-20 rounded-xl bg-white p-1 object-contain flex-shrink-0" loading="lazy" width="80" height="80">
                    <div class="flex-1 text-center sm:text-left">
                        <h2 class="text-xl font-bold">${esc((ctx && ctx.c && ctx.c.post_cta_heading) || 'Looking for a home in Kolkata?')}</h2>
                        <p class="text-gray-300 text-sm mt-1">${esc((ctx && ctx.c && ctx.c.post_cta_text) || 'Get the price list and book a free site visit to our RERA approved projects.')}</p>
                    </div>
                    <a href="${r}enquiry.html" class="bg-brand-orange hover:bg-white hover:text-brand-navy text-white font-bold px-5 py-3 rounded-md transition whitespace-nowrap" aria-label="Book Site Visit">Book Site Visit</a>
                </aside>
            </div>

            <section class="bg-white py-12 md:py-16" aria-labelledby="related-heading">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 id="related-heading" class="text-2xl md:text-3xl font-bold text-brand-navy mb-8">More Articles</h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${related.length ? related.map((x) => blogCard(x, ctx, 'h3')).join('') : '<p class="text-gray-500">More articles coming soon.</p>'}</div>
                    <div class="text-center mt-8"><a href="${r}blog.html" class="inline-flex items-center gap-2 text-brand-orange font-bold hover:text-brand-navy py-2" aria-label="All Articles"><i class="fas fa-arrow-left" aria-hidden="true"></i> All Articles</a></div>
                </div>
            </section>
        </article>`;
    }

    /** Related posts: same category first, then newest. */
    function relatedPosts(p, posts) {
        return posts.filter((x) => x.id !== p.id)
            .sort((a, b) => (b.category === p.category) - (a.category === p.category))
            .slice(0, 3);
    }

    /** Structured data for a post (BlogPosting + BreadcrumbList). */
    function postJsonLd(p, url, site) {
        const abs = (u) => (!u || /^data:/.test(u) ? `${site}/og-image.jpg` : /^https?:\/\//.test(u) ? u : `${site}/${u.replace(/^\//, '')}`);
        return [
            {
                '@context': 'https://schema.org',
                '@type': 'BlogPosting',
                headline: p.title,
                description: p.excerpt || undefined,
                image: [abs(imgUrl(p.cover, 1200))],
                datePublished: p.published_at || undefined,
                dateModified: p.updated_at || p.published_at || undefined,
                author: { '@type': 'Organization', name: p.author || BRAND, url: `${site}/` },
                publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: `${site}/1000365300.jpg` } },
                mainEntityOfPage: { '@type': 'WebPage', '@id': url },
                articleSection: p.category || undefined,
                inLanguage: 'en-IN'
            },
            {
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: `${site}/` },
                    { '@type': 'ListItem', position: 2, name: 'Blog', item: `${site}/blog.html` },
                    { '@type': 'ListItem', position: 3, name: p.title, item: url }
                ]
            }
        ];
    }

    /* ---------------- Testimonials (from config – real customers only) ---------------- */
    function testimonials(list) {
        return list.map((t) => `
            <figure class="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                ${t.rating ? `<p class="text-brand-gold" role="img" aria-label="${Number(t.rating)} out of 5 stars">${'<i class="fas fa-star" aria-hidden="true"></i>'.repeat(Math.max(0, Math.min(5, Number(t.rating) || 0)))}</p>` : ''}
                <blockquote class="mt-3 text-gray-700 text-sm leading-relaxed">“${esc(t.quote)}”</blockquote>
                <figcaption class="mt-4 font-bold text-brand-navy text-sm">${esc(t.name)}${t.project ? `<span class="block font-normal text-gray-500">${esc(t.project)}</span>` : ''}</figcaption>
            </figure>`).join('');
    }

    const AET = {
        esc, setBrand, formatDate, imgUrl, postUrl, richText, galleryImages,
        heroSlides, commercialCards, galleryCards, blogCard, featuredPost, categoryFilters, landingProjectCards,
        postArticle, relatedPosts, postJsonLd, testimonials
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = AET;
    else root.AET = AET;
})(typeof window !== 'undefined' ? window : globalThis);
