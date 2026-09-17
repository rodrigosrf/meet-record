import { getTagColor, openTagEditorModal } from './tagEditor.js';
import { getCurrentlyPlayingPath, getPlaybackState, togglePlayPauseAudio, updatePlayingTrackPath } from './audioPlayer.js';
import { openScreenshotGallery } from './screenshotGallery.js';

let allVideos = [];
export function getAllVideos() { return allVideos; }
let tagCategories = [];
let searchQuery = '';
let tagFilterQuery = 'all';

let currentCallbacks = {
    onOpenRecording: null,
    onDeleteRecording: null,
    onOpenTagEditor: null
};

let tooltipEl = null;
let tooltipTimeout = null;
let currentHoveredWrapper = null;
let marqueeResizeObserver = null;

export async function initLibraryManager(callbacks = {}) {
    currentCallbacks = { ...currentCallbacks, ...callbacks };

    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderLibraryUI(currentCallbacks, true);
        });
    }

    const libraryContent = document.getElementById('libraryContent');
    if (libraryContent) {
        libraryContent.addEventListener('mouseover', (e) => {
            const wrapper = e.target.closest('.lib-item-title-wrapper');
            if (wrapper && libraryContent.contains(wrapper)) {
                if (wrapper.classList.contains('is-editing')) return;
                if (currentHoveredWrapper !== wrapper) {
                    currentHoveredWrapper = wrapper;
                    clearTimeout(tooltipTimeout);
                    tooltipTimeout = setTimeout(() => {
                        if (currentHoveredWrapper === wrapper) {
                            showCustomTooltip(wrapper);
                        }
                    }, 100);
                }
            }
        });

        libraryContent.addEventListener('mouseout', (e) => {
            const wrapper = e.target.closest('.lib-item-title-wrapper');
            if (wrapper) {
                const related = e.relatedTarget;
                if (!related || !wrapper.contains(related)) {
                    hideCustomTooltip();
                }
            }
        });

        libraryContent.addEventListener('scroll', () => {
            hideCustomTooltip();
        }, { passive: true });

        if (!marqueeResizeObserver && window.ResizeObserver) {
            marqueeResizeObserver = new ResizeObserver(() => {
                updateTitleMarquees();
            });
            marqueeResizeObserver.observe(libraryContent);
        }
    }
}

export async function renderLibraryUI(callbacks = {}, skipFetch = false) {
    if (callbacks && Object.keys(callbacks).length > 0) {
        currentCallbacks = { ...currentCallbacks, ...callbacks };
    }

    const libraryContent = document.getElementById('libraryContent');
    if (!libraryContent) return;

    hideCustomTooltip();

    if (!skipFetch) {
        libraryContent.innerHTML = `
            <div class="library-loading">
                <div class="loading-spinner"></div>
                <p>Buscando gravações...</p>
            </div>
        `;
        allVideos = await window.electronAPI.getLibraryVideos();
        tagCategories = await window.electronAPI.getTagCategories();
        updateTagFilterBar();
    }

    const countBadge = document.getElementById('libraryCountBadge');
    if (countBadge) {
        countBadge.textContent = `${allVideos.length} ${allVideos.length === 1 ? 'gravação' : 'gravações'}`;
    }

    if (allVideos.length === 0) {
        libraryContent.innerHTML = `
            <div class="library-empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
                <h4>Nenhuma gravação encontrada</h4>
                <p>Suas reuniões gravadas aparecerão aqui automaticamente.</p>
            </div>
        `;
        return;
    }

    let filtered = allVideos.filter(rec => {
        const cleanTitle = getCleanRecordingTitle(rec).toLowerCase();
        const rawName = (rec.name || '').toLowerCase();
        const note = (rec.metadata?.note || '').toLowerCase();
        const tags = (rec.metadata?.tags || []).join(' ').toLowerCase();
        return cleanTitle.includes(searchQuery) || rawName.includes(searchQuery) || note.includes(searchQuery) || tags.includes(searchQuery);
    });

    if (tagFilterQuery === 'favorites') {
        filtered = filtered.filter(rec => rec.metadata && rec.metadata.favorite === true);
    } else if (tagFilterQuery && tagFilterQuery !== 'all') {
        filtered = filtered.filter(rec => rec.metadata && Array.isArray(rec.metadata.tags) && rec.metadata.tags.includes(tagFilterQuery));
    }

    if (filtered.length === 0) {
        const isFavFilter = tagFilterQuery === 'favorites';
        libraryContent.innerHTML = `
            <div class="library-empty-state">
                <span style="font-size: 2.5rem;">${isFavFilter ? '⭐' : '🔍'}</span>
                <h4>${isFavFilter ? 'Nenhuma gravação favoritada' : 'Nenhum resultado encontrado'}</h4>
                <p>${isFavFilter ? 'Clique na estrela de uma gravação para marcá-la como favorita.' : 'Tente buscar com outro termo ou filtro de tag.'}</p>
            </div>
        `;
        return;
    }

    const groups = groupVideosByDate(filtered);
    libraryContent.innerHTML = '';

    const currentPlaying = getCurrentlyPlayingPath();
    const playbackState = getPlaybackState();

    for (const dateLabel of Object.keys(groups)) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'date-group-header';
        groupHeader.innerHTML = `<span>${dateLabel}</span><span class="group-count">${groups[dateLabel].length}</span>`;
        libraryContent.appendChild(groupHeader);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'date-group';

        for (const [index, rec] of groups[dateLabel].entries()) {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.setAttribute('data-rec-path', rec.path);
            
            const recDate = rec.metadata?.date ? new Date(rec.metadata.date) : (rec.date ? new Date(rec.date) : new Date());
            const isValidDate = !isNaN(recDate.getTime());
            const dateFormatted = isValidDate
                ? recDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : '';
            const timeFormatted = isValidDate
                ? recDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '';

            const order = groups[dateLabel].length - index;

            let thumbnailImgHtml = `
                <div class="no-thumb">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                </div>
            `;

            if (rec.metadata && rec.metadata.folderName) {
                const thumbResult = await window.electronAPI.getRecordingThumbnail(rec.metadata.folderName, rec.path);
                if (thumbResult && thumbResult.success) {
                    const blob = new Blob([thumbResult.buffer], { type: 'image/jpeg' });
                    const thumbUrl = URL.createObjectURL(blob);
                    thumbnailImgHtml = `<img src="${thumbUrl}" alt="Thumbnail da Reunião">`;
                }
            }

            const isVideo = rec.path.endsWith('.webm');
            const buttonText = isVideo ? 'Assistir' : 'Ouvir';
            const badgeText = isVideo ? 'WEBM' : 'MP3';
            const isFav = !!(rec.metadata && rec.metadata.favorite);
            const tags = (rec.metadata && Array.isArray(rec.metadata.tags)) ? rec.metadata.tags : [];
            const durationStr = formatDuration(rec.metadata?.duration);
            const sizeStr = formatFileSize(rec.size);
            const screenshotCount = (rec.metadata && typeof rec.metadata.screenshotCount === 'number') ? rec.metadata.screenshotCount : 0;

            const isThisPlaying = (currentPlaying === rec.path && playbackState === 'playing');
            const isThisPaused = (currentPlaying === rec.path && playbackState === 'paused');

            const cleanTitle = getCleanRecordingTitle(rec);

            item.innerHTML = `
                <div class="lib-item-thumbnail" data-action="play-card" title="Clique para ${buttonText.toLowerCase()}">
                    ${thumbnailImgHtml}
                    ${screenshotCount > 0 ? `
                        <div class="lib-item-print-pill" data-action="view-prints" title="${screenshotCount} ${screenshotCount === 1 ? 'captura vinculada' : 'capturas vinculadas'} (Clique para consultar)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                            <span>${screenshotCount}</span>
                        </div>
                    ` : ''}
                    <div class="thumb-play-overlay">
                        <div class="thumb-play-circle ${isThisPlaying ? 'is-playing' : ''}">
                            ${isThisPlaying ? `
                                <span class="playing-bars mini"><span></span><span></span><span></span></span>
                                <svg class="pause-hover-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
                            ` : `
                                <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 5 19 12 7 19 7 5"></polygon></svg>
                            `}
                        </div>
                    </div>
                </div>

                <div class="lib-item-top-actions">
                    <button class="lib-item-fav-btn ${isFav ? 'is-fav' : ''}" data-action="toggle-fav" title="${isFav ? 'Remover dos favoritos' : 'Favoritar gravação'}">
                        <svg class="star-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                    <button class="lib-item-delete" data-action="delete" title="Excluir Gravação">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>

                <div class="lib-item-order">${order}</div>

                <div class="lib-item-info">
                    <div class="lib-item-title-wrapper" 
                         data-tooltip-title="${escapeHtml(cleanTitle)}" 
                         data-raw-name="${escapeHtml(rec.name)}"
                         data-format="${escapeHtml(badgeText)}"
                         data-duration="${escapeHtml(durationStr)}"
                         data-size="${escapeHtml(sizeStr)}">
                        <div class="lib-item-title-track">
                            <h4 class="lib-item-title">${escapeHtml(cleanTitle)}</h4>
                        </div>
                        <button class="lib-item-edit-title-btn" data-action="edit-title" title="Renomear gravação (ou clique duplo)">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="lib-item-meta-row">
                        <div class="lib-item-datetime">
                            ${dateFormatted ? `
                                <span class="lib-item-date" title="Data da gravação">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                    <span>${dateFormatted}</span>
                                </span>
                            ` : ''}
                            ${dateFormatted && timeFormatted ? `<span class="lib-item-dot">•</span>` : ''}
                            ${timeFormatted ? `
                                <span class="lib-item-time" title="Horário da gravação">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                    <span>${timeFormatted}</span>
                                </span>
                            ` : ''}
                        </div>
                        ${durationStr ? `
                            <span class="lib-item-duration" title="Tempo total da gravação: ${durationStr}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="13" r="8"></circle>
                                    <line x1="12" y1="9" x2="12" y2="13"></line>
                                    <line x1="12" y1="13" x2="15" y2="15"></line>
                                    <line x1="10" y1="2" x2="14" y2="2"></line>
                                    <line x1="12" y1="2" x2="12" y2="5"></line>
                                    <line x1="12" y1="2" x2="12" y2="5"></line>
                                </svg>
                                <span>${durationStr}</span>
                            </span>
                        ` : ''}
                        ${sizeStr ? `<span class="lib-item-size" title="Tamanho do arquivo">${sizeStr}</span>` : ''}
                    </div>

                    ${rec.metadata && rec.metadata.note ? `<p class="lib-item-notes">${rec.metadata.note}</p>` : ''}
                    
                    <div class="lib-item-tags">
                        ${renderTagBadges(tags)}
                        <button class="tag-badge-add-btn" data-action="add-tag" title="Adicionar tags">+ Tag</button>
                    </div>
                </div>

                <div class="lib-item-actions">
                    <div class="lib-item-actions-left">
                        ${screenshotCount > 0 ? `
                            <button class="btn-action-prints" data-action="view-prints" title="Consultar ${screenshotCount} capturas desta reunião">
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                <span>Prints (${screenshotCount})</span>
                            </button>
                        ` : ''}
                        <button class="btn-small btn-folder-explorer" data-action="open-folder" title="Abrir pasta no Explorer">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                    </div>

                    <div class="lib-item-actions-right">
                        <span class="badge badge-format badge-success">${badgeText}</span>
                    </div>
                </div>
            `;

            // Setup Event Listeners for this card
            const playHandler = () => {
                const playingPath = getCurrentlyPlayingPath();
                if (playingPath === rec.path && !isVideo) {
                    togglePlayPauseAudio();
                } else if (currentCallbacks.onOpenRecording) {
                    currentCallbacks.onOpenRecording(rec.path);
                }
            };

            item.querySelector('[data-action="play-card"]')?.addEventListener('click', playHandler);

            item.querySelector('[data-action="open-folder"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                window.electronAPI.openFileLocation(rec.path);
            });

            item.querySelectorAll('[data-action="view-prints"]').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openScreenshotGallery(rec);
                });
            });

            item.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentCallbacks.onDeleteRecording) {
                    currentCallbacks.onDeleteRecording(rec.path);
                }
            });

            const openTagEditorHandler = (e) => {
                e.stopPropagation();
                const allKnown = getAllKnownTags();
                openTagEditorModal(rec.path, tags, isFav, {
                    existingTags: allKnown,
                    onSaveSuccess: (updatedData) => {
                        if (rec.metadata) {
                            rec.metadata.tags = updatedData.tags;
                            rec.metadata.favorite = updatedData.favorite;
                        }
                        renderLibraryUI(currentCallbacks, true);
                    }
                });
            };

            item.querySelector('[data-action="add-tag"]')?.addEventListener('click', openTagEditorHandler);

            // Favorite Toggle Handler
            const favBtn = item.querySelector('[data-action="toggle-fav"]');
            if (favBtn) {
                favBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const newFavState = !(rec.metadata && rec.metadata.favorite);
                    if (!rec.metadata) rec.metadata = {};
                    rec.metadata.favorite = newFavState;

                    // Immediate UI update
                    favBtn.classList.toggle('is-fav', newFavState);
                    const starSvg = favBtn.querySelector('.star-icon');
                    if (starSvg) {
                        starSvg.setAttribute('fill', newFavState ? 'currentColor' : 'none');
                    }
                    favBtn.classList.add('pop-anim');
                    setTimeout(() => favBtn.classList.remove('pop-anim'), 300);

                    // Persist to backend
                    await window.electronAPI.updateRecordingTags({
                        filePath: rec.path,
                        favorite: newFavState
                    });

                    // If filtered by favorites and unfavorited, remove smoothly
                    if (tagFilterQuery === 'favorites' && !newFavState) {
                        item.style.opacity = '0';
                        item.style.transform = 'scale(0.95)';
                        setTimeout(() => renderLibraryUI(currentCallbacks, true), 250);
                    }
                });
            }

            // Setup Title Editing (Inline edit & dblclick)
            setupTitleEditHandlers(item, rec);

            groupContainer.appendChild(item);
        }
        libraryContent.appendChild(groupContainer);
    }

    requestAnimationFrame(() => {
        updateTitleMarquees();
    });
}

export function updateLibraryPlayingState(activePath, state) {
    const items = document.querySelectorAll('.library-item');
    items.forEach(item => {
        const itemPath = item.getAttribute('data-rec-path');
        const playThumb = item.querySelector('.thumb-play-circle');
        const isMatch = (itemPath === activePath);

        const isPlaying = isMatch && (state === 'playing');
        const isPaused = isMatch && (state === 'paused');

        item.classList.toggle('is-playing-card', isPlaying);

        if (playThumb) {
            playThumb.classList.toggle('is-playing', isPlaying);
            playThumb.classList.toggle('is-paused', isPaused);
            if (isPlaying) {
                playThumb.innerHTML = `
                    <span class="playing-bars mini"><span></span><span></span><span></span></span>
                    <svg class="pause-hover-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
                `;
                playThumb.title = 'Pausar reprodução';
            } else if (isPaused) {
                playThumb.innerHTML = '<svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 5 19 12 7 19 7 5"></polygon></svg>';
                playThumb.title = 'Continuar reprodução';
            } else {
                playThumb.innerHTML = '<svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 5 19 12 7 19 7 5"></polygon></svg>';
                playThumb.title = 'Clique para reproduzir';
            }
        }
    });
}

function updateTagFilterBar() {
    const filterBar = document.getElementById('tagFilterBar');
    if (!filterBar) return;

    const existingChips = filterBar.querySelectorAll('.tag-filter-chip');
    existingChips.forEach(chip => {
        if (chip.dataset.filter !== 'all' && chip.dataset.filter !== 'favorites') {
            chip.remove();
        }
    });

    const addedTags = new Set(['all', 'favorites']);

    // 1. Tags from categories in settings
    for (const cat of tagCategories) {
        for (const tag of (cat.tags || [])) {
            if (!addedTags.has(tag)) {
                addedTags.add(tag);
                createFilterChip(filterBar, tag, cat.color);
            }
        }
    }

    // 2. Tags from existing recordings
    const allKnown = getAllKnownTags();
    for (const tag of allKnown) {
        if (!addedTags.has(tag)) {
            addedTags.add(tag);
            createFilterChip(filterBar, tag, getTagColor(tag, tagCategories));
        }
    }

    // Re-attach active listeners
    filterBar.querySelectorAll('.tag-filter-chip').forEach(chip => {
        chip.onclick = () => {
            filterBar.querySelectorAll('.tag-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            tagFilterQuery = chip.dataset.filter;
            renderLibraryUI(currentCallbacks, true);
        };
    });
}

function createFilterChip(filterBar, tag, color) {
    const chip = document.createElement('div');
    chip.className = 'tag-filter-chip';
    chip.dataset.filter = tag;
    chip.textContent = `#${tag}`;
    if (color) {
        chip.style.setProperty('--chip-color', color);
        chip.style.borderColor = `${color}44`;
    }
    filterBar.appendChild(chip);
}

function getAllKnownTags() {
    const tagSet = new Set();
    allVideos.forEach(v => {
        if (v.metadata && Array.isArray(v.metadata.tags)) {
            v.metadata.tags.forEach(t => {
                if (t && typeof t === 'string') tagSet.add(t.trim());
            });
        }
    });
    return Array.from(tagSet);
}

function formatDuration(durationMs) {
    if (!durationMs || isNaN(durationMs)) return '';
    const totalSeconds = Math.floor(durationMs / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) {
        return `${h}h ${m.toString().padStart(2, '0')}m`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function groupVideosByDate(videos) {
    const groups = {};
    const today = new Date().setHours(0,0,0,0);
    const yesterday = new Date(today - 86400000).getTime();
    
    videos.forEach(video => {
        const videoDate = new Date(video.date);
        const videoDay = new Date(video.date).setHours(0,0,0,0);
        
        let label = '';
        if (videoDay === today) label = 'Hoje';
        else if (videoDay === yesterday) label = 'Ontem';
        else {
            label = videoDate.toLocaleDateString('pt-BR', { 
                day: '2-digit', month: 'long' 
            });
        }
        
        if (!groups[label]) groups[label] = [];
        groups[label].push(video);
    });
    
    return groups;
}

function renderTagBadges(tags) {
    if (!tags || tags.length === 0) return '';
    return tags.map(t => {
        const color = getTagColor(t, tagCategories);
        return `<span class="tag-badge" style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}55;">#${t}</span>`;
    }).join('');
}

export function getCleanRecordingTitle(rec) {
    if (!rec) return 'Gravação';

    // 1. Priorizar título dos metadados se existir e for significativo
    if (rec.metadata && rec.metadata.title && typeof rec.metadata.title === 'string') {
        const rawMetaTitle = rec.metadata.title.trim();
        if (rawMetaTitle && rawMetaTitle !== 'Sem_Titulo' && rawMetaTitle !== 'Sem Título') {
            let t = rawMetaTitle.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
            // Remover carimbo numérico no início se houver
            t = t.replace(/^(\d{8}_\d{4,6}|\d{4}-\d{2}-\d{2}[_T]\d{2}[-:]?\d{2}(?:[-:]?\d{2})?)_?/, '').trim();
            if (t.length > 0) return t;
        }
    }

    // 2. Extrair e limpar a partir do nome do arquivo físico
    let name = (rec.name || '').replace(/\.(mp3|webm|wav|m4a|ogg)$/i, '');
    // Remover prefixo de timestamp (ex: 20260826_2253_, 20260826_225340_, 2026-08-26_2253_, epoch)
    name = name.replace(/^(\d{8}_\d{4,6}|\d{4}-\d{2}-\d{2}[_T-]?\d{0,6}|\d{13,14})_?/, '');
    name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

    return name || 'Gravação';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getOrCreateTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.getElementById('libTitleTooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'libTitleTooltip';
            tooltipEl.className = 'lib-custom-tooltip';
            tooltipEl.setAttribute('aria-hidden', 'true');
            tooltipEl.innerHTML = `
                <div class="lib-tooltip-header">
                    <svg class="lib-tooltip-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="22"></line>
                    </svg>
                    <span class="lib-tooltip-title"></span>
                </div>
                <div class="lib-tooltip-file-row">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    <span class="lib-tooltip-file"></span>
                </div>
                <div class="lib-tooltip-meta">
                    <span class="lib-tooltip-badge"></span>
                    <span class="lib-tooltip-duration"></span>
                    <span class="lib-tooltip-size"></span>
                </div>
            `;
            document.body.appendChild(tooltipEl);
        }
    }
    return tooltipEl;
}

function showCustomTooltip(target) {
    const tooltip = getOrCreateTooltip();
    const title = target.getAttribute('data-tooltip-title') || '';
    const rawFile = target.getAttribute('data-raw-name') || '';
    const format = target.getAttribute('data-format') || '';
    const duration = target.getAttribute('data-duration') || '';
    const size = target.getAttribute('data-size') || '';

    if (!title) return;

    tooltip.querySelector('.lib-tooltip-title').textContent = title;
    
    const fileSpan = tooltip.querySelector('.lib-tooltip-file');
    const fileRow = tooltip.querySelector('.lib-tooltip-file-row');
    if (rawFile) {
        fileSpan.textContent = rawFile;
        fileRow.style.display = 'flex';
    } else {
        fileRow.style.display = 'none';
    }

    const badgeEl = tooltip.querySelector('.lib-tooltip-badge');
    if (format) {
        badgeEl.textContent = format;
        badgeEl.style.display = 'inline-flex';
    } else {
        badgeEl.style.display = 'none';
    }

    const durationEl = tooltip.querySelector('.lib-tooltip-duration');
    if (duration) {
        durationEl.textContent = `⏱ ${duration}`;
        durationEl.style.display = 'inline-flex';
    } else {
        durationEl.style.display = 'none';
    }

    const sizeEl = tooltip.querySelector('.lib-tooltip-size');
    if (size) {
        sizeEl.textContent = `💾 ${size}`;
        sizeEl.style.display = 'inline-flex';
    } else {
        sizeEl.style.display = 'none';
    }

    tooltip.classList.add('is-visible');

    // Posicionamento inteligente sobre o card
    const rect = target.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 220;
    const tipHeight = tooltip.offsetHeight || 64;

    let left = rect.left + (rect.width / 2) - (tipWidth / 2);
    left = Math.max(12, Math.min(left, window.innerWidth - tipWidth - 12));

    let top = rect.top - tipHeight - 8;
    if (top < 10) {
        top = rect.bottom + 8;
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function hideCustomTooltip() {
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
    }
    currentHoveredWrapper = null;
    const tooltip = document.getElementById('libTitleTooltip');
    if (tooltip) {
        tooltip.classList.remove('is-visible');
    }
}

function updateTitleMarquees() {
    const wrappers = document.querySelectorAll('.lib-item-title-wrapper');
    wrappers.forEach(wrapper => {
        if (wrapper.classList.contains('is-editing')) return;
        const titleEl = wrapper.querySelector('.lib-item-title');
        if (!titleEl) return;

        // Resetar temporariamente para medir scrollWidth natural
        wrapper.classList.remove('is-overflowing');
        titleEl.style.removeProperty('--marquee-dist');
        titleEl.style.removeProperty('--marquee-duration');

        const overflow = titleEl.scrollWidth - wrapper.clientWidth;
        if (overflow > 4) {
            wrapper.classList.add('is-overflowing');
            const dist = -(overflow + 14);
            titleEl.style.setProperty('--marquee-dist', `${dist}px`);
            const duration = Math.max(3.5, (overflow / 30) + 1.8);
            titleEl.style.setProperty('--marquee-duration', `${duration.toFixed(1)}s`);
        }
    });
}

function setupTitleEditHandlers(item, rec) {
    const wrapper = item.querySelector('.lib-item-title-wrapper');
    const editBtn = item.querySelector('[data-action="edit-title"]');
    if (!wrapper) return;

    const triggerEdit = (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        hideCustomTooltip();
        startInlineTitleEdit(item, rec);
    };

    if (editBtn) {
        editBtn.addEventListener('click', triggerEdit);
    }

    wrapper.addEventListener('dblclick', triggerEdit);
}

function startInlineTitleEdit(item, rec) {
    const wrapper = item.querySelector('.lib-item-title-wrapper');
    if (!wrapper || wrapper.classList.contains('is-editing')) return;

    hideCustomTooltip();

    const titleTrack = wrapper.querySelector('.lib-item-title-track');
    const titleEl = wrapper.querySelector('.lib-item-title');
    const editBtn = wrapper.querySelector('.lib-item-edit-title-btn');
    const currentTitle = getCleanRecordingTitle(rec);

    wrapper.classList.add('is-editing');
    if (titleTrack) titleTrack.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';

    const editForm = document.createElement('div');
    editForm.className = 'lib-item-title-edit-form';
    editForm.innerHTML = `
        <input type="text" class="lib-item-title-input" value="${escapeHtml(currentTitle)}" maxlength="100" spellcheck="false" autocomplete="off" />
        <div class="lib-item-title-edit-actions">
            <button type="button" class="lib-item-title-save-btn" title="Salvar (Enter)">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
            <button type="button" class="lib-item-title-cancel-btn" title="Cancelar (Esc)">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    `;

    wrapper.appendChild(editForm);

    const input = editForm.querySelector('.lib-item-title-input');
    const saveBtn = editForm.querySelector('.lib-item-title-save-btn');
    const cancelBtn = editForm.querySelector('.lib-item-title-cancel-btn');

    let isFinished = false;

    const cleanup = () => {
        if (isFinished) return;
        isFinished = true;
        editForm.remove();
        if (titleTrack) titleTrack.style.display = '';
        if (editBtn) editBtn.style.display = '';
        wrapper.classList.remove('is-editing');
    };

    const handleCancel = (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        cleanup();
    };

    const handleSave = async (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (isFinished) return;

        const newTitle = input.value.trim();
        if (!newTitle || newTitle === currentTitle) {
            cleanup();
            return;
        }

        input.disabled = true;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        editForm.classList.add('is-saving');

        try {
            const res = await window.electronAPI.renameRecording({
                filePath: rec.path,
                newTitle: newTitle
            });

            if (res && res.success) {
                // Atualiza o player de áudio se for a gravação em reprodução
                updatePlayingTrackPath(rec.path, res.newPath, res.newName);

                // Atualiza modelo em memória
                rec.path = res.newPath;
                rec.name = res.newName;
                if (!rec.metadata) rec.metadata = {};
                rec.metadata.title = res.newTitle;

                // Atualiza o card no DOM
                item.setAttribute('data-rec-path', res.newPath);
                const updatedCleanTitle = getCleanRecordingTitle(rec);
                if (titleEl) {
                    titleEl.textContent = updatedCleanTitle;
                    titleEl.classList.remove('renamed-pulse-glow');
                    void titleEl.offsetWidth; // trigger reflow
                    titleEl.classList.add('renamed-pulse-glow');
                    setTimeout(() => titleEl.classList.remove('renamed-pulse-glow'), 1500);
                }
                wrapper.setAttribute('data-tooltip-title', updatedCleanTitle);
                wrapper.setAttribute('data-raw-name', res.newName);

                cleanup();
                updateTitleMarquees();
            } else {
                input.disabled = false;
                saveBtn.disabled = false;
                cancelBtn.disabled = false;
                editForm.classList.remove('is-saving');
                editForm.classList.add('has-error');
                input.focus();
                setTimeout(() => editForm.classList.remove('has-error'), 600);
                alert(`Erro ao renomear: ${res?.error || 'Não foi possível salvar.'}`);
            }
        } catch (err) {
            input.disabled = false;
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            editForm.classList.remove('is-saving');
            editForm.classList.add('has-error');
            setTimeout(() => editForm.classList.remove('has-error'), 600);
            alert(`Erro ao renomear: ${err.message}`);
        }
    };

    saveBtn.addEventListener('mousedown', (e) => e.preventDefault());
    saveBtn.addEventListener('click', handleSave);
    cancelBtn.addEventListener('mousedown', (e) => e.preventDefault());
    cancelBtn.addEventListener('click', handleCancel);

    editForm.addEventListener('click', (e) => e.stopPropagation());
    editForm.addEventListener('dblclick', (e) => e.stopPropagation());

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
        }
    });

    input.addEventListener('blur', (e) => {
        if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
        handleSave();
    });

    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}


