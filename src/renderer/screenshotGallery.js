// screenshotGallery.js - Módulo de Visualização Rápida e Elegante de Prints do Meet Record

let activeScreenshots = [];
let currentIndex = 0;
let currentRec = null;
let isZoomed = false;
let objectUrlsToRevoke = [];
let keydownListenerAttached = false;

export async function openScreenshotGallery(rec) {
    if (!rec) return;
    currentRec = rec;

    const modal = document.getElementById('screenshotGalleryModal');
    if (!modal) return;

    // Show loading state
    showModalLoading(modal, rec);

    try {
        const folderName = rec.metadata?.folderName || '';
        const recPath = rec.path || '';

        const screenshots = await window.electronAPI.getRecordingScreenshots(folderName, recPath);
        
        // Clean up previous URLs
        cleanupObjectUrls();

        if (!screenshots || screenshots.length === 0) {
            renderEmptyState(modal, rec);
            return;
        }

        // Convert buffers to ObjectURLs
        activeScreenshots = screenshots.map(s => {
            const blob = new Blob([s.buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            objectUrlsToRevoke.push(url);
            return {
                ...s,
                url
            };
        });

        currentIndex = 0;
        isZoomed = false;

        renderGalleryUI(modal);
        attachKeyboardNav();
    } catch (err) {
        console.error("Erro ao carregar galeria de prints:", err);
        closeScreenshotGallery();
    }
}

export function closeScreenshotGallery() {
    const modal = document.getElementById('screenshotGalleryModal');
    if (modal) {
        modal.classList.add('hidden');
    }

    detachKeyboardNav();
    cleanupObjectUrls();
    activeScreenshots = [];
    currentRec = null;
    isZoomed = false;
}

function cleanupObjectUrls() {
    if (objectUrlsToRevoke.length > 0) {
        objectUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
        objectUrlsToRevoke = [];
    }
}

function showModalLoading(modal, rec) {
    modal.classList.remove('hidden');
    const title = getCleanRecordingTitle(rec);

    modal.innerHTML = `
        <div class="gallery-backdrop" id="galleryBackdrop">
            <div class="gallery-modal">
                <div class="gallery-header">
                    <div class="gallery-header-left">
                        <div class="gallery-icon-badge">📸</div>
                        <div class="gallery-title-wrapper">
                            <h3 class="gallery-title">${escapeHtml(title)}</h3>
                            <span class="gallery-subtitle">Buscando capturas de tela vinculadas...</span>
                        </div>
                    </div>
                    <button class="icon-btn gallery-close-btn" id="closeGalleryBtn" title="Fechar (Esc)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="gallery-loading-body">
                    <div class="loading-spinner"></div>
                    <p>Carregando imagens em alta definição...</p>
                </div>
            </div>
        </div>
    `;

    modal.querySelector('#closeGalleryBtn')?.addEventListener('click', closeScreenshotGallery);
    modal.querySelector('#galleryBackdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'galleryBackdrop') closeScreenshotGallery();
    });
}

function renderEmptyState(modal, rec) {
    const title = getCleanRecordingTitle(rec);
    modal.innerHTML = `
        <div class="gallery-backdrop" id="galleryBackdrop">
            <div class="gallery-modal">
                <div class="gallery-header">
                    <div class="gallery-header-left">
                        <div class="gallery-icon-badge">📸</div>
                        <div class="gallery-title-wrapper">
                            <h3 class="gallery-title">${escapeHtml(title)}</h3>
                            <span class="gallery-subtitle">0 capturas de tela encontradas</span>
                        </div>
                    </div>
                    <button class="icon-btn gallery-close-btn" id="closeGalleryBtn" title="Fechar (Esc)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="gallery-empty-body">
                    <div class="gallery-empty-icon">🖼️</div>
                    <h4>Nenhum print vinculado a esta reunião</h4>
                    <p>Você pode capturar prints durante gravações futuras usando o botão <strong>Print</strong> no Widget flutuante ou a tecla <strong>P</strong>.</p>
                </div>
            </div>
        </div>
    `;

    modal.querySelector('#closeGalleryBtn')?.addEventListener('click', closeScreenshotGallery);
    modal.querySelector('#galleryBackdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'galleryBackdrop') closeScreenshotGallery();
    });
}

function renderGalleryUI(modal) {
    const title = getCleanRecordingTitle(currentRec);
    const total = activeScreenshots.length;
    const current = activeScreenshots[currentIndex] || activeScreenshots[0];

    modal.innerHTML = `
        <div class="gallery-backdrop" id="galleryBackdrop">
            <div class="gallery-modal">
                <!-- Header -->
                <div class="gallery-header">
                    <div class="gallery-header-left">
                        <div class="gallery-icon-badge">📸</div>
                        <div class="gallery-title-wrapper">
                            <div class="gallery-title-row">
                                <h3 class="gallery-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                                <span class="gallery-badge-count" id="galleryCountBadge">${currentIndex + 1} de ${total}</span>
                            </div>
                            <span class="gallery-subtitle">${formatDate(currentRec.date || currentRec.metadata?.date)} • ${total} ${total === 1 ? 'imagem vinculada' : 'imagens vinculadas'}</span>
                        </div>
                    </div>
                    <div class="gallery-header-actions">
                        <button class="btn-action-gallery" id="galleryOpenFolderBtn" title="Abrir pasta de capturas no Explorer">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                            <span>Abrir Pasta</span>
                        </button>
                        <button class="icon-btn gallery-close-btn" id="closeGalleryBtn" title="Fechar visualizador (Esc)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                <!-- Main Hero Viewer -->
                <div class="gallery-viewport-container">
                    <button class="gallery-nav-btn prev-btn ${currentIndex === 0 ? 'disabled' : ''}" id="galleryPrevBtn" title="Imagem Anterior (Seta Esquerda)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>

                    <div class="gallery-image-wrapper ${isZoomed ? 'is-zoomed' : ''}" id="galleryImageWrapper" title="Duplo clique ou tecla Z para alternar zoom">
                        <img src="${current.url}" alt="${escapeHtml(current.name)}" class="gallery-hero-img" id="galleryHeroImg">
                    </div>

                    <button class="gallery-nav-btn next-btn ${currentIndex === total - 1 ? 'disabled' : ''}" id="galleryNextBtn" title="Próxima Imagem (Seta Direita)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>

                <!-- Meta & Tools Bar -->
                <div class="gallery-toolbar">
                    <div class="gallery-info-strip">
                        <span class="gallery-type-pill ${current.type === 'cover' ? 'type-cover' : 'type-manual'}">
                            ${current.type === 'cover' ? '🖼️ Capa da Reunião' : '📸 Captura Manual'}
                        </span>
                        <span class="gallery-info-item" id="galleryTimeLabel">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>${formatTimeFromDate(current.date)}</span>
                        </span>
                        <span class="gallery-info-item">
                            <span>${formatFileSize(current.size)}</span>
                        </span>
                    </div>

                    <div class="gallery-tools-actions">
                        <button class="gallery-tool-btn" id="galleryZoomBtn" title="Alternar Zoom (Z ou Espaço)">
                            <svg class="zoom-in-icon ${isZoomed ? 'hidden' : ''}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                            <svg class="zoom-out-icon ${isZoomed ? '' : 'hidden'}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                            <span id="galleryZoomLabel">${isZoomed ? 'Ajustar' : 'Zoom 100%'}</span>
                        </button>
                        <button class="gallery-tool-btn" id="galleryOpenFileBtn" title="Abrir imagem no aplicativo padrão do Windows">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span>Abrir Imagem</span>
                        </button>
                    </div>
                </div>

                <!-- Filmstrip (Thumbnails carousel) -->
                <div class="gallery-filmstrip-wrapper">
                    <div class="gallery-filmstrip" id="galleryFilmstrip">
                        ${renderFilmstripThumbnails()}
                    </div>
                </div>

                <!-- Shortcuts Legend Footer -->
                <div class="gallery-footer-hints">
                    <span>💡 <strong>← / →</strong> Navegar entre prints</span>
                    <span>&bull;</span>
                    <span><strong>Z / Espaço</strong> Alternar zoom</span>
                    <span>&bull;</span>
                    <span><strong>Esc</strong> Fechar</span>
                </div>
            </div>
        </div>
    `;

    // Event handlers
    setupGalleryEventListeners(modal);
}

function renderFilmstripThumbnails() {
    return activeScreenshots.map((item, idx) => {
        const isActive = idx === currentIndex;
        const isCover = item.type === 'cover';
        return `
            <div class="filmstrip-thumb-item ${isActive ? 'active' : ''}" data-index="${idx}" title="${isCover ? 'Capa' : 'Print manual'} - ${formatTimeFromDate(item.date)}">
                <img src="${item.url}" alt="Thumbnail ${idx + 1}">
                <div class="filmstrip-thumb-overlay">
                    <span class="filmstrip-badge">${isCover ? 'Capa' : `#${idx + 1}`}</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateHeroView() {
    const total = activeScreenshots.length;
    const current = activeScreenshots[currentIndex];
    if (!current) return;

    const heroImg = document.getElementById('galleryHeroImg');
    const countBadge = document.getElementById('galleryCountBadge');
    const prevBtn = document.getElementById('galleryPrevBtn');
    const nextBtn = document.getElementById('galleryNextBtn');
    const timeLabel = document.getElementById('galleryTimeLabel');
    const typePill = document.querySelector('.gallery-type-pill');
    const imgWrapper = document.getElementById('galleryImageWrapper');

    if (heroImg) {
        heroImg.style.opacity = '0';
        setTimeout(() => {
            heroImg.src = current.url;
            heroImg.style.opacity = '1';
        }, 80);
    }

    if (countBadge) countBadge.textContent = `${currentIndex + 1} de ${total}`;
    if (prevBtn) prevBtn.classList.toggle('disabled', currentIndex === 0);
    if (nextBtn) nextBtn.classList.toggle('disabled', currentIndex === total - 1);

    if (timeLabel) {
        timeLabel.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${formatTimeFromDate(current.date)}</span>
        `;
    }

    if (typePill) {
        typePill.className = `gallery-type-pill ${current.type === 'cover' ? 'type-cover' : 'type-manual'}`;
        typePill.textContent = current.type === 'cover' ? '🖼️ Capa da Reunião' : '📸 Captura Manual';
    }

    // Reset zoom on slide change
    if (isZoomed && imgWrapper) {
        toggleZoom(false);
    }

    // Update filmstrip active state & scroll into view
    const thumbs = document.querySelectorAll('.filmstrip-thumb-item');
    thumbs.forEach((th, idx) => {
        const isNowActive = idx === currentIndex;
        th.classList.toggle('active', isNowActive);
        if (isNowActive) {
            th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    });
}

function setupGalleryEventListeners(modal) {
    modal.querySelector('#closeGalleryBtn')?.addEventListener('click', closeScreenshotGallery);
    modal.querySelector('#galleryBackdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'galleryBackdrop') closeScreenshotGallery();
    });

    const prevBtn = modal.querySelector('#galleryPrevBtn');
    const nextBtn = modal.querySelector('#galleryNextBtn');

    prevBtn?.addEventListener('click', () => navigateImage(-1));
    nextBtn?.addEventListener('click', () => navigateImage(1));

    // Filmstrip clicks
    const filmstrip = modal.querySelector('#galleryFilmstrip');
    filmstrip?.addEventListener('click', (e) => {
        const item = e.target.closest('.filmstrip-thumb-item');
        if (item) {
            const idx = parseInt(item.getAttribute('data-index'), 10);
            if (!isNaN(idx) && idx !== currentIndex) {
                currentIndex = idx;
                updateHeroView();
            }
        }
    });

    // Double click to toggle zoom
    const imgWrapper = modal.querySelector('#galleryImageWrapper');
    imgWrapper?.addEventListener('dblclick', () => {
        toggleZoom();
    });

    // Zoom Button
    const zoomBtn = modal.querySelector('#galleryZoomBtn');
    zoomBtn?.addEventListener('click', () => {
        toggleZoom();
    });

    // Open File Button (Windows default viewer)
    const openFileBtn = modal.querySelector('#galleryOpenFileBtn');
    openFileBtn?.addEventListener('click', () => {
        const current = activeScreenshots[currentIndex];
        if (current && current.path) {
            window.electronAPI.openFile(current.path);
        }
    });

    // Open Folder in Explorer
    const openFolderBtn = modal.querySelector('#galleryOpenFolderBtn');
    openFolderBtn?.addEventListener('click', () => {
        const current = activeScreenshots[currentIndex];
        if (current && current.path) {
            window.electronAPI.openFileLocation(current.path);
        } else if (currentRec && currentRec.path) {
            window.electronAPI.openFileLocation(currentRec.path);
        }
    });
}

function navigateImage(delta) {
    const newIdx = currentIndex + delta;
    if (newIdx >= 0 && newIdx < activeScreenshots.length) {
        currentIndex = newIdx;
        updateHeroView();
    }
}

function toggleZoom(forceState) {
    const imgWrapper = document.getElementById('galleryImageWrapper');
    const zoomLabel = document.getElementById('galleryZoomLabel');
    const zoomInIcon = document.querySelector('.zoom-in-icon');
    const zoomOutIcon = document.querySelector('.zoom-out-icon');

    isZoomed = forceState !== undefined ? forceState : !isZoomed;

    if (imgWrapper) {
        imgWrapper.classList.toggle('is-zoomed', isZoomed);
    }
    if (zoomLabel) {
        zoomLabel.textContent = isZoomed ? 'Ajustar' : 'Zoom 100%';
    }
    if (zoomInIcon) zoomInIcon.classList.toggle('hidden', isZoomed);
    if (zoomOutIcon) zoomOutIcon.classList.toggle('hidden', !isZoomed);
}

function handleGalleryKeydown(e) {
    const modal = document.getElementById('screenshotGalleryModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        closeScreenshotGallery();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateImage(-1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateImage(1);
    } else if (e.key.toLowerCase() === 'z' || e.code === 'Space') {
        e.preventDefault();
        toggleZoom();
    }
}

function attachKeyboardNav() {
    if (!keydownListenerAttached) {
        window.addEventListener('keydown', handleGalleryKeydown);
        keydownListenerAttached = true;
    }
}

function detachKeyboardNav() {
    if (keydownListenerAttached) {
        window.removeEventListener('keydown', handleGalleryKeydown);
        keydownListenerAttached = false;
    }
}

// Helpers
function getCleanRecordingTitle(rec) {
    if (!rec) return 'Reunião';
    if (rec.metadata && rec.metadata.title && rec.metadata.title.trim() !== '') {
        return rec.metadata.title;
    }
    const nameWithoutExt = rec.name ? rec.name.replace(/\.[^/.]+$/, '') : 'Reunião';
    return nameWithoutExt
        .replace(/^\d{4}-\d{2}-\d{2}[_T-]?\d{0,6}[_-]?/, '')
        .replace(/^\d{8}_\d{4,6}[_-]?/, '')
        .replace(/_/g, ' ')
        .trim() || 'Reunião';
}

function formatDate(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTimeFromDate(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
