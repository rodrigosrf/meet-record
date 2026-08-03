let allVideos = [];
let tagCategories = [];
let searchQuery = '';
let tagFilterQuery = 'all';

export async function initLibraryManager({ onOpenRecording, onDeleteRecording, onOpenTagEditor }) {
    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderLibraryUI({ onOpenRecording, onDeleteRecording, onOpenTagEditor }, true);
        });
    }
}

export async function renderLibraryUI({ onOpenRecording, onDeleteRecording, onOpenTagEditor }, skipFetch = false) {
    const libraryContent = document.getElementById('libraryContent');
    if (!libraryContent) return;

    if (!skipFetch) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Buscando arquivos...</p>';
        allVideos = await window.electronAPI.getLibraryVideos();
        tagCategories = await window.electronAPI.getTagCategories();
        updateTagFilterBar({ onOpenRecording, onDeleteRecording, onOpenTagEditor });
    }

    if (allVideos.length === 0) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhuma gravação encontrada.</p>';
        return;
    }

    let filtered = allVideos.filter(rec => rec.name.toLowerCase().includes(searchQuery));

    if (tagFilterQuery === 'favorites') {
        filtered = filtered.filter(rec => rec.metadata && rec.metadata.favorite === true);
    } else if (tagFilterQuery && tagFilterQuery !== 'all') {
        filtered = filtered.filter(rec => rec.metadata && rec.metadata.tags && rec.metadata.tags.includes(tagFilterQuery));
    }

    if (filtered.length === 0) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhum resultado encontrado.</p>';
        return;
    }

    const groups = groupVideosByDate(filtered);
    libraryContent.innerHTML = '';

    for (const dateLabel of Object.keys(groups)) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'date-group-header';
        groupHeader.textContent = dateLabel;
        libraryContent.appendChild(groupHeader);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'date-group';

        for (const [index, rec] of groups[dateLabel].entries()) {
            const item = document.createElement('div');
            item.className = 'library-item';
            
            const dateStr = new Date(rec.date).toLocaleString('pt-BR', {
                hour: '2-digit', minute: '2-digit'
            });

            const order = groups[dateLabel].length - index;

            let thumbnailHtml = `
                <div class="lib-item-thumbnail">
                    <div class="no-thumb">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    </div>
                </div>`;

            if (rec.metadata && rec.metadata.folderName) {
                const thumbResult = await window.electronAPI.getRecordingThumbnail(rec.metadata.folderName);
                if (thumbResult && thumbResult.success) {
                    const blob = new Blob([thumbResult.buffer], { type: 'image/jpeg' });
                    const thumbUrl = URL.createObjectURL(blob);
                    thumbnailHtml = `
                        <div class="lib-item-thumbnail">
                            <img src="${thumbUrl}" alt="Thumbnail">
                        </div>`;
                }
            }

            const isVideo = rec.path.endsWith('.webm');
            const buttonText = isVideo ? 'Assistir' : 'Ouvir';
            const badgeText = isVideo ? 'WEBM' : 'MP3';
            const isFav = rec.metadata && rec.metadata.favorite;
            const tags = rec.metadata && rec.metadata.tags ? rec.metadata.tags : [];

            item.innerHTML = `
                ${thumbnailHtml}
                ${isFav ? '<div class="lib-item-fav" title="Favorito">⭐</div>' : ''}
                <button class="lib-item-delete" data-action="delete" title="Excluir Gravação">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
                <div class="lib-item-order">${order}</div>
                <div class="lib-item-info">
                    <h4>${rec.name}</h4>
                    <span>${dateStr}</span>
                    ${rec.metadata && rec.metadata.note ? `<p class="lib-item-notes">${rec.metadata.note}</p>` : ''}
                    ${tags.length > 0 ? `<div class="lib-item-tags">${renderTagBadges(tags)}</div>` : ''}
                </div>
                <div class="lib-item-actions">
                     <button class="btn-small btn-tags" data-action="edit-tags" title="Editar Tags">🏷️</button>
                     <button class="btn-small" data-action="open">${buttonText}</button>
                     <span class="badge badge-success">${badgeText}</span>
                </div>
            `;

            item.querySelector('[data-action="open"]')?.addEventListener('click', () => onOpenRecording(rec.path));
            item.querySelector('[data-action="delete"]')?.addEventListener('click', () => onDeleteRecording(rec.path));
            item.querySelector('[data-action="edit-tags"]')?.addEventListener('click', () => onOpenTagEditor(rec.path, tags, isFav));

            groupContainer.appendChild(item);
        }
        libraryContent.appendChild(groupContainer);
    }
}

function updateTagFilterBar(callbacks) {
    const filterBar = document.getElementById('tagFilterBar');
    if (!filterBar) return;

    const existingChips = filterBar.querySelectorAll('.tag-filter-chip');
    existingChips.forEach(chip => {
        if (chip.dataset.filter !== 'all' && chip.dataset.filter !== 'favorites') {
            chip.remove();
        }
    });

    for (const cat of tagCategories) {
        for (const tag of cat.tags) {
            const chip = document.createElement('div');
            chip.className = 'tag-filter-chip';
            chip.dataset.filter = tag;
            chip.textContent = tag;
            chip.style.setProperty('--chip-color', cat.color);
            chip.addEventListener('click', () => {
                filterBar.querySelectorAll('.tag-filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                tagFilterQuery = tag;
                renderLibraryUI(callbacks, true);
            });
            filterBar.appendChild(chip);
        }
    }

    filterBar.querySelectorAll('.tag-filter-chip').forEach(chip => {
        chip.onclick = () => {
            filterBar.querySelectorAll('.tag-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            tagFilterQuery = chip.dataset.filter;
            renderLibraryUI(callbacks, true);
        };
    });
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
        const color = getTagColor(t);
        return `<span class="tag-badge" style="background-color: ${color}22; color: ${color}; border: 1px solid ${color}44;">${t}</span>`;
    }).join('');
}

function getTagColor(tagName) {
    for (const cat of tagCategories) {
        if (cat.tags.includes(tagName)) {
            return cat.color;
        }
    }
    return '#94a3b8';
}
