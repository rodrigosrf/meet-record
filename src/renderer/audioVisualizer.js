/**
 * AudioVisualizer - Engine de Equalizador e Visualização de Áudio para Meet Record
 * Oferece renderização High-DPI, múltiplos modos visuais (Espectro Neon, Ondas Fluidas, LED Matrix e Pulso Radial),
 * animações standby em repouso e reatividade luminosa ambiente.
 */

export class AudioVisualizer {
    constructor(canvasId = 'visualizerCanvas', containerId = 'mainVisualizer') {
        this.canvas = document.getElementById(canvasId);
        this.container = document.getElementById(containerId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        
        // Modos disponíveis: 'spectrum', 'wave', 'led', 'radial'
        const savedMode = localStorage.getItem('meet_record_visualizer_mode');
        this.mode = savedMode || 'spectrum';
        
        // Estado de física dos picos para o modo espectro
        this.peaks = [];
        this.peakHold = [];
        this.gravity = 0.45; // Queda mais suave e lenta dos picos
        
        // Fase de animação para o estado standby/repouso
        this.idlePhase = 0;
        
        // Nível VU (Volume Meter) suavizado
        this.smoothedVu = 0;
        this.vuPeak = 0;
        this.vuPeakDecay = 0;

        // Callback para atualizar indicador de nível VU na UI se registrado
        this.onVuUpdate = null;

        // Ajustar alta definição no canvas
        if (this.canvas) {
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }
    }

    setMode(newMode) {
        if (['spectrum', 'wave', 'led', 'radial'].includes(newMode)) {
            this.mode = newMode;
            localStorage.setItem('meet_record_visualizer_mode', newMode);
            this.peaks = [];
            this.peakHold = [];
        }
    }

    getMode() {
        return this.mode;
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.width = rect.width || this.canvas.offsetWidth || 300;
        this.height = rect.height || this.canvas.offsetHeight || 70;

        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;

        if (this.ctx) {
            this.ctx.scale(dpr, dpr);
        }
    }

    /**
     * Função principal de renderização acionada pelo requestAnimationFrame
     */
    draw(dataArray, isRecording = false, isPaused = false) {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // Verificar se há dados ativos de áudio
        let hasAudioData = false;
        let sum = 0;
        if (dataArray && dataArray.length > 0 && isRecording && !isPaused) {
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            if (sum > 0) hasAudioData = true;
        }

        // Atualizar nível de VU / dB
        this.updateVuMeter(dataArray, hasAudioData);

        if (!hasAudioData) {
            this.drawIdleState(w, h);
            this.updateAmbientGlow(0);
            return;
        }

        // Calcular energia dos graves (para efeito glow no container)
        const bassSum = dataArray.slice(0, 10).reduce((a, b) => a + b, 0);
        const bassEnergy = bassSum / (10 * 255);
        this.updateAmbientGlow(bassEnergy);

        // Renderizar o modo selecionado
        switch (this.mode) {
            case 'wave':
                this.drawWave(dataArray, w, h);
                break;
            case 'led':
                this.drawLED(dataArray, w, h);
                break;
            case 'radial':
                this.drawRadial(dataArray, w, h);
                break;
            case 'spectrum':
            default:
                this.drawSpectrum(dataArray, w, h);
                break;
        }
    }

    /**
     * Atualiza métrica de VU Meter (Volume)
     */
    updateVuMeter(dataArray, hasAudioData) {
        let currentLevel = 0;
        if (hasAudioData && dataArray) {
            let sumSq = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const norm = dataArray[i] / 255;
                sumSq += norm * norm;
            }
            currentLevel = Math.sqrt(sumSq / dataArray.length);
        }

        // Suavização do VU (Instantâneo -> Retorno Suave)
        this.smoothedVu += (currentLevel - this.smoothedVu) * 0.25;
        
        // Métrica de dB aproximada (-60 dB a 0 dB)
        const db = this.smoothedVu > 0.001 ? Math.max(-60, Math.round(20 * Math.log10(this.smoothedVu))) : -60;

        if (this.onVuUpdate) {
            this.onVuUpdate(this.smoothedVu, db);
        }
    }

    /**
     * Atualiza brilho ambiente (Bass Glow) no container do visualizador
     */
    updateAmbientGlow(bassEnergy) {
        if (!this.container) return;
        if (bassEnergy > 0.15) {
            const glowOpacity = Math.min(0.6, bassEnergy * 0.8);
            const glowBlur = 12 + bassEnergy * 20;
            this.container.style.boxShadow = `0 0 ${glowBlur}px rgba(56, 189, 248, ${glowOpacity}), inset 0 0 15px rgba(129, 140, 248, ${glowOpacity * 0.5})`;
        } else {
            this.container.style.boxShadow = '';
        }
    }

    /**
     * MODO 1: Espectro Neon (Spectrum with Mirror Reflection & Falling Peaks)
     */
    drawSpectrum(dataArray, w, h) {
        const ctx = this.ctx;
        const bufferLength = dataArray.length;
        // Usar subset de frequências mais audíveis
        const sliceLength = Math.floor(bufferLength * 0.75);
        const barWidth = Math.max(3, (w / sliceLength) * 1.8);
        const gap = 2;
        const effectiveWidth = barWidth + gap;
        const totalBars = Math.floor(w / effectiveWidth);

        // Piso de reflexão (75% altura para as barras principais, 25% para o espelho)
        const mainHeight = h * 0.78;
        const mirrorHeight = h * 0.22;
        const mainBaseY = mainHeight;

        // Gradiente principal das barras
        const gradient = ctx.createLinearGradient(0, mainHeight, 0, 0);
        gradient.addColorStop(0, '#38bdf8');   // Cyan
        gradient.addColorStop(0.5, '#818cf8'); // Indigo
        gradient.addColorStop(0.85, '#c084fc'); // Purple
        gradient.addColorStop(1, '#f43f5e');   // Pink/Rose peak

        for (let i = 0; i < totalBars; i++) {
            const dataIdx = Math.floor((i / totalBars) * sliceLength);
            const value = dataArray[dataIdx] || 0;
            const percent = value / 255;
            const barHeight = Math.max(2, percent * mainHeight);

            const x = i * effectiveWidth;
            const y = mainBaseY - barHeight;

            // 1. Desenhar Barra Principal
            ctx.fillStyle = gradient;
            ctx.beginPath();
            const radius = Math.min(barWidth / 2, 4);
            ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
            ctx.fill();

            // 2. Marcador de Pico com Gravidade
            if (!this.peaks[i] || y < this.peaks[i]) {
                this.peaks[i] = y;
                this.peakHold[i] = 0;
            } else {
                this.peakHold[i] = (this.peakHold[i] || 0) + 1;
                if (this.peakHold[i] > 10) {
                    this.peaks[i] += this.gravity;
                    if (this.peaks[i] > mainBaseY - 3) {
                        this.peaks[i] = mainBaseY - 3;
                    }
                }
            }

            const peakY = this.peaks[i];
            if (peakY < mainBaseY - 2) {
                ctx.fillStyle = 'rgba(224, 242, 254, 0.9)'; // Ciano gelo suave em vez do vermelho forte
                ctx.shadowColor = '#38bdf8';
                ctx.shadowBlur = 4;
                ctx.beginPath();
                ctx.roundRect(x, peakY, barWidth, 2, 1);
                ctx.fill();
                ctx.shadowBlur = 0; // reset
            }

            // 3. Reflexo Espelhado Inferior (Mirror Reflection)
            if (barHeight > 6) {
                const reflHeight = Math.min(mirrorHeight, barHeight * 0.3);
                const reflGradient = ctx.createLinearGradient(0, mainBaseY, 0, mainBaseY + reflHeight);
                reflGradient.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
                reflGradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

                ctx.fillStyle = reflGradient;
                ctx.beginPath();
                ctx.roundRect(x, mainBaseY + 2, barWidth, reflHeight, [0, 0, radius, radius]);
                ctx.fill();
            }
        }
    }

    /**
     * MODO 2: Onda Fluida (Liquid Cyber Waveform)
     */
    drawWave(dataArray, w, h) {
        const ctx = this.ctx;
        const bufferLength = dataArray.length;
        const sliceLength = Math.floor(bufferLength * 0.7);
        const centerY = h * 0.55;

        // Suavizar pontos para curva de Bézier
        const points = [];
        const step = w / (sliceLength - 1);

        for (let i = 0; i < sliceLength; i++) {
            const val = dataArray[i] / 255;
            const amp = val * (h * 0.45);
            const y = centerY - amp;
            points.push({ x: i * step, y });
        }

        // Camada 1: Preenchimento com Gradiente Fluido Translúcido
        const waveGradient = ctx.createLinearGradient(0, 0, 0, h);
        waveGradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
        waveGradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.3)');
        waveGradient.addColorStop(1, 'rgba(15, 23, 42, 0.0)');

        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(points[0].x, points[0].y);

        for (let i = 0; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = waveGradient;
        ctx.fill();

        // Camada 2: Linha de Contorno com Neon Glow
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Camada 3: Linha Invertida Inferior (Simetria Espelhada Suave)
        ctx.beginPath();
        ctx.moveTo(points[0].x, centerY + (centerY - points[0].y) * 0.4);
        for (let i = 0; i < points.length - 1; i++) {
            const nextY = centerY + (centerY - points[i + 1].y) * 0.4;
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (centerY + (centerY - points[i].y) * 0.4 + nextY) / 2;
            ctx.quadraticCurveTo(points[i].x, centerY + (centerY - points[i].y) * 0.4, xc, yc);
        }
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /**
     * MODO 3: Equalizador LED Matrix (Retro-Futurista)
     */
    drawLED(dataArray, w, h) {
        const ctx = this.ctx;
        const numColumns = 32;
        const numRows = 10;
        const colWidth = (w / numColumns) - 3;
        const rowHeight = (h / numRows) - 2;

        const sliceLength = Math.floor(dataArray.length * 0.7);

        for (let col = 0; col < numColumns; col++) {
            const dataIdx = Math.floor((col / numColumns) * sliceLength);
            const val = dataArray[dataIdx] || 0;
            const litRows = Math.round((val / 255) * numRows);

            const x = col * (colWidth + 3);

            for (let row = 0; row < numRows; row++) {
                const y = h - ((row + 1) * (rowHeight + 2));
                const isLit = row < litRows;

                if (isLit) {
                    // Cor baseada na altura da linha (LED Cyan -> Yellow -> Magenta)
                    if (row >= numRows - 2) {
                        ctx.fillStyle = '#ec4899'; // Magenta Peak
                        ctx.shadowColor = '#ec4899';
                        ctx.shadowBlur = 6;
                    } else if (row >= numRows - 5) {
                        ctx.fillStyle = '#f59e0b'; // Amber High
                        ctx.shadowColor = '#f59e0b';
                        ctx.shadowBlur = 4;
                    } else {
                        ctx.fillStyle = '#06b6d4'; // Cyan Mid/Low
                        ctx.shadowColor = '#06b6d4';
                        ctx.shadowBlur = 3;
                    }
                } else {
                    // LED apagado (fundo escuro transparente com textura de matriz)
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
                    ctx.shadowBlur = 0;
                }

                ctx.beginPath();
                ctx.roundRect(x, y, colWidth, rowHeight, 1.5);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }

    /**
     * MODO 4: Pulso Radial (Radial Frequency Core)
     */
    drawRadial(dataArray, w, h) {
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const baseRadius = Math.min(w, h) * 0.22;

        // Calcular bass energia para o pulso central
        const bass = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const pulseRadius = baseRadius + bass * 8;

        // 1. Núcleo Pulsante Central
        const coreGradient = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, pulseRadius);
        coreGradient.addColorStop(0, 'rgba(56, 189, 248, 0.9)');
        coreGradient.addColorStop(0.7, 'rgba(129, 140, 248, 0.4)');
        coreGradient.addColorStop(1, 'rgba(192, 132, 252, 0.0)');

        ctx.beginPath();
        ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = coreGradient;
        ctx.fill();

        // 2. Raios de Frequência Radiais
        const numSpokes = 48;
        const sliceLength = Math.floor(dataArray.length * 0.75);

        for (let i = 0; i < numSpokes; i++) {
            const angle = (i / numSpokes) * Math.PI * 2;
            const dataIdx = Math.floor((i / numSpokes) * sliceLength);
            const val = dataArray[dataIdx] || 0;
            const length = (val / 255) * (Math.min(w, h) * 0.28);

            const x1 = centerX + Math.cos(angle) * (pulseRadius + 2);
            const y1 = centerY + Math.sin(angle) * (pulseRadius + 2);
            const x2 = centerX + Math.cos(angle) * (pulseRadius + 2 + length);
            const y2 = centerY + Math.sin(angle) * (pulseRadius + 2 + length);

            ctx.strokeStyle = `hsl(${190 + (i / numSpokes) * 120}, 90%, 65%)`;
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    }

    /**
     * ESTADO DE STANDBY / AMBIENTE (Animação Suave quando Inativo)
     */
    drawIdleState(w, h) {
        const ctx = this.ctx;
        this.idlePhase += 0.035;
        const centerY = h / 2;

        // Onda Sine Harmônica Suave (Respiração de Luz)
        ctx.beginPath();
        const amplitude = 5 + Math.sin(this.idlePhase * 0.5) * 3;
        const points = [];
        const step = w / 40;

        for (let i = 0; i <= 40; i++) {
            const x = i * step;
            const y = centerY + Math.sin(this.idlePhase + i * 0.15) * amplitude;
            points.push({ x, y });
        }

        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Ponto luminoso pulsante deslizando pela onda
        const activeX = (Math.sin(this.idlePhase * 0.7) * 0.45 + 0.5) * w;
        const activeY = centerY + Math.sin(this.idlePhase + (activeX / step) * 0.15) * amplitude;

        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(activeX, activeY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    reset() {
        if (!this.canvas || !this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.peaks = [];
        this.peakHold = [];
        this.updateAmbientGlow(0);
        if (this.onVuUpdate) this.onVuUpdate(0, -60);
    }
}
