/**
 * VideoCompositor - Engine de Composição e Efeitos Visuais em Tempo Real para Meet Record
 * Responsável por renderizar Cursor Spotlight, Click Ripples e Privacy Blur Shield em 60 FPS.
 */

export class VideoCompositor {
    constructor(options = {}) {
        this.options = {
            cursorSpotlight: options.cursorSpotlight !== undefined ? options.cursorSpotlight : true,
            clickRipples: options.clickRipples !== undefined ? options.clickRipples : true,
            privacyBlur: options.privacyBlur !== undefined ? options.privacyBlur : false,
            performanceProfile: options.performanceProfile || 'balanced', // 'ultra' | 'balanced' | 'eco'
            ...options
        };

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
        
        this.videoElement = document.createElement('video');
        this.videoElement.autoplay = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;

        // Estado do Cursor
        this.cursor = {
            x: 0,
            y: 0,
            targetX: 0,
            targetY: 0,
            visible: false,
            lastMoved: 0
        };

        // Ondas de clique ativas
        this.ripples = [];

        // Zonas de privacidade [{x, y, w, h}] normalizadas (0 a 1) ou absolutas
        this.privacyZones = [];

        this.isRunning = false;
        this.animationFrameId = null;
        this.outputStream = null;
    }

    /**
     * Inicia a composição a partir de um videoTrack bruto do desktopCapturer
     */
    async start(rawVideoTrack) {
        if (!rawVideoTrack || rawVideoTrack.readyState !== 'live') {
            throw new Error("Faixa de vídeo inválida para o compositor.");
        }

        this.rawTrack = rawVideoTrack;
        const mediaStream = new MediaStream([rawVideoTrack]);
        this.videoElement.srcObject = mediaStream;

        await new Promise((resolve) => {
            if (this.videoElement.readyState >= 2) {
                resolve();
            } else {
                this.videoElement.onloadeddata = () => resolve();
            }
        });

        await this.videoElement.play();

        const videoWidth = this.videoElement.videoWidth || 1920;
        const videoHeight = this.videoElement.videoHeight || 1080;

        this.canvas.width = videoWidth;
        this.canvas.height = videoHeight;
        this.width = videoWidth;
        this.height = videoHeight;

        // Configuração de FPS baseado no perfil
        let targetFps = 60;
        if (this.options.performanceProfile === 'eco') {
            targetFps = 30;
        }

        this.isRunning = true;
        this.renderLoop();

        this.outputStream = this.canvas.captureStream(targetFps);
        const [composedTrack] = this.outputStream.getVideoTracks();

        return {
            composedTrack,
            outputStream: this.outputStream
        };
    }

    updateOptions(newOptions) {
        this.options = { ...this.options, ...newOptions };
    }

    setCursorPosition(normalizedX, normalizedY) {
        this.cursor.targetX = normalizedX * this.width;
        this.cursor.targetY = normalizedY * this.height;
        this.cursor.visible = true;
        this.cursor.lastMoved = Date.now();
    }

    addClick(normalizedX, normalizedY, buttonType = 'left') {
        if (!this.options.clickRipples) return;
        const x = normalizedX * this.width;
        const y = normalizedY * this.height;
        const color = buttonType === 'right' ? '#f59e0b' : '#38bdf8'; // Laranja para botão direito, Ciano para esquerdo

        this.ripples.push({
            x,
            y,
            radius: 4,
            maxRadius: this.options.performanceProfile === 'ultra' ? 48 : 36,
            alpha: 0.9,
            color,
            speed: this.options.performanceProfile === 'ultra' ? 2.5 : 2.0
        });
    }

    setPrivacyZones(zones) {
        this.privacyZones = zones || [];
    }

    renderLoop() {
        if (!this.isRunning) return;

        this.drawFrame();
        this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
    }

    drawFrame() {
        const ctx = this.ctx;
        if (!ctx || !this.videoElement || this.videoElement.paused || this.videoElement.ended) return;

        const w = this.width;
        const h = this.height;

        // 1. Renderiza o frame original de vídeo
        ctx.drawImage(this.videoElement, 0, 0, w, h);

        // 2. Aplica Privacy Redaction Blur se configurado
        if (this.options.privacyBlur && this.privacyZones.length > 0) {
            this.drawPrivacyZones(ctx, w, h);
        }

        // 3. Renderiza Click Ripples
        if (this.options.clickRipples && this.ripples.length > 0) {
            this.drawRipples(ctx);
        }

        // 4. Renderiza Cursor Spotlight
        if (this.options.cursorSpotlight && this.cursor.visible) {
            this.drawCursorSpotlight(ctx);
        }
    }

    drawPrivacyZones(ctx, w, h) {
        ctx.save();
        for (const zone of this.privacyZones) {
            const zx = zone.normalized ? zone.x * w : zone.x;
            const zy = zone.normalized ? zone.y * h : zone.y;
            const zw = zone.normalized ? zone.w * w : zone.w;
            const zh = zone.normalized ? zone.h * h : zone.h;

            ctx.save();
            ctx.beginPath();
            ctx.rect(zx, zy, zw, zh);
            ctx.clip();
            ctx.filter = 'blur(16px)';
            ctx.drawImage(this.videoElement, 0, 0, w, h);
            
            // Desenhar borda de segurança translúcida
            ctx.filter = 'none';
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
            ctx.lineWidth = 2;
            ctx.strokeRect(zx, zy, zw, zh);
            ctx.restore();
        }
        ctx.restore();
    }

    drawCursorSpotlight(ctx) {
        // Interpolação suave (lerp)
        const lerpFactor = this.options.performanceProfile === 'ultra' ? 0.35 : 0.25;
        this.cursor.x += (this.cursor.targetX - this.cursor.x) * lerpFactor;
        this.cursor.y += (this.cursor.targetY - this.cursor.y) * lerpFactor;

        // Ocultar se inativo por mais de 3 segundos
        if (Date.now() - this.cursor.lastMoved > 3000) {
            return;
        }

        const cx = this.cursor.x;
        const cy = this.cursor.y;
        const radius = this.options.performanceProfile === 'ultra' ? 42 : 32;

        const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
        gradient.addColorStop(0.6, 'rgba(129, 140, 248, 0.15)');
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Anel sutil central
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    drawRipples(ctx) {
        ctx.save();
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.radius += r.speed;
            r.alpha -= 0.025;

            if (r.alpha <= 0 || r.radius >= r.maxRadius) {
                this.ripples.splice(i, 1);
                continue;
            }

            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.strokeStyle = r.color.replace(')', `, ${r.alpha})`).replace('rgb', 'rgba').replace('#38bdf8', `rgba(56, 189, 248, ${r.alpha})`).replace('#f59e0b', `rgba(245, 158, 11, ${r.alpha})`);
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.srcObject = null;
        }

        if (this.outputStream) {
            this.outputStream.getTracks().forEach(track => track.stop());
            this.outputStream = null;
        }

        this.ripples = [];
    }
}
