/**
 * Ashirbad Enterprise – data store
 * ---------------------------------------------------------------
 * One async API used by every page. Two interchangeable backends:
 *   - Google Sheets (when APP_CONFIG.APPS_SCRIPT_URL is set): shared,
 *     production data in a PRIVATE sheet, reached only through Apps Script
 *   - Local (IndexedDB in this browser): demo mode, seeded with sample data
 *
 * Collections: projects, commercial, posts, leads
 * Project stage: 'live' (hero carousel) | 'sold' | 'completed' (gallery)
 */
(function () {
    'use strict';

    const C = window.APP_CONFIG || {};
    const COLLECTIONS = ['projects', 'commercial', 'posts', 'leads'];

    const uid = () => (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    const nowISO = () => new Date().toISOString();
    const unsplash = (id, w = 1600, q = 80) =>
        `https://images.unsplash.com/photo-${id}?ixlib=rb-4.0.3&auto=format&fit=crop&w=${w}&q=${q}`;
    const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

    /* ------------------------------------------------------------
     * Sample data (used to seed demo mode, or "Load sample data"
     * in the admin panel when the Google Sheet is empty)
     * ---------------------------------------------------------- */
    function buildSeed() {
        const t = nowISO();
        const project = (o, i) => ({
            id: uid(), slug: slugify(o.title), sort_order: i, created_at: t, sold_at: null,
            images: [], completed_year: null, plot_size: null, carpet_area: null,
            config: null, price: null, description: null, ...o
        });
        const projects = [
            {
                title: 'Ashirbad Heights', location: 'Action Area I, New Town, Kolkata', stage: 'live',
                status_label: 'Under Construction', plot_size: '32 Cottah', carpet_area: '850 – 1,420 sq.ft.',
                config: '2 & 3 BHK Apartments', price: '₹58 Lakh onwards',
                description: 'Our flagship G+14 residential tower in the heart of New Town, minutes from Eco Park and City Centre II. Featuring a rooftop infinity pool, landscaped podium garden, fully equipped gymnasium, 24x7 CCTV security and 100% power backup. WBRERA registered with possession targeted for December 2027.',
                img: unsplash('1545324418-cc1a3fa10c00'),
                images: [unsplash('1600607687939-ce8a6c25118c'), unsplash('1560448204-e02f11c3d0e2')],
                lat: 22.5807, lng: 88.4770
            },
            {
                title: 'Ashirbad Greens', location: 'Rajarhat Main Road, Kolkata', stage: 'live',
                status_label: 'Booking Open', plot_size: '2.1 Acres', carpet_area: '640 – 1,150 sq.ft.',
                config: '1, 2 & 3 BHK Apartments', price: '₹39 Lakh onwards',
                description: 'A green-certified gated community with 70% open space, a jogging track, children\'s play zone and a grand clubhouse. Strategically located near the Rajarhat Expressway with excellent connectivity to the airport and the Sector V IT hub.',
                img: unsplash('1600596542815-ffad4c1539a9'),
                images: [unsplash('1600566753190-17f0baa2a6c3')],
                lat: 22.6114, lng: 88.4507
            },
            {
                title: 'Ashirbad Residency', location: 'Diamond Harbour Road, Behala, Kolkata', stage: 'live',
                status_label: 'Nearing Possession', plot_size: '18 Cottah', carpet_area: '720 – 1,050 sq.ft.',
                config: '2 & 3 BHK Apartments', price: '₹45 Lakh onwards',
                description: 'Thoughtfully designed homes in South Kolkata with Vastu-compliant layouts, modular kitchen provisions and a community hall. Walking distance from the Behala metro corridor, schools and hospitals.',
                img: unsplash('1512917774080-9991f1c4c750'),
                lat: 22.4986, lng: 88.3107
            },
            {
                title: 'Ashirbad Skyline', location: 'Sector III, Salt Lake City, Kolkata', stage: 'live',
                status_label: 'Newly Launched', plot_size: '24 Cottah', carpet_area: '1,250 – 2,100 sq.ft.',
                config: '3 & 4 BHK Luxury Residences', price: '₹1.35 Cr onwards',
                description: 'Ultra-premium residences with double-height balconies, Italian marble flooring, home automation and private lift lobbies, in the most sought-after pocket of Salt Lake.',
                img: unsplash('1613490493576-7fde63acd811'),
                lat: 22.5726, lng: 88.4171
            },
            {
                title: 'Ashirbad Enclave', location: 'Baguiati, Kolkata', stage: 'completed', status_label: 'Completed',
                completed_year: '2022', config: '2 & 3 BHK Apartments',
                img: unsplash('1580587771525-78b9dba3b914'),
                images: [unsplash('1600585154340-be6161a56a0c'), unsplash('1600607687939-ce8a6c25118c'), unsplash('1600566753190-17f0baa2a6c3')],
                lat: 22.6219, lng: 88.4225
            },
            {
                title: 'Ashirbad Palace', location: 'Tollygunge, Kolkata', stage: 'completed', status_label: 'Completed',
                completed_year: '2020', img: unsplash('1564013799919-ab600027ffc6'),
                images: [unsplash('1560448204-e02f11c3d0e2'), unsplash('1502672260266-1c1ef2d93688')],
                lat: 22.4989, lng: 88.3456
            },
            {
                title: 'Ashirbad Towers', location: 'Garia, Kolkata', stage: 'completed', status_label: 'Completed',
                completed_year: '2019', img: unsplash('1460317442991-0ec209397118'),
                images: [unsplash('1515263487990-61b07816b324'), unsplash('1567496898669-ee935f5f647a'), unsplash('1600607687939-ce8a6c25118c')],
                lat: 22.4633, lng: 88.3886
            },
            {
                title: 'Ashirbad Villa Grande', location: 'Kestopur, Kolkata', stage: 'completed', status_label: 'Completed',
                completed_year: '2018', img: unsplash('1570129477492-45c003edd2be'),
                images: [unsplash('1582407947304-fd86f028f716'), unsplash('1600566753190-17f0baa2a6c3')],
                lat: 22.5979, lng: 88.4308
            },
            {
                title: 'Ashirbad Apartments', location: 'Shibpur, Howrah', stage: 'completed', status_label: 'Completed',
                completed_year: '2016', img: unsplash('1515263487990-61b07816b324'),
                images: [unsplash('1502672260266-1c1ef2d93688'), unsplash('1560448204-e02f11c3d0e2')],
                lat: 22.5739, lng: 88.3176
            },
            {
                title: 'Ashirbad Niwas', location: 'Dum Dum Park, Kolkata', stage: 'completed', status_label: 'Completed',
                completed_year: '2014', img: unsplash('1582407947304-fd86f028f716'),
                images: [unsplash('1600585154340-be6161a56a0c'), unsplash('1567496898669-ee935f5f647a')],
                lat: 22.6090, lng: 88.4130
            }
        ].map(project);

        const commercial = [
            { title: 'Ashirbad Corporate Tower', area: 'Sector V, Salt Lake', size: '1,200 – 12,000 sq.ft.', type: 'Grade-A Office Space', img: unsplash('1486406146926-c627a92ad1ab', 800, 70) },
            { title: 'Ashirbad Trade Centre', area: 'Rajarhat Expressway', size: '350 – 2,500 sq.ft.', type: 'Retail Shops & Showrooms', img: unsplash('1441986300917-64674bd600d8', 800, 70) },
            { title: 'Ashirbad Business Hub', area: 'New Town, Action Area II', size: '600 – 5,000 sq.ft.', type: 'Co-working & Offices', img: unsplash('1497366216548-37526070297c', 800, 70) },
            { title: 'Ashirbad Galleria', area: 'Park Street, Central Kolkata', size: '400 – 3,200 sq.ft.', type: 'High-Street Retail', img: unsplash('1554435493-93422e8220c8', 800, 70) },
            { title: 'Ashirbad Logistics Park', area: 'Dankuni, NH-19', size: '10,000 – 60,000 sq.ft.', type: 'Warehousing', img: unsplash('1586528116311-ad8dd3c8310d', 800, 70) },
            { title: 'Ashirbad Medical Plaza', area: 'EM Bypass, Mukundapur', size: '800 – 8,000 sq.ft.', type: 'Clinic & Healthcare Spaces', img: unsplash('1497366811353-6870744d04b2', 800, 70) }
        ].map((o, i) => ({ id: uid(), sort_order: i, created_at: t, ...o }));

        const posts = [
            {
                title: '5 Checks Before You Pay a Token Amount', category: 'Real Estate Guide', read_time: '5 min read',
                published_at: '2026-09-12', cover: unsplash('1600585154340-be6161a56a0c', 1200, 70),
                excerpt: 'Understanding WBRERA registration status, title deeds and soil testing reports for under-construction projects.',
                content: 'Paying a token (booking) amount is the first real commitment you make to a property. Before any money changes hands, spend an hour on these five checks – they can save you years of trouble.\n\n## 1. Verify the WBRERA registration\nEvery residential project above 500 sq.m. or 8 units in West Bengal must be registered with WBRERA. Ask for the registration number and verify it on the official RERA portal. Check the approved completion date and the promoter\'s quarterly updates.\n\n## 2. Inspect the title and land documents\nAsk for the chain of title deeds, mutation certificate and the latest land tax receipt. For joint-venture projects, read the development agreement between the landowner and the builder.\n\n## 3. See the sanctioned building plan\nThe municipality or development authority (KMC, NKDA, HIDCO, Bidhannagar) must have sanctioned the plan. Compare the number of floors being constructed against the sanctioned plan.\n\n## 4. Ask about the soil test and structural design\nA reputable builder will happily share the soil test report and confirm that the structure is designed for Seismic Zone III/IV as applicable to Kolkata.\n\n## 5. Read the agreement for sale\n- Carpet area must be clearly stated (as per RERA)\n- Payment schedule should be linked to construction milestones\n- Check the delay-compensation and cancellation clauses\n\nAt Ashirbad Enterprise we share all of these documents before you book. Book a site visit and our team will walk you through them.'
            },
            {
                title: 'Maximising Commercial Carpet Area', category: 'Commercial', read_time: '4 min read',
                published_at: '2026-08-28', cover: unsplash('1486406146926-c627a92ad1ab', 1200, 70),
                excerpt: 'How efficient layout planning and loading factors drastically change rental yields for office investors.',
                content: 'When you buy commercial space, you pay for super built-up area but earn rent on usable space. The gap between the two – the loading factor – directly decides your rental yield.\n\n## Understand the loading factor\nIn Kolkata, commercial projects typically carry a loading of 30–45%. A lower loading means more carpet area for the same price.\n\n## Column-free floor plates\nRectangular, column-free floors allow tenants to fit more workstations, which lets you command a higher rent per square foot.\n\n## Frontage matters for retail\nFor shops and showrooms, the width of the frontage often matters more than depth. Ground-floor units facing the main road command a significant premium.\n\n## Our approach\nOur commercial developments are planned with efficient cores and wide frontages so that investors get the most usable area for every rupee.'
            },
            {
                title: 'Ashirbad Heights Reaches the 10th Floor', category: 'Project Updates', read_time: '3 min read',
                published_at: '2026-08-05', cover: unsplash('1503387762-592deb58ef4e', 1200, 70),
                excerpt: 'A progress report on our flagship New Town residential tower, now ahead of the construction schedule.',
                content: 'We are delighted to share that the structure of Ashirbad Heights in Action Area I, New Town has reached the 10th floor – nearly six weeks ahead of the schedule filed with WBRERA.\n\n## Work completed this quarter\n- Roof casting up to the 10th floor\n- Brickwork completed up to the 6th floor\n- Plumbing and electrical conduits in progress on floors 1–4\n\n## What\'s next\nThe remaining four floors and the rooftop amenities are planned over the next two quarters. The show flat on the 3rd floor will open for visits next month.\n\nExisting customers receive photo updates every month. Interested in a unit? A few 2 and 3 BHK homes are still available – book a site visit today.'
            }
        ].map((o) => ({ id: uid(), slug: slugify(o.title), author: 'Ashirbad Enterprise', published: true, created_at: t, ...o }));

        return { projects, commercial, posts, leads: [] };
    }

    /* ------------------------------------------------------------
     * Helpers
     * ---------------------------------------------------------- */
    const SORTERS = {
        projects: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.created_at).localeCompare(String(a.created_at)),
        commercial: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.created_at).localeCompare(String(a.created_at)),
        posts: (a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || String(b.created_at).localeCompare(String(a.created_at)),
        leads: (a, b) => String(b.created_at).localeCompare(String(a.created_at))
    };

    // Empty strings become null so date/number fields stay consistent
    const clean = (row) => {
        const out = {};
        Object.keys(row).forEach((k) => { out[k] = row[k] === '' ? null : row[k]; });
        return out;
    };

    function normalise(collection, row) {
        const r = clean({ ...row });
        if (!r.id) r.id = uid();
        if (!r.created_at) r.created_at = nowISO();
        if (collection === 'projects') {
            r.images = Array.isArray(r.images) ? r.images.filter(Boolean) : [];
            r.lat = r.lat == null ? null : Number(r.lat);
            r.lng = r.lng == null ? null : Number(r.lng);
            r.sort_order = Number(r.sort_order) || 0;
            r.stage = r.stage || 'live';
            if (!r.slug) r.slug = slugify(r.title);
        }
        if (collection === 'commercial') r.sort_order = Number(r.sort_order) || 0;
        if (collection === 'posts') {
            if (!r.slug) r.slug = slugify(r.title);
            r.published = r.published !== false;
            if (!r.published_at) r.published_at = nowISO().slice(0, 10);
        }
        return r;
    }

    /* ------------------------------------------------------------
     * Local backend (IndexedDB, falls back to memory)
     * ---------------------------------------------------------- */
    const KV = (() => {
        const DB_NAME = 'ashirbad-enterprise';
        const STORE = 'kv';
        const mem = {};
        let dbp = null;
        const open = () => {
            if (dbp) return dbp;
            dbp = new Promise((resolve) => {
                try {
                    const req = indexedDB.open(DB_NAME, 1);
                    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                } catch (e) { resolve(null); }
            });
            return dbp;
        };
        return {
            async get(key) {
                const db = await open();
                if (!db) return mem[key];
                return new Promise((resolve) => {
                    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(undefined);
                });
            },
            async set(key, value) {
                const db = await open();
                if (!db) { mem[key] = value; return; }
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(value, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            }
        };
    })();

    const localBackend = {
        async init() {
            if (await KV.get('seeded')) return;
            const seed = buildSeed();
            for (const c of COLLECTIONS) await KV.set(c, seed[c]);
            await KV.set('seeded', true);
        },
        async list(c) { return (await KV.get(c)) || []; },
        async upsert(c, row) {
            const rows = await localBackend.list(c);
            const i = rows.findIndex((r) => r.id === row.id);
            const saved = i >= 0 ? { ...rows[i], ...row } : row;
            if (i >= 0) rows[i] = saved; else rows.push(saved);
            await KV.set(c, rows);
            return saved;
        },
        async insert(c, row) { return localBackend.upsert(c, row); },
        async remove(c, id) {
            await KV.set(c, (await localBackend.list(c)).filter((r) => r.id !== id));
        },
        async upload(blob) {
            return new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => reject(new Error('Could not read the image file.'));
                fr.readAsDataURL(blob);
            });
        },
        auth: {
            async signIn(_email, password) {
                if (password !== C.LOCAL_ADMIN_PASSWORD) throw new Error('Incorrect password.');
                sessionStorage.setItem('ae-admin', '1');
            },
            async signOut() { sessionStorage.removeItem('ae-admin'); },
            async isAdmin() { try { return sessionStorage.getItem('ae-admin') === '1'; } catch (e) { return false; } }
        }
    };

    /* ------------------------------------------------------------
     * Google Sheets backend (via a private Apps Script web app)
     * The spreadsheet is never exposed: the browser only calls the
     * script URL, which allows a fixed set of actions.
     * ---------------------------------------------------------- */
    const TOKEN_KEY = 'ae-admin-token';
    const PUBLIC_CACHE_KEY = 'ae-public-cache-v1';
    const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
    const setToken = (t) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } };

    async function api(action, payload = {}) {
        const body = { action, ...payload };
        const token = getToken();
        if (token) body.token = token;
        let res;
        try {
            // text/plain keeps this a "simple" CORS request (Apps Script cannot answer preflights)
            res = await fetch(C.APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(body),
                redirect: 'follow'
            });
        } catch (e) {
            throw new Error('Could not reach the server. Please check your internet connection.');
        }
        if (!res.ok) throw new Error(`Server error (${res.status}).`);
        let data;
        try { data = await res.json(); } catch (e) { throw new Error('Unexpected server response.'); }
        if (!data.ok) {
            if (data.code === 'AUTH') setToken(null);
            const err = new Error(data.error || 'Request failed.');
            err.code = data.code;
            throw err;
        }
        return data.result;
    }

    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = () => reject(new Error('Could not read the image file.'));
        fr.readAsDataURL(blob);
    });

    let publicMemo = null;
    let skipLocalCache = false;
    let adminMemo = null;
    let adminMemoAt = 0;

    /** Public data: served instantly from the last visit's cache, refreshed in the background. */
    function fetchPublic() {
        if (publicMemo) return publicMemo;
        let cached = null;
        if (!skipLocalCache) {
            try { cached = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || 'null'); } catch (e) { cached = null; }
        }
        skipLocalCache = false;
        const fresh = api('public').then((data) => {
            const json = JSON.stringify(data);
            let prev = null;
            try { prev = localStorage.getItem(PUBLIC_CACHE_KEY); localStorage.setItem(PUBLIC_CACHE_KEY, json); } catch (e) { /* storage full or blocked */ }
            publicMemo = Promise.resolve(data);
            // Page rendered from an older cache → tell it to re-render with fresh data
            if (cached && prev !== json) setTimeout(() => ['projects', 'commercial', 'posts'].forEach((c) => emit(c, true)), 0);
            return data;
        });
        if (cached) {
            fresh.catch((e) => console.warn('Background refresh failed', e));
            publicMemo = Promise.resolve(cached);
        } else {
            publicMemo = fresh.catch((e) => { publicMemo = null; throw e; });
        }
        return publicMemo;
    }

    function fetchAll() {
        if (adminMemo && Date.now() - adminMemoAt < 5000) return adminMemo;
        adminMemoAt = Date.now();
        adminMemo = api('all').catch((e) => { adminMemo = null; throw e; });
        return adminMemo;
    }

    function invalidateRemote() {
        publicMemo = null;
        adminMemo = null;
        skipLocalCache = true;
    }

    const sheetsBackend = {
        async init() {
            if (!/^(https:\/\/|http:\/\/localhost)/.test(C.APPS_SCRIPT_URL || '')) throw new Error('APPS_SCRIPT_URL is not set correctly in assets/js/config.js.');
        },
        async list(c, { publicView, fresh } = {}) {
            if (getToken() && !publicView) return (await fetchAll())[c] || [];
            if (c === 'leads') return [];
            if (fresh) { invalidateRemote(); }
            return (await fetchPublic())[c] || [];
        },
        async upsert(c, row) { return api('save', { collection: c, row }); },
        async bulk(c, rows) { return api('bulkSave', { collection: c, rows }); },
        async insert(_c, row) { await api('addLead', { lead: row }); return row; },
        async remove(c, id) { return api('remove', { collection: c, id }); },
        async upload(blob, folder) {
            return api('upload', { data: await blobToBase64(blob), mime: blob.type || 'image/jpeg', name: `${folder || 'image'}.jpg` });
        },
        invalidate: invalidateRemote,
        auth: {
            async signIn(_email, password) { setToken(await api('login', { password })); },
            async signOut() { try { await api('logout'); } catch (e) { /* ignore */ } setToken(null); },
            async isAdmin() {
                if (!getToken()) return false;
                try { await api('check'); return true; } catch (e) { if (e.code === 'AUTH') return false; throw e; }
            }
        }
    };

    /* ------------------------------------------------------------
     * Image resize (keeps uploads light: max 1600px JPEG)
     * ---------------------------------------------------------- */
    async function resizeImage(file, max = 1600, quality = 0.82) {
        if (!file || !/^image\//.test(file.type)) throw new Error('Please choose an image file (JPG, PNG or WebP).');
        if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Could not read the image.'));
                i.src = url;
            });
            const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /* ------------------------------------------------------------
     * Public API
     * ---------------------------------------------------------- */
    const mode = C.APPS_SCRIPT_URL ? 'sheets' : 'local';
    const backend = mode === 'sheets' ? sheetsBackend : localBackend;
    const ready = backend.init();

    const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('ae-store') : null;
    const listeners = new Set();
    // Second argument is true when the change came from elsewhere (another tab or a background refresh)
    function emit(collection, external) {
        listeners.forEach((fn) => { try { fn(collection, external); } catch (e) { console.error(e); } });
    }
    const notify = (collection) => {
        emit(collection, false);
        if (channel) channel.postMessage({ collection });
    };
    if (channel) {
        channel.onmessage = (e) => {
            if (backend.invalidate) backend.invalidate();
            emit(e.data && e.data.collection, true);
        };
    }

    async function saveMany(c, rows) {
        await ready;
        if (backend.bulk) await backend.bulk(c, rows);
        else for (const row of rows) await backend.upsert(c, row);
        if (backend.invalidate) backend.invalidate();
        notify(c);
    }

    const Store = {
        mode,
        ready,
        slugify,
        uid,

        /** List rows of a collection. publicView hides unpublished posts. */
        async list(collection, { publicView = false, fresh = false } = {}) {
            await ready;
            let rows = await backend.list(collection, { publicView, fresh });
            if (collection === 'posts' && publicView) rows = rows.filter((p) => p.published !== false);
            return rows.slice().sort(SORTERS[collection]);
        },

        async get(collection, id) {
            return (await Store.list(collection)).find((r) => r.id === id) || null;
        },

        async save(collection, row) {
            await ready;
            const saved = await backend.upsert(collection, normalise(collection, row));
            if (backend.invalidate) backend.invalidate();
            notify(collection);
            return saved;
        },

        async remove(collection, id) {
            await ready;
            await backend.remove(collection, id);
            if (backend.invalidate) backend.invalidate();
            notify(collection);
        },

        /** Mark a live project sold (moves it to the gallery) or restore it. */
        async setSold(id, sold) {
            const p = await Store.get('projects', id);
            if (!p) throw new Error('Project not found.');
            return Store.save('projects', { ...p, stage: sold ? 'sold' : 'live', sold_at: sold ? nowISO() : null });
        },

        /** Save an enquiry from a public form. */
        async addLead(lead) {
            await ready;
            const row = normalise('leads', { status: 'New', ...lead });
            await backend.insert('leads', row);
            notify('leads');
            return row;
        },

        /** Resize then upload an image, returning a public URL (or data URL in demo mode). */
        async uploadImage(file, folder) {
            await ready;
            const blob = await resizeImage(file);
            return backend.upload(blob, folder);
        },

        auth: {
            async signIn(email, password) { await ready; return backend.auth.signIn(email, password); },
            async signOut() { await ready; return backend.auth.signOut(); },
            async isAdmin() { await ready; return backend.auth.isAdmin(); }
        },

        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        /** Admin utilities */
        async loadSampleData() {
            const seed = buildSeed();
            for (const c of ['projects', 'commercial', 'posts']) await saveMany(c, seed[c]);
        },
        async exportAll() {
            const out = { exported_at: nowISO(), mode };
            for (const c of COLLECTIONS) out[c] = await Store.list(c);
            return out;
        },
        async importAll(data) {
            for (const c of COLLECTIONS) {
                if (Array.isArray(data[c]) && data[c].length) await saveMany(c, data[c].map((r) => normalise(c, r)));
            }
        },
        async resetDemo() {
            if (mode !== 'local') throw new Error('Reset is only available in demo mode.');
            const seed = buildSeed();
            for (const c of COLLECTIONS) await KV.set(c, seed[c]);
            COLLECTIONS.forEach(notify);
        }
    };

    window.Store = Store;
})();
