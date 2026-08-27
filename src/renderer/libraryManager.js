import { getTagColor, openTagEditorModal } from './tagEditor.js';
import { getCurrentlyPlayingPath, getPlaybackState, togglePlayPauseAudio } from './audioPlayer.js';

let allVideos = [];
let tagCategories = [];
let searchQuery = '';
let tagFilterQuery = 'all';

let currentCallbacks = {
    onOpenRecording: null,
    onDeleteRecording: null,
    onOpenTagEditor: null
};

export async function initLibraryManager(callbacks = {}) {
    currentCallbacks = { ...currentCallbacks, ...callbacks };

    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderLibraryUI(currentCallbacks, true);
        });
    }
}

export async function renderLibraryUI(callbacks = {}, skipFetch = false) {
    if (callbacks && Object.keys(callbacks).length > 0) {
        currentCallbacks = { ...currentCallbacks, ...callbacks };
    }

    const libraryContent = document.getElementById('libraryContent');
    if (!libraryContent) return;

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

    let filtered = allVideos.filter(rec => rec.name.toLowerCase().includes(searchQuery));

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
            
            const dateStr = new Date(rec.date).toLocaleString('pt-BR', {
                hour: '2-digit', minute: '2-digit'
            });

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

            const isThisPlaying = (currentPlaying === rec.path && playbackState === 'playing');
            const isThisPaused = (currentPlaying === rec.path && playbackState === 'paused');

            item.innerHTML = `
                <div class="lib-item-thumbnail" data-action="play-card" title="Clique para ${buttonText.toLowerCase()}">
                    ${thumbnailImgHtml}
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
                    <h4 title="${rec.name}">${rec.name}</h4>
                    <div class="lib-item-meta-row">
                        <span class="lib-item-time">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            ${dateStr}
                        </span>
                        ${durationStr ? `<span class="lib-item-duration" title="Duração">${durationStr}</span>` : ''}
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
                        <button class="btn-action-tag" data-action="edit-tags" title="Gerenciar Tags">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                            <span>Tags${tags.length > 0 ? ` (${tags.length})` : ''}</span>
                        </button>
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

            item.querySelector('[data-action="edit-tags"]')?.addEventListener('click', openTagEditorHandler);
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

            groupContainer.appendChild(item);
        }
        libraryContent.appendChild(groupContainer);
    }
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

