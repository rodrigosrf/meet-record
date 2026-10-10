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
        
        // Modos disponíveis: 'spectrum', 'wave', 'led', 'helix', 'electric', 'aurora', 'plasma', 'prism', 'pulsar', 'horizon', 'synapse', 'sonar'
        const savedMode = localStorage.getItem('meet_record_visualizer_mode');
        const invalidModes = ['particles', 'orbit', 'cyber', 'tunnel', 'radial'];
        const migratedMode = savedMode === 'liquid' ? 'electric' : savedMode;
        this.mode = invalidModes.includes(migratedMode) ? 'helix' : (migratedMode || 'spectrum');
        
        // Estado de física dos picos para o modo espectro
        this.peaks = [];
        this.peakHold = [];
        this.gravity = 0.45; // Queda mais suave e lenta dos picos

        // Fases de animação para os modos dinâmicos
        this.helixPhase = 0;
        this.electricPhase = 0;
        this.electricSparks = [];
        this.auroraPhase = 0;
        this.plasmaPhase = 0;
        this.pulsarPhase = 0;
        this.pulsarShockwaves = [];
        this.pulsarStars = [];
        this.horizonPhase = 0;
        this.synapseNodes = [];
        this.synapsePulses = [];
        this.synapsePhase = 0;
        this.sonarAngle = 0;
        this.sonarBlips = [];
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
        if (['spectrum', 'wave', 'led', 'helix', 'electric', 'liquid', 'aurora', 'plasma', 'prism', 'pulsar', 'horizon', 'synapse', 'sonar'].includes(newMode)) {
            this.mode = newMode === 'liquid' ? 'electric' : newMode;
            localStorage.setItem('meet_record_visualizer_mode', this.mode);
            this.peaks = [];
            this.peakHold = [];
            this.pulsarShockwaves = [];
            this.synapsePulses = [];
            this.sonarBlips = [];
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
    draw(dataArray, isActive = false, isPaused = false) {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // Verificar se há dados ativos de áudio
        let hasAudioData = false;
        let sum = 0;
        if (dataArray && dataArray.length > 0 && isActive && !isPaused) {
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
            case 'helix':
                this.drawHelix(dataArray, w, h);
                break;
            case 'electric':
            case 'liquid':
                this.drawElectric(dataArray, w, h);
                break;
            case 'aurora':
                this.drawAurora(dataArray, w, h);
                break;
            case 'plasma':
                this.drawPlasma(dataArray, w, h);
                break;
            case 'prism':
                this.drawPrism(dataArray, w, h);
                break;
            case 'pulsar':
                this.drawPulsar(dataArray, w, h);
                break;
            case 'horizon':
                this.drawHorizon(dataArray, w, h);
                break;
            case 'synapse':
                this.drawSynapse(dataArray, w, h);
                break;
            case 'sonar':
                this.drawSonar(dataArray, w, h);
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
     * MODO 4: Dupla Hélice Quântica 3D (Quantum Helix)
     */
    drawHelix(dataArray, w, h) {
        const ctx = this.ctx;
        this.helixPhase = (this.helixPhase || 0) + 0.04;
        const centerY = h / 2;
        const nodes = 28;
        const step = w / nodes;

        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const energy = bassSum * 0.5 + midSum * 0.4;

        const strandA = [];
        const strandB = [];

        // 1. Calcular Nós 3D da Dupla Hélice
        for (let i = 0; i <= nodes; i++) {
            const x = i * step;
            const dataIdx = Math.floor((i / nodes) * (dataArray.length * 0.65));
            const freqVal = (dataArray[dataIdx] || 0) / 255;

            // Ângulo de rotação 3D da fita
            const angle = this.helixPhase + i * 0.32;
            const sinVal = Math.sin(angle);
            const cosVal = Math.cos(angle); // Profundidade Z (-1 a 1)

            // Amplitude responsiva: no silêncio é suave (~10px), na fala expande até 28px
            const amp = 8 + (freqVal * (h * 0.38)) + (bassSum * 8);

            const yA = centerY + sinVal * amp;
            const yB = centerY - sinVal * amp;

            strandA.push({ x, y: yA, z: cosVal, freqVal });
            strandB.push({ x, y: yB, z: -cosVal, freqVal });
        }

        // 2. Desenhar Pontes de Ressonância (Conectores entre as fitas)
        for (let i = 0; i <= nodes; i++) {
            const pA = strandA[i];
            const pB = strandB[i];

            if (pA.freqVal > 0.05 || energy > 0.08) {
                ctx.beginPath();
                ctx.moveTo(pA.x, pA.y);
                ctx.lineTo(pB.x, pB.y);

                const bridgeAlpha = Math.min(0.85, 0.15 + pA.freqVal * 0.7);
                ctx.strokeStyle = `rgba(168, 85, 247, ${bridgeAlpha})`;
                ctx.lineWidth = 1 + pA.freqVal * 2;
                ctx.stroke();

                // Ponto central de pulso no cruzamento
                if (pA.freqVal > 0.2) {
                    const midY = (pA.y + pB.y) / 2;
                    ctx.beginPath();
                    ctx.arc(pA.x, midY, 1.5 + pA.freqVal * 2, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = '#a855f7';
                    ctx.shadowBlur = 6;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
        }

        // Função auxiliar para desenhar uma fita com curvas suaves
        const drawStrand = (strand, color, strokeColor, shadowColor) => {
            ctx.beginPath();
            ctx.moveTo(strand[0].x, strand[0].y);
            for (let i = 0; i < strand.length - 1; i++) {
                const xc = (strand[i].x + strand[i + 1].x) / 2;
                const yc = (strand[i].y + strand[i + 1].y) / 2;
                ctx.quadraticCurveTo(strand[i].x, strand[i].y, xc, yc);
            }
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2.2;
            if (energy > 0.12) {
                ctx.shadowColor = shadowColor;
                ctx.shadowBlur = 8 + energy * 10;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Desenhar esferas nos nós frontais (Z > 0)
            strand.forEach(pt => {
                if (pt.z > -0.2) {
                    const nodeRadius = Math.max(2, 2.5 + pt.freqVal * 3 + (pt.z * 1.2));
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, nodeRadius, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    if (pt.freqVal > 0.15) {
                        ctx.shadowColor = shadowColor;
                        ctx.shadowBlur = 8;
                    }
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            });
        };

        // 3. Desenhar Fita Alpha (Ciano Neon)
        drawStrand(strandA, '#38bdf8', '#0284c7', '#38bdf8');

        // 4. Desenhar Fita Beta (Rosa Neon / Violeta)
        drawStrand(strandB, '#ec4899', '#db2777', '#ec4899');
    }

    /**
     * MODO 5: Chamas Fluidas de Plasma Neon (Plasma Waves)
     */
    drawPlasma(dataArray, w, h) {
        const ctx = this.ctx;
        this.plasmaPhase = (this.plasmaPhase || 0) + 0.035;
        const numTongues = 28;
        const colWidth = w / numTongues;

        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const energy = bassSum * 0.5 + midSum * 0.4;

        // 1. Camada de Fundo: Brilho de Calor de Plasma
        if (energy > 0.04) {
            const glowGrad = ctx.createLinearGradient(0, h * 0.4, 0, h);
            glowGrad.addColorStop(0, 'rgba(168, 85, 247, 0)');
            glowGrad.addColorStop(0.6, `rgba(168, 85, 247, ${0.12 + energy * 0.25})`);
            glowGrad.addColorStop(1, `rgba(56, 189, 248, ${0.2 + energy * 0.35})`);
            ctx.fillStyle = glowGrad;
            ctx.fillRect(0, 0, w, h);
        }

        // 2. Pontos das Chamas Superiores
        const flamePoints = [];
        for (let i = 0; i <= numTongues; i++) {
            const x = i * colWidth;
            const dataIdx = Math.floor((i / numTongues) * (dataArray.length * 0.6));
            const freqVal = (dataArray[dataIdx] || 0) / 255;

            // Ondulação de chamas orgânica
            const flameWiggle = Math.sin(this.plasmaPhase * 1.5 + i * 0.35) * (3 + energy * 6) +
                                Math.cos(this.plasmaPhase * 0.8 + i * 0.5) * (2 + bassSum * 4);
            const flameHeight = Math.max(3, (freqVal * (h * 0.75)) + 4 + flameWiggle);
            const y = Math.max(4, h - flameHeight);
            flamePoints.push({ x, y, freqVal });
        }

        // 3. Desenhar Corpo Principal da Chama com Gradiente Neon (Ciano -> Violeta -> Rosa)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(flamePoints[0].x, flamePoints[0].y);

        for (let i = 0; i < flamePoints.length - 1; i++) {
            const xc = (flamePoints[i].x + flamePoints[i + 1].x) / 2;
            const yc = (flamePoints[i].y + flamePoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(flamePoints[i].x, flamePoints[i].y, xc, yc);
        }
        ctx.lineTo(w, flamePoints[flamePoints.length - 1].y);
        ctx.lineTo(w, h);
        ctx.closePath();

        const plasmaGrad = ctx.createLinearGradient(0, h * 0.2, 0, h);
        plasmaGrad.addColorStop(0, 'rgba(236, 72, 153, 0.85)'); // Rosa Neon no topo
        plasmaGrad.addColorStop(0.4, 'rgba(168, 85, 247, 0.75)'); // Violeta no meio
        plasmaGrad.addColorStop(0.8, 'rgba(56, 189, 248, 0.85)'); // Ciano na base
        plasmaGrad.addColorStop(1, 'rgba(14, 165, 233, 0.95)');

        ctx.fillStyle = plasmaGrad;
        ctx.fill();

        // 4. Crista Iluminada com Glow de Calor
        ctx.beginPath();
        ctx.moveTo(flamePoints[0].x, flamePoints[0].y);
        for (let i = 0; i < flamePoints.length - 1; i++) {
            const xc = (flamePoints[i].x + flamePoints[i + 1].x) / 2;
            const yc = (flamePoints[i].y + flamePoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(flamePoints[i].x, flamePoints[i].y, xc, yc);
        }
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#f472b6';
        ctx.shadowBlur = 8 + energy * 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 5. Núcleo Interno Branco-Ciano (Fogo Interno mais quente)
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(flamePoints[0].x, h - (h - flamePoints[0].y) * 0.5);

        for (let i = 0; i < flamePoints.length - 1; i++) {
            const y1 = h - (h - flamePoints[i].y) * 0.55;
            const y2 = h - (h - flamePoints[i + 1].y) * 0.55;
            const xc = (flamePoints[i].x + flamePoints[i + 1].x) / 2;
            const yc = (y1 + y2) / 2;
            ctx.quadraticCurveTo(flamePoints[i].x, y1, xc, yc);
        }
        ctx.lineTo(w, h);
        ctx.closePath();

        const innerGrad = ctx.createLinearGradient(0, h * 0.5, 0, h);
        innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        innerGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.5)');
        innerGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = innerGrad;
        ctx.fill();

        ctx.restore();
    }

    /**
     * MODO 6: Descarga Elétrica e Raios Tesla (Electric Lightning Arc)
     */
    drawElectric(dataArray, w, h) {
        const ctx = this.ctx;
        if (!this.electricSparks) this.electricSparks = [];
        this.electricPhase = (this.electricPhase || 0) + 0.14;

        const centerY = h * 0.5;
        const startX = 16;
        const endX = w - 16;
        const spanX = Math.max(10, endX - startX);

        // Análise de frequências de áudio
        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const trebleSum = (dataArray[24] + dataArray[28] + dataArray[32]) / (3 * 255);
        const totalEnergy = Math.min(1, bassSum * 0.45 + midSum * 0.35 + trebleSum * 0.2);

        this.electricPhase += totalEnergy * 0.12;

        ctx.save();

        // 1. Campo de Indução Eletrostática Ambiente (Aura de Plasma e Flash Sutil)
        if (totalEnergy > 0.04) {
            const glowGrad = ctx.createRadialGradient(w * 0.5, centerY, 4, w * 0.5, centerY, w * 0.55);
            glowGrad.addColorStop(0, `rgba(56, 189, 248, ${0.08 + totalEnergy * 0.22})`);
            glowGrad.addColorStop(0.5, `rgba(168, 85, 247, ${0.04 + totalEnergy * 0.14})`);
            glowGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
            ctx.fillStyle = glowGrad;
            ctx.fillRect(0, 0, w, h);

            // Flash estroboscópico sutil em picos fortes de grave
            if (bassSum > 0.62) {
                ctx.fillStyle = `rgba(255, 255, 255, ${(bassSum - 0.62) * 0.2})`;
                ctx.fillRect(0, 0, w, h);
            }
        }

        // 2. Terminais / Eletrodos Tesla Emissores (Esquerda e Direita)
        [startX, endX].forEach((nodeX, idx) => {
            const isLeft = idx === 0;
            const nodeRadius = 3 + totalEnergy * 2.5;

            // Corona exterior difusa
            const corona = ctx.createRadialGradient(nodeX, centerY, 1, nodeX, centerY, 12 + totalEnergy * 8);
            corona.addColorStop(0, '#ffffff');
            corona.addColorStop(0.35, isLeft ? 'rgba(56, 189, 248, 0.85)' : 'rgba(192, 132, 252, 0.85)');
            corona.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.fillStyle = corona;
            ctx.beginPath();
            ctx.arc(nodeX, centerY, 12 + totalEnergy * 8, 0, Math.PI * 2);
            ctx.fill();

            // Anel pulsante
            ctx.beginPath();
            ctx.arc(nodeX, centerY, nodeRadius + 3, 0, Math.PI * 2);
            ctx.strokeStyle = isLeft ? 'rgba(56, 189, 248, 0.6)' : 'rgba(192, 132, 252, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Núcleo incandescente do eletrodo
            ctx.beginPath();
            ctx.arc(nodeX, centerY, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = isLeft ? '#38bdf8' : '#c084fc';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // 3. Gerar Vértices do Raio Principal (Main Lightning Bolt)
        const segments = 34;
        const step = spanX / segments;
        const mainBolt = [];

        for (let i = 0; i <= segments; i++) {
            const ratio = i / segments;
            const x = startX + i * step;

            // Envelope parabólico para ancorar firmemente as pontas nos eletrodos
            const envelope = Math.sin(ratio * Math.PI);

            // Mapear espectro de áudio ao longo do comprimento
            const dataIdx = Math.floor(ratio * (dataArray.length * 0.65));
            const audioVal = (dataArray[dataIdx] || 0) / 255;

            // Ondulação senoidal combinada com ruído estático de alta voltagem
            const waveJitter = Math.sin(this.electricPhase * 3.2 + i * 0.6) * (3 + audioVal * (h * 0.22));
            const noiseJitter = (Math.random() - 0.5) * (4 + audioVal * (h * 0.44) + bassSum * 12);
            const rawY = centerY + (waveJitter + noiseJitter) * envelope;
            const y = Math.max(6, Math.min(h - 6, rawY));

            mainBolt.push({ x, y, audioVal, ratio });
        }

        // 4. Gerar Vértices do Arco Secundário (Secondary Violet Arc)
        const subSegments = 24;
        const subStep = spanX / subSegments;
        const subBolt = [];

        for (let i = 0; i <= subSegments; i++) {
            const ratio = i / subSegments;
            const x = startX + i * subStep;
            const envelope = Math.sin(ratio * Math.PI);

            const dataIdx = Math.floor((1 - ratio) * (dataArray.length * 0.55));
            const audioVal = (dataArray[dataIdx] || 0) / 255;

            const waveJitter = -Math.sin(this.electricPhase * 2.6 + i * 0.7) * (2 + audioVal * (h * 0.18));
            const noiseJitter = (Math.random() - 0.5) * (3 + audioVal * (h * 0.32) + midSum * 10);
            const rawY = centerY + (waveJitter + noiseJitter) * envelope;
            const y = Math.max(6, Math.min(h - 6, rawY));

            subBolt.push({ x, y, audioVal });
        }

        ctx.globalCompositeOperation = 'screen';

        // 5. Renderizar Arco Secundário (Violeta/Magenta)
        if (subBolt.length > 1) {
            // Brilho violeta externo
            ctx.beginPath();
            ctx.moveTo(subBolt[0].x, subBolt[0].y);
            for (let i = 1; i < subBolt.length; i++) {
                ctx.lineTo(subBolt[i].x, subBolt[i].y);
            }
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
            ctx.lineWidth = 3 + totalEnergy * 2;
            ctx.shadowColor = '#a855f7';
            ctx.shadowBlur = 10;
            ctx.stroke();

            // Filamento interno violeta neon
            ctx.beginPath();
            ctx.moveTo(subBolt[0].x, subBolt[0].y);
            for (let i = 1; i < subBolt.length; i++) {
                ctx.lineTo(subBolt[i].x, subBolt[i].y);
            }
            ctx.strokeStyle = '#e879f9';
            ctx.lineWidth = 1.2;
            ctx.shadowColor = '#f472b6';
            ctx.shadowBlur = 4;
            ctx.stroke();
        }

        // 6. Renderizar Raio Principal em 3 Camadas (High Dynamic Plasma)
        if (mainBolt.length > 1) {
            // Camada 1: Aura difusa de arco voltaico
            ctx.beginPath();
            ctx.moveTo(mainBolt[0].x, mainBolt[0].y);
            for (let i = 1; i < mainBolt.length; i++) {
                ctx.lineTo(mainBolt[i].x, mainBolt[i].y);
            }
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)';
            ctx.lineWidth = 7 + totalEnergy * 5;
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 16;
            ctx.stroke();

            // Camada 2: Tronco principal de alta voltagem ciano
            ctx.beginPath();
            ctx.moveTo(mainBolt[0].x, mainBolt[0].y);
            for (let i = 1; i < mainBolt.length; i++) {
                ctx.lineTo(mainBolt[i].x, mainBolt[i].y);
            }
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.6 + totalEnergy * 1.8;
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 8;
            ctx.stroke();

            // Camada 3: Núcleo branco superquente (Brilliant Hot White Core)
            ctx.beginPath();
            ctx.moveTo(mainBolt[0].x, mainBolt[0].y);
            for (let i = 1; i < mainBolt.length; i++) {
                ctx.lineTo(mainBolt[i].x, mainBolt[i].y);
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2 + totalEnergy * 0.6;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 4;
            ctx.stroke();
        }

        // 7. Ramificações Eletrizantes (Lightning Forks / Branches)
        if (totalEnergy > 0.12) {
            const numBranches = Math.min(4, Math.floor(1 + totalEnergy * 3));
            for (let b = 0; b < numBranches; b++) {
                const targetIdx = 4 + Math.floor((b + 0.5) * ((segments - 8) / numBranches));
                const origin = mainBolt[targetIdx];
                if (!origin || origin.audioVal < 0.15) continue;

                const dir = (b % 2 === 0 ? -1 : 1);
                const branchLen = (12 + origin.audioVal * (h * 0.35)) * dir;

                ctx.beginPath();
                ctx.moveTo(origin.x, origin.y);

                const midX = origin.x + (Math.random() - 0.5) * 16;
                const midY = origin.y + branchLen * 0.55 + (Math.random() - 0.5) * 6;
                const endBranchX = midX + (Math.random() - 0.5) * 20;
                const endBranchY = origin.y + branchLen;

                ctx.lineTo(midX, midY);
                ctx.lineTo(endBranchX, endBranchY);

                ctx.strokeStyle = 'rgba(186, 230, 253, 0.85)';
                ctx.lineWidth = 1.2;
                ctx.shadowColor = '#38bdf8';
                ctx.shadowBlur = 6;
                ctx.stroke();

                // Centelha na ponta da ramificação
                ctx.beginPath();
                ctx.arc(endBranchX, endBranchY, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
        }

        // 8. Partículas de Centelha Iônica (Electric Sparks)
        if (totalEnergy > 0.08 && this.electricSparks.length < 32) {
            const spawnCount = Math.min(3, Math.floor(1 + totalEnergy * 3));
            for (let s = 0; s < spawnCount; s++) {
                const randPt = mainBolt[Math.floor(Math.random() * mainBolt.length)];
                if (randPt) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 1.5 + Math.random() * (3 + totalEnergy * 5);
                    this.electricSparks.push({
                        x: randPt.x,
                        y: randPt.y,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        life: 1.0,
                        decay: 0.035 + Math.random() * 0.05,
                        size: 1 + Math.random() * 1.6,
                        color: Math.random() > 0.3 ? '#38bdf8' : '#e879f9'
                    });
                }
            }
        }

        // Atualizar e renderizar centelhas
        for (let i = this.electricSparks.length - 1; i >= 0; i--) {
            const spark = this.electricSparks[i];
            spark.x += spark.vx;
            spark.y += spark.vy;
            spark.vx *= 0.94;
            spark.vy *= 0.94;
            spark.life -= spark.decay;

            if (spark.life <= 0 || spark.x < 0 || spark.x > w || spark.y < 0 || spark.y > h) {
                this.electricSparks.splice(i, 1);
                continue;
            }

            ctx.beginPath();
            ctx.arc(spark.x, spark.y, spark.size * spark.life, 0, Math.PI * 2);
            ctx.fillStyle = spark.color;
            ctx.shadowColor = spark.color;
            ctx.shadowBlur = 6;
            ctx.fill();
        }

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    /**
     * MODO 7: Aurora Boreal Fluorescente (Aurora Waves)
     */
    drawAurora(dataArray, w, h) {
        const ctx = this.ctx;
        this.auroraPhase += 0.028;
        const columns = 36;
        const colWidth = w / columns;

        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const topPoints = [];

        for (let i = 0; i < columns; i++) {
            const x = i * colWidth + colWidth / 2;
            const dataIdx = Math.floor((i / columns) * (dataArray.length * 0.65));
            const freqVal = (dataArray[dataIdx] || 0) / 255;

            const waveOffset = Math.sin(this.auroraPhase + i * 0.22) * (6 + bassSum * 8);
            const heightFactor = Math.min(h * 0.85, (freqVal * (h * 0.7)) + 8 + waveOffset);
            const topY = Math.max(4, h - heightFactor);
            topPoints.push({ x, y: topY });

            const beamGrad = ctx.createLinearGradient(x, topY, x, h);
            beamGrad.addColorStop(0, `hsla(${150 + i * 4}, 90%, 65%, ${0.5 + freqVal * 0.45})`);
            beamGrad.addColorStop(0.5, `hsla(${190 + i * 3}, 90%, 60%, ${0.3 + freqVal * 0.3})`);
            beamGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');

            ctx.fillStyle = beamGrad;
            ctx.fillRect(x - colWidth / 2, topY, colWidth - 1, h - topY);
        }

        if (topPoints.length > 1) {
            ctx.beginPath();
            ctx.moveTo(topPoints[0].x, topPoints[0].y);
            for (let i = 0; i < topPoints.length - 1; i++) {
                const xc = (topPoints[i].x + topPoints[i + 1].x) / 2;
                const yc = (topPoints[i].y + topPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(topPoints[i].x, topPoints[i].y, xc, yc);
            }
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#34d399';
            ctx.shadowBlur = 10 + bassSum * 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    /**
     * MODO 6: Prisma Cristalino Dual Espelhado (Crystal Prism)
     */
    drawPrism(dataArray, w, h) {
        const ctx = this.ctx;
        const centerY = h / 2;
        const bars = 40;
        const barWidth = (w / bars) * 0.7;
        const gap = (w / bars) * 0.3;

        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const energy = (dataArray.slice(0, 32).reduce((a, b) => a + b, 0)) / (32 * 255);

        // 1. Linha de Centro Cristalina
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.3 + energy * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // 2. Barras Espelhadas Topo e Fundo com Reflexo de Vidro
        for (let i = 0; i < bars; i++) {
            const x = i * (barWidth + gap) + gap / 2;
            const dataIdx = Math.floor((i / bars) * (dataArray.length * 0.65));
            const normVal = (dataArray[dataIdx] || 0) / 255;

            // Altura da barra
            const barHeight = Math.max(2, normVal * (h * 0.44) + (energy > 0.05 ? 2 : 0));
            const hue = 175 + (i / bars) * 135; // Esmeralda -> Ciano -> Violeta -> Magenta

            // Barra Superior
            const topGrad = ctx.createLinearGradient(x, centerY, x, centerY - barHeight);
            topGrad.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.9)`);
            topGrad.addColorStop(1, `hsla(${hue + 25}, 95%, 70%, 0.4)`);

            ctx.fillStyle = topGrad;
            ctx.beginPath();
            ctx.roundRect(x, centerY - barHeight, barWidth, barHeight, [2, 2, 0, 0]);
            ctx.fill();

            // Barra Inferior Espelhada (com opacidade de reflexão)
            const botGrad = ctx.createLinearGradient(x, centerY, x, centerY + barHeight);
            botGrad.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.6)`);
            botGrad.addColorStop(1, `hsla(${hue + 25}, 95%, 70%, 0.1)`);

            ctx.fillStyle = botGrad;
            ctx.beginPath();
            ctx.roundRect(x, centerY, barWidth, barHeight * 0.75, [0, 0, 2, 2]);
            ctx.fill();

            // Ponto de Pico de Luz de Cristal
            if (normVal > 0.15) {
                ctx.beginPath();
                ctx.arc(x + barWidth / 2, centerY - barHeight - 1.5, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = `hsl(${hue}, 90%, 65%)`;
                ctx.shadowBlur = 6;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }

    /**
     * MODO 9: Pulsar Cósmico & Ondas de Choque Estelares (Cosmic Pulsar & Shockwaves)
     */
    drawPulsar(dataArray, w, h) {
        const ctx = this.ctx;
        const cx = w / 2;
        const cy = h / 2;

        // Frequências
        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16] + dataArray[20]) / (4 * 255);
        const trebleSum = (dataArray[28] + dataArray[36] + dataArray[44]) / (3 * 255);
        const totalEnergy = bassSum * 0.5 + midSum * 0.35 + trebleSum * 0.15;

        this.pulsarPhase = (this.pulsarPhase || 0) + 0.03 + totalEnergy * 0.05;

        // 1. Inicializar estrelas orbitais de fundo se necessário
        if (!this.pulsarStars || this.pulsarStars.length === 0) {
            this.pulsarStars = [];
            for (let i = 0; i < 36; i++) {
                this.pulsarStars.push({
                    baseAngle: Math.random() * Math.PI * 2,
                    orbitX: 35 + Math.random() * (w * 0.44),
                    orbitY: 10 + Math.random() * (h * 0.36),
                    speed: (0.3 + Math.random() * 0.7) * (Math.random() > 0.5 ? 1 : -1),
                    size: 0.8 + Math.random() * 1.5,
                    hue: Math.random() > 0.4 ? 195 : 280
                });
            }
        }

        // 2. Ondas de Choque Gravitacionais Expansivas (Shockwaves acionadas por graves)
        if (!this.pulsarShockwaves) this.pulsarShockwaves = [];
        if (bassSum > 0.14 && this.pulsarShockwaves.length < 8 && Math.random() < 0.38) {
            this.pulsarShockwaves.push({
                rx: 10,
                speed: 2.2 + bassSum * 5.0,
                maxRx: w * 0.46,
                alpha: 0.85,
                hue: 185 + Math.random() * 85 // Ciano ao Violeta
            });
        }

        // Renderizar Shockwaves
        ctx.save();
        for (let i = this.pulsarShockwaves.length - 1; i >= 0; i--) {
            const sw = this.pulsarShockwaves[i];
            sw.rx += sw.speed;
            const swRy = sw.rx * 0.35;
            sw.alpha *= 0.96;

            if (sw.rx >= sw.maxRx || sw.alpha <= 0.02) {
                this.pulsarShockwaves.splice(i, 1);
                continue;
            }

            ctx.beginPath();
            ctx.ellipse(cx, cy, sw.rx, swRy, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${sw.hue}, 90%, 65%, ${sw.alpha})`;
            ctx.lineWidth = 1.5 + sw.alpha * 1.5;
            ctx.shadowColor = `hsl(${sw.hue}, 90%, 60%)`;
            ctx.shadowBlur = 8;
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.restore();

        // 3. Estrelas / Poeira Cósmica em Órbita Gravitacional
        this.pulsarStars.forEach(star => {
            const angle = star.baseAngle + this.pulsarPhase * star.speed;
            const currentOrbitX = star.orbitX + bassSum * 20;
            const currentOrbitY = star.orbitY + bassSum * 8;
            const sx = cx + Math.cos(angle) * currentOrbitX;
            const sy = cy + Math.sin(angle) * currentOrbitY;

            const alpha = 0.35 + totalEnergy * 0.55;
            ctx.beginPath();
            ctx.arc(sx, sy, star.size + totalEnergy * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${star.hue}, 90%, 75%, ${alpha})`;
            if (totalEnergy > 0.15) {
                ctx.shadowColor = `hsl(${star.hue}, 90%, 70%)`;
                ctx.shadowBlur = 6;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // 4. Feixes Relativísticos Horizontais (Horizontal Energy Beams emitidos pelas pontas)
        const jetSegments = 24;
        const maxJetLen = w * 0.46;

        ['left', 'right'].forEach(dir => {
            const sign = dir === 'left' ? -1 : 1;
            const jetPoints = [];
            jetPoints.push({ x: cx, y: cy });

            for (let j = 1; j <= jetSegments; j++) {
                const ratio = j / jetSegments;
                const jx = cx + sign * (ratio * maxJetLen);
                const dataIdx = Math.floor(ratio * (dataArray.length * 0.5));
                const freqVal = (dataArray[dataIdx] || 0) / 255;

                // Ondulação do feixe com atenuação nas extremidades
                const envelope = Math.sin(ratio * Math.PI);
                const jitter = Math.sin(this.pulsarPhase * 3.5 + j * 0.45) * (1.5 + freqVal * (h * 0.22)) * envelope;
                const jy = cy + jitter;
                jetPoints.push({ x: jx, y: jy, freqVal });
            }

            // Glow do feixe
            ctx.beginPath();
            ctx.moveTo(jetPoints[0].x, jetPoints[0].y);
            for (let j = 1; j < jetPoints.length; j++) {
                ctx.lineTo(jetPoints[j].x, jetPoints[j].y);
            }
            ctx.strokeStyle = `rgba(56, 189, 248, ${0.25 + totalEnergy * 0.45})`;
            ctx.lineWidth = 4 + totalEnergy * 4;
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 10;
            ctx.stroke();

            // Núcleo do feixe (branco/ciano intenso)
            ctx.beginPath();
            ctx.moveTo(jetPoints[0].x, jetPoints[0].y);
            for (let j = 1; j < jetPoints.length; j++) {
                ctx.lineTo(jetPoints[j].x, jetPoints[j].y);
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2 + totalEnergy * 0.8;
            ctx.stroke();
            ctx.shadowBlur = 0;
        });

        // 5. Anéis de Acreção 3D Inclinados (Magnetic Accretion Rings)
        const rings = [
            { rx: 32 + bassSum * 38, ry: 10 + bassSum * 12, tilt: -0.22, color: 'rgba(245, 158, 11, ', glow: '#f59e0b' }, // Ouro/Âmbar
            { rx: 62 + midSum * 50, ry: 18 + midSum * 16, tilt: 0.18, color: 'rgba(56, 189, 248, ', glow: '#38bdf8' },    // Ciano
            { rx: 94 + trebleSum * 56, ry: 26 + trebleSum * 18, tilt: -0.35, color: 'rgba(192, 132, 252, ', glow: '#c084fc' } // Violeta
        ];

        rings.forEach((ring, idx) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(ring.tilt + Math.sin(this.pulsarPhase * 0.8 + idx) * 0.08);

            ctx.beginPath();
            ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `${ring.color}${0.35 + totalEnergy * 0.55})`;
            ctx.lineWidth = 1.5;
            ctx.shadowColor = ring.glow;
            ctx.shadowBlur = 8 + totalEnergy * 8;
            ctx.stroke();

            // Ponto orbital de luz no anel
            const ringAngle = this.pulsarPhase * (1.2 + idx * 0.4);
            const spotX = Math.cos(ringAngle) * ring.rx;
            const spotY = Math.sin(ringAngle) * ring.ry;
            ctx.beginPath();
            ctx.arc(spotX, spotY, 2 + totalEnergy * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = ring.glow;
            ctx.shadowBlur = 10;
            ctx.fill();

            ctx.restore();
        });

        // 6. Núcleo Central do Pulsar (Super-Luminous Stellar Core)
        const coreRadius = Math.max(5, 7 + bassSum * 16);
        const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2.5);
        coreGlow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        coreGlow.addColorStop(0.3, 'rgba(56, 189, 248, 0.8)');
        coreGlow.addColorStop(0.6, 'rgba(129, 140, 248, 0.4)');
        coreGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');

        ctx.fillStyle = coreGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Núcleo branco sólido
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14 + bassSum * 14;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Picos de Difração Estelar (4-Spike Stellar Diffraction)
        if (totalEnergy > 0.08) {
            const spikeLen = coreRadius * (2.0 + totalEnergy * 3.5);
            ctx.beginPath();
            // Vertical
            ctx.moveTo(cx, cy - spikeLen);
            ctx.lineTo(cx, cy + spikeLen);
            // Horizontal
            ctx.moveTo(cx - spikeLen * 1.4, cy);
            ctx.lineTo(cx + spikeLen * 1.4, cy);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.2;
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    /**
     * MODO 10: Horizonte 3D Synthwave Cibernético (Cyberpunk 3D Perspective Grid)
     */
    drawHorizon(dataArray, w, h) {
        const ctx = this.ctx;
        const horizonY = h * 0.26;
        const vx = w / 2;
        const vy = horizonY;

        // Energia
        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const energy = bassSum * 0.6 + midSum * 0.4;

        this.horizonPhase = (this.horizonPhase || 0) + 0.025 + bassSum * 0.035;

        // 1. Sol / Aura de Horizonte Neon no Ponto de Fuga
        const sunRadius = 24 + bassSum * 16;
        const sunGlow = ctx.createRadialGradient(vx, vy, 2, vx, vy, sunRadius * 1.8);
        sunGlow.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        sunGlow.addColorStop(0.3, 'rgba(244, 63, 94, 0.75)'); // Rose Neon
        sunGlow.addColorStop(0.7, 'rgba(168, 85, 247, 0.35)'); // Purple
        sunGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');

        ctx.fillStyle = sunGlow;
        ctx.beginPath();
        ctx.arc(vx, vy, sunRadius * 1.8, Math.PI, Math.PI * 2); // Semicírculo superior do sol
        ctx.fill();

        // 2. Linha do Horizonte Neon Lúmina
        ctx.beginPath();
        ctx.moveTo(0, horizonY);
        ctx.lineTo(w, horizonY);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.5 + energy * 0.45})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8 + energy * 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 3. Grid de Perspectiva 3D
        const cols = 22;
        const rows = 9;
        const gridPoints = []; // Matriz [row][col]

        // Offset de rolagem infinita suave (0 a 1)
        const scrollOffset = (this.horizonPhase % 1.0);

        for (let r = 0; r <= rows; r++) {
            gridPoints[r] = [];
            // Fator de profundidade não linear (perspectiva cônica)
            const rowRatio = Math.max(0, (r + scrollOffset) / (rows + 1));
            const depthT = Math.pow(rowRatio, 2.1);
            const rowY = horizonY + depthT * (h - horizonY);

            // Largura expandida pela perspectiva
            const halfSpread = (w * 0.5) * depthT + 6;

            for (let c = 0; c <= cols; c++) {
                const colNorm = (c / cols) * 2 - 1; // -1 (esquerda) a +1 (direita)
                const baseX = vx + colNorm * halfSpread;

                // Frequência de áudio mapeada simetricamente do centro para as bordas
                const freqDistance = Math.abs(colNorm);
                const dataIdx = Math.floor(freqDistance * (dataArray.length * 0.6));
                const audioVal = (dataArray[dataIdx] || 0) / 255;

                // Elevação de terreno: montanhas que se erguem com o som
                const elevation = (audioVal * (h * 0.36) + (r === rows ? bassSum * 8 : 0)) * depthT;
                const ptY = Math.max(horizonY - 8, rowY - elevation);

                gridPoints[r][c] = { x: baseX, y: ptY, audioVal, depthT };
            }
        }

        // 4. Renderizar Linhas Transversais (Horizontais Onduladas)
        for (let r = 0; r <= rows; r++) {
            const rowPts = gridPoints[r];
            if (!rowPts || rowPts.length < 2) continue;

            const depthT = rowPts[0].depthT;
            ctx.beginPath();
            ctx.moveTo(rowPts[0].x, rowPts[0].y);

            for (let c = 0; c < cols; c++) {
                const xc = (rowPts[c].x + rowPts[c + 1].x) / 2;
                const yc = (rowPts[c].y + rowPts[c + 1].y) / 2;
                ctx.quadraticCurveTo(rowPts[c].x, rowPts[c].y, xc, yc);
            }
            ctx.lineTo(rowPts[cols].x, rowPts[cols].y);

            // Gradiente de cor por profundidade: do Violeta no fundo ao Ciano Neon no primeiro plano
            const hue = 280 - depthT * 95; // 280 (Violeta) -> 185 (Ciano)
            const alpha = 0.25 + depthT * 0.65;
            ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${alpha})`;
            ctx.lineWidth = 1.0 + depthT * 1.5;
            if (depthT > 0.4 && energy > 0.1) {
                ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
                ctx.shadowBlur = 6;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // 5. Renderizar Linhas Longitudinais (Raios de Perspectiva)
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(gridPoints[0][c].x, gridPoints[0][c].y);

            for (let r = 0; r < rows; r++) {
                const nextPt = gridPoints[r + 1][c];
                ctx.lineTo(nextPt.x, nextPt.y);
            }

            const centerDist = Math.abs((c / cols) * 2 - 1);
            ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + (1 - centerDist * 0.5) * 0.35})`;
            ctx.lineWidth = 1.0;
            ctx.stroke();
        }

        // 6. Nós de Vértice Iluminados (Luminous Grid Vertices nos Picos)
        for (let r = 2; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const pt = gridPoints[r][c];
                if (pt.audioVal > 0.28 && pt.depthT > 0.25) {
                    const nodeRadius = 1.2 + pt.audioVal * 2.2 * pt.depthT;
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, nodeRadius, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = '#00f0ff';
                    ctx.shadowBlur = 8;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
        }

        // 7. Feixe Laser Telemetria de Varredura no Topo das Montanhas
        if (energy > 0.12) {
            const scanY = horizonY + Math.sin(this.horizonPhase * 2.0) * (h * 0.25) + (h * 0.2);
            ctx.beginPath();
            ctx.moveTo(0, scanY);
            ctx.lineTo(w, scanY);
            ctx.strokeStyle = `rgba(244, 63, 94, ${0.4 + energy * 0.4})`;
            ctx.lineWidth = 1.2;
            ctx.shadowColor = '#f43f5e';
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    /**
     * MODO 11: Rede Neural & Impulsos Sinápticos (Synaptic Neural Network)
     */
    drawSynapse(dataArray, w, h) {
        const ctx = this.ctx;
        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const trebleSum = (dataArray[24] + dataArray[32] + dataArray[40]) / (3 * 255);
        const totalEnergy = bassSum * 0.5 + midSum * 0.35 + trebleSum * 0.15;

        this.synapsePhase = (this.synapsePhase || 0) + 0.03 + totalEnergy * 0.04;

        // 1. Inicializar ou recalcular nós da rede neural
        const nodeCount = 30;
        if (!this.synapseNodes || this.synapseNodes.length !== nodeCount || this.lastSynapseW !== w) {
            this.lastSynapseW = w;
            this.synapseNodes = [];
            for (let i = 0; i < nodeCount; i++) {
                const col = i % 6;
                const row = Math.floor(i / 6);
                const baseX = (col + 0.5) * (w / 6);
                const baseY = (row + 0.5) * (h / 5);
                this.synapseNodes.push({
                    x: baseX + (Math.sin(i * 1.7) * (w / 14)),
                    y: Math.max(8, Math.min(h - 8, baseY + (Math.cos(i * 2.3) * (h / 12)))),
                    baseSize: 2 + (i % 3) * 1.2,
                    connections: [],
                    cluster: i % 3, // 0: Bass, 1: Mid, 2: Treble
                    energy: 0
                });
            }

            // Estabelecer conexões de axônio entre vizinhos próximos (distância < w / 4)
            const maxDist = w * 0.26;
            for (let i = 0; i < nodeCount; i++) {
                for (let j = i + 1; j < nodeCount; j++) {
                    const dx = this.synapseNodes[i].x - this.synapseNodes[j].x;
                    const dy = this.synapseNodes[i].y - this.synapseNodes[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < maxDist && this.synapseNodes[i].connections.length < 3) {
                        this.synapseNodes[i].connections.push(j);
                    }
                }
            }
        }

        // 2. Atualizar energia de cada nó baseada nas bandas de áudio
        this.synapseNodes.forEach((node, idx) => {
            let targetEnergy = 0;
            if (node.cluster === 0) targetEnergy = bassSum;
            else if (node.cluster === 1) targetEnergy = midSum;
            else targetEnergy = trebleSum;

            const jitter = Math.sin(this.synapsePhase + idx) * 0.08;
            node.energy = Math.max(0, targetEnergy + jitter);
        });

        // 3. Gerar novos impulsos elétricos sinápticos (Action Potential Sparks)
        if (!this.synapsePulses) this.synapsePulses = [];
        if (totalEnergy > 0.1 && this.synapsePulses.length < 24 && Math.random() < 0.45) {
            const fromIdx = Math.floor(Math.random() * nodeCount);
            const fromNode = this.synapseNodes[fromIdx];
            if (fromNode && fromNode.connections.length > 0) {
                const toIdx = fromNode.connections[Math.floor(Math.random() * fromNode.connections.length)];
                this.synapsePulses.push({
                    from: fromIdx,
                    to: toIdx,
                    progress: 0,
                    speed: 0.035 + totalEnergy * 0.06,
                    hue: 160 + Math.random() * 120 // Esmeralda -> Ciano -> Violeta
                });
            }
        }

        // 4. Renderizar Axônios / Filamentos Conectores
        ctx.save();
        for (let i = 0; i < nodeCount; i++) {
            const na = this.synapseNodes[i];
            na.connections.forEach(toIdx => {
                const nb = this.synapseNodes[toIdx];
                if (!nb) return;

                const connEnergy = (na.energy + nb.energy) * 0.5;
                const alpha = Math.min(0.85, 0.12 + connEnergy * 0.65);
                const strokeColor = connEnergy > 0.25 ? `hsla(185, 90%, 65%, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;

                ctx.beginPath();
                ctx.moveTo(na.x, na.y);
                ctx.lineTo(nb.x, nb.y);
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1 + connEnergy * 1.8;
                if (connEnergy > 0.3) {
                    ctx.shadowColor = '#38bdf8';
                    ctx.shadowBlur = 6;
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
            });
        }

        // 5. Renderizar Impulsos Sinápticos em Movimento
        for (let p = this.synapsePulses.length - 1; p >= 0; p--) {
            const pulse = this.synapsePulses[p];
            pulse.progress += pulse.speed;

            if (pulse.progress >= 1.0) {
                this.synapsePulses.splice(p, 1);
                continue;
            }

            const na = this.synapseNodes[pulse.from];
            const nb = this.synapseNodes[pulse.to];
            if (!na || !nb) continue;

            const px = na.x + (nb.x - na.x) * pulse.progress;
            const py = na.y + (nb.y - na.y) * pulse.progress;

            ctx.beginPath();
            ctx.arc(px, py, 2.2 + totalEnergy * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = `hsl(${pulse.hue}, 90%, 60%)`;
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 6. Renderizar Corpos Neuronais (Soma / Neurônios)
        this.synapseNodes.forEach(node => {
            const r = Math.max(2, node.baseSize + node.energy * 5);
            const hue = node.cluster === 0 ? 195 : (node.cluster === 1 ? 275 : 155);

            // Aura de neurotransmissor
            if (node.energy > 0.15) {
                const aura = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, r * 2.2);
                aura.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.7)`);
                aura.addColorStop(1, 'rgba(15, 23, 42, 0)');
                ctx.fillStyle = aura;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r * 2.2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Núcleo do neurônio
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.fillStyle = node.energy > 0.28 ? '#ffffff' : `hsl(${hue}, 85%, 65%)`;
            ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
            ctx.shadowBlur = 6 + node.energy * 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        ctx.restore();
    }

    /**
     * MODO 12: Radar Tático & Sonar Acústico (Tactical Sonar Sweep HUD)
     */
    drawSonar(dataArray, w, h) {
        const ctx = this.ctx;
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.min(w * 0.44, h * 0.46);

        const bassSum = (dataArray[0] + dataArray[1] + dataArray[2] + dataArray[3]) / (4 * 255);
        const midSum = (dataArray[8] + dataArray[12] + dataArray[16]) / (3 * 255);
        const totalEnergy = bassSum * 0.6 + midSum * 0.4;

        // Ângulo de varredura do sonar
        this.sonarAngle = (this.sonarAngle || 0) + 0.032 + (bassSum * 0.035);

        ctx.save();

        // 1. Eixos Cruzados e Retículo Tático
        ctx.beginPath();
        ctx.moveTo(cx - maxR - 10, cy);
        ctx.lineTo(cx + maxR + 10, cy);
        ctx.moveTo(cx, cy - maxR - 8);
        ctx.lineTo(cx, cy + maxR + 8);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Marcadores de escala (Ticks métricos)
        const ticks = 4;
        for (let t = 1; t <= ticks; t++) {
            const tr = (t / ticks) * maxR;
            ctx.beginPath();
            ctx.ellipse(cx, cy, tr, tr * 0.9, 0, 0, Math.PI * 2);
            ctx.strokeStyle = t === ticks ? 'rgba(52, 211, 153, 0.45)' : 'rgba(16, 185, 129, 0.15)';
            ctx.lineWidth = t === ticks ? 1.5 : 1;
            ctx.stroke();
        }

        // 2. Setor Fosfórico da Varredura (Trailing Phosphor Glow)
        const trailSpan = Math.PI * 0.38; // 68 graus de rastro
        const steps = 14;
        for (let s = 0; s < steps; s++) {
            const a1 = this.sonarAngle - (s / steps) * trailSpan;
            const a2 = this.sonarAngle - ((s + 1) / steps) * trailSpan;
            const alpha = (1 - s / steps) * (0.18 + totalEnergy * 0.18);

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, maxR, a2, a1);
            ctx.closePath();
            ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
            ctx.fill();
        }

        // 3. Raio Principal de Alta Potência (Sweep Beam Line)
        const beamX = cx + Math.cos(this.sonarAngle) * maxR;
        const beamY = cy + Math.sin(this.sonarAngle) * maxR;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(beamX, beamY);
        ctx.strokeStyle = '#6ee7b7';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 4. Forma de Onda Circular Acústica em Tempo Real (Radial Waveform)
        const wavePoints = 48;
        ctx.beginPath();
        for (let i = 0; i <= wavePoints; i++) {
            const angle = (i / wavePoints) * Math.PI * 2;
            const dataIdx = Math.floor((i / wavePoints) * (dataArray.length * 0.65));
            const freqVal = (dataArray[dataIdx] || 0) / 255;
            const waveR = maxR * 0.72 + freqVal * (maxR * 0.26);

            const wx = cx + Math.cos(angle) * waveR;
            const wy = cy + Math.sin(angle) * (waveR * 0.9);

            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(52, 211, 153, ${0.45 + totalEnergy * 0.45})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // 5. Contatos e Ecos de Alvo Acústico (Sonar Blips & Echo Rings)
        if (!this.sonarBlips) this.sonarBlips = [];
        if (totalEnergy > 0.14 && this.sonarBlips.length < 6 && Math.random() < 0.25) {
            const blipDist = 18 + Math.random() * (maxR * 0.85);
            this.sonarBlips.push({
                x: cx + Math.cos(this.sonarAngle) * blipDist,
                y: cy + Math.sin(this.sonarAngle) * (blipDist * 0.9),
                life: 1.0,
                maxRipple: 28 + totalEnergy * 20,
                rippleR: 0
            });
        }

        // Renderizar blips e ondas de eco
        for (let b = this.sonarBlips.length - 1; b >= 0; b--) {
            const blip = this.sonarBlips[b];
            blip.life -= 0.025;
            blip.rippleR += 1.4;

            if (blip.life <= 0 || blip.rippleR > blip.maxRipple) {
                this.sonarBlips.splice(b, 1);
                continue;
            }

            // Anel de eco em expansão
            ctx.beginPath();
            ctx.arc(blip.x, blip.y, blip.rippleR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(52, 211, 153, ${blip.life * 0.75})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Ponto de contato tático
            ctx.beginPath();
            ctx.arc(blip.x, blip.y, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#34d399';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 6. Núcleo Emissor Central (Transducer Hub)
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5 + totalEnergy * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#6ee7b7';
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
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
        this.electricSparks = [];
        this.pulsarShockwaves = [];
        this.synapsePulses = [];
        this.sonarBlips = [];
        this.updateAmbientGlow(0);
        if (this.onVuUpdate) this.onVuUpdate(0, -60);
    }
}
