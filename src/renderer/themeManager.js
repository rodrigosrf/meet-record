/**
 * ThemeManager - Gerenciador de Temas Visuais e Iluminação Reativa Ambiente
 * Suporta 5 temas visuais refinados e efeito perimetral sincronizado com áudio/voz.
 */

export const THEMES = [
    { id: 'space', name: 'Deep Space Glass', icon: '🌌', desc: 'Glassmorphism translúcido com tons azulados cósmicos' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon', icon: '⚡', desc: 'Ciano elétrico, magenta e grade holográfica de alto impacto' },
    { id: 'oled', name: 'Midnight OLED', icon: '🖤', desc: 'Preto puro absoluto com acentos em verde esmeralda neon' },
    { id: 'synthwave', name: 'Synthwave 80s', icon: '🌆', desc: 'Gradientes violeta, pôr do sol laranja e estética retrô' },
    { id: 'light', name: 'Solar Glass', icon: '☀️', desc: 'Interface clara moderna, luminosa e minimalista' }
];

class ThemeManager {
    constructor() {
        this.currentTheme = localStorage.getItem('meet_record_theme') || 'space';
        this.ambientGlowElement = null;
        this.lastGlowLevel = 0;
    }

    init() {
        this.ambientGlowElement = document.getElementById('ambientGlowRing');
        this.applyTheme(this.currentTheme);
        this.renderThemeDropdown();
    }

    applyTheme(themeId) {
        const validTheme = THEMES.find(t => t.id === themeId) ? themeId : 'space';
        this.currentTheme = validTheme;
        localStorage.setItem('meet_record_theme', validTheme);
        
        document.documentElement.setAttribute('data-theme', validTheme);
        document.body.setAttribute('data-theme', validTheme);

        // Atualizar seletor ativo na UI
        const activeLabel = document.getElementById('currentThemeLabel');
        const activeIcon = document.getElementById('currentThemeIcon');
        const themeObj = THEMES.find(t => t.id === validTheme);
        if (activeLabel && themeObj) activeLabel.textContent = themeObj.name;
        if (activeIcon && themeObj) activeIcon.textContent = themeObj.icon;

        // Atualizar itens do dropdown
        document.querySelectorAll('.theme-option-item').forEach(item => {
            if (item.getAttribute('data-theme-id') === validTheme) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    getCurrentTheme() {
        return this.currentTheme;
    }

    renderThemeDropdown() {
        const themeList = document.getElementById('themeDropdownList');
        if (!themeList) return;

        themeList.innerHTML = THEMES.map(theme => `
            <div class="theme-option-item ${theme.id === this.currentTheme ? 'active' : ''}" data-theme-id="${theme.id}">
                <span class="theme-icon">${theme.icon}</span>
                <div class="theme-info">
                    <span class="theme-name">${theme.name}</span>
                    <span class="theme-desc">${theme.desc}</span>
                </div>
            </div>
        `).join('');

        themeList.querySelectorAll('.theme-option-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const themeId = btn.getAttribute('data-theme-id');
                this.applyTheme(themeId, true);
                const dropdown = document.getElementById('themeDropdownMenu');
                if (dropdown) dropdown.classList.add('hidden');
            });
        });
    }

    // Atualiza a luminosidade ambiente de acordo com o nível da voz (0 a 1)
    applyAmbientGlow(vuLevel) {
        if (!this.ambientGlowElement) {
            this.ambientGlowElement = document.getElementById('ambientGlowRing');
        }
        if (!this.ambientGlowElement) return;

        // Suavização simples
        const target = Math.min(1, Math.max(0, vuLevel));
        this.lastGlowLevel += (target - this.lastGlowLevel) * 0.3;

        const opacity = Math.min(0.85, this.lastGlowLevel * 1.5);
        const spread = Math.round(10 + this.lastGlowLevel * 35);

        this.ambientGlowElement.style.opacity = opacity.toFixed(2);
        this.ambientGlowElement.style.setProperty('--glow-spread', `${spread}px`);
    }
}

export const themeManager = new ThemeManager();
