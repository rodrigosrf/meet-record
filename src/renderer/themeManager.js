/**
 * ThemeManager - Gerenciador de Temas Visuais e Iluminação Reativa Ambiente
 * Suporta 5 temas visuais refinados e efeito perimetral sincronizado com áudio/voz.
 */

export const THEMES = [
    { id: 'space', name: 'Deep Space Glass', icon: '🌌', accent: '#38bdf8', desc: 'Glassmorphism translúcido com tons azulados cósmicos' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon', icon: '⚡', accent: '#06b6d4', desc: 'Ciano elétrico, magenta e grade holográfica de alto impacto' },
    { id: 'oled', name: 'Midnight OLED', icon: '🖤', accent: '#10b981', desc: 'Preto puro absoluto com acentos em verde esmeralda neon' },
    { id: 'synthwave', name: 'Synthwave 80s', icon: '🌆', accent: '#f43f5e', desc: 'Gradientes violeta, pôr do sol laranja e estética retrô' },
    { id: 'light', name: 'Solar Glass', icon: '☀️', accent: '#0284c7', desc: 'Interface clara moderna, luminosa e minimalista' },
    { id: 'crimson', name: 'Crimson Eclipse', icon: '🩸', accent: '#ff2a55', desc: 'Obsidiana profunda com brilho rubi carmim de alto contraste' },
    { id: 'sakura', name: 'Tokyo Sakura', icon: '🌸', accent: '#f472b6', desc: 'Noite índigo com flor de cerejeira pastel e néon lavanda' },
    { id: 'amber', name: 'Golden Amber', icon: '⚜️', accent: '#fbbf24', desc: 'Preto ônix com ouro líquido, âmbar luxuoso e bronze refinado' },
    { id: 'frost', name: 'Glacial Frost', icon: '❄️', accent: '#22d3ee', desc: 'Abismo ártico com ciano cristalino e efeitos translúcidos' },
    { id: 'sunset', name: 'Sunset Horizon', icon: '🌅', accent: '#ff6b35', desc: 'Crepúsculo californiano com degradê coral, tangerina e roxo' }
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
                    <div class="theme-name-row">
                        <span class="theme-name">${theme.name}</span>
                        <span class="theme-color-dot" style="background:${theme.accent}; box-shadow: 0 0 7px ${theme.accent};"></span>
                    </div>
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
