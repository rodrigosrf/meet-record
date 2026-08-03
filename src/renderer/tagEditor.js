let tagEditorCurrentPath = '';
let tagEditorCurrentTags = [];
let tagEditorIsFavorite = false;

export function openTagEditorModal(filePath, tags, isFavorite, { onSaveSuccess }) {
    tagEditorCurrentPath = filePath;
    tagEditorCurrentTags = [...(tags || [])];
    tagEditorIsFavorite = !!isFavorite;

    const pathInput = document.getElementById('tagEditorFilePath');
    const favCheckbox = document.getElementById('tagEditorFavorite');
    const backdrop = document.getElementById('tagEditorBackdrop');
    const input = document.getElementById('tagEditorInput');

    if (pathInput) pathInput.value = filePath;
    if (favCheckbox) favCheckbox.checked = tagEditorIsFavorite;

    renderCurrentTags();
    renderTagSuggestions();

    if (backdrop) backdrop.classList.remove('hidden');
    if (input) input.focus();

    setupTagEditorListeners(onSaveSuccess);
}

export function closeTagEditorModal() {
    const backdrop = document.getElementById('tagEditorBackdrop');
    if (backdrop) backdrop.classList.add('hidden');
}

function setupTagEditorListeners(onSaveSuccess) {
    const closeBtn = document.getElementById('closeTagEditorBtn');
    const backdrop = document.getElementById('tagEditorBackdrop');
    const saveBtn = document.getElementById('saveTagsBtn');
    const input = document.getElementById('tagEditorInput');

    if (closeBtn) closeBtn.onclick = () => closeTagEditorModal();
    if (backdrop) {
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeTagEditorModal();
        };
    }

    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const tag = input.value.trim().toLowerCase();
                if (tag && !tagEditorCurrentTags.includes(tag)) {
                    tagEditorCurrentTags.push(tag);
                    input.value = '';
                    renderCurrentTags();
                    renderTagSuggestions();
                }
            }
            if (e.key === 'Escape') closeTagEditorModal();
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            const favCheckbox = document.getElementById('tagEditorFavorite');
            const isFav = favCheckbox ? favCheckbox.checked : false;

            const result = await window.electronAPI.updateRecordingTags({
                filePath: tagEditorCurrentPath,
                tags: tagEditorCurrentTags,
                favorite: isFav
            });

            if (result.success) {
                closeTagEditorModal();
                if (onSaveSuccess) onSaveSuccess();
            } else {
                alert('Erro ao salvar tags: ' + result.error);
            }
        };
    }
}

async function renderCurrentTags() {
    const container = document.getElementById('tagEditorCurrentTags');
    if (!container) return;

    if (tagEditorCurrentTags.length === 0) {
        container.innerHTML = '<span class="help-text" style="opacity:0.5;">Nenhuma tag. Adicione abaixo.</span>';
        return;
    }

    const categories = await window.electronAPI.getTagCategories();
    container.innerHTML = tagEditorCurrentTags.map(tag => {
        const color = getTagColor(tag, categories);
        return `<span class="tag-badge tag-removable" style="background-color: ${color}22; color: ${color}; border: 1px solid ${color}44;">${tag} ×</span>`;
    }).join('');

    container.querySelectorAll('.tag-removable').forEach((el, index) => {
        el.onclick = () => {
            tagEditorCurrentTags.splice(index, 1);
            renderCurrentTags();
            renderTagSuggestions();
        };
    });
}

async function renderTagSuggestions() {
    const container = document.getElementById('tagEditorSuggestions');
    if (!container) return;

    const categories = await window.electronAPI.getTagCategories();
    const suggestions = [];

    for (const cat of categories) {
        for (const tag of cat.tags) {
            if (!tagEditorCurrentTags.includes(tag)) {
                suggestions.push({ tag, color: cat.color });
            }
        }
    }

    if (suggestions.length === 0) {
        container.innerHTML = '<span class="help-text" style="font-size:0.7rem;">Configure categorias de tags nas Configurações.</span>';
        return;
    }

    container.innerHTML = '<span class="help-text" style="font-size:0.7rem; margin-bottom: 4px;">Sugestões:</span>' +
        suggestions.map(s => 
            `<span class="tag-badge tag-suggestion" style="background-color: ${s.color}22; color: ${s.color}; border: 1px solid ${s.color}44;">+ ${s.tag}</span>`
        ).join('');

    container.querySelectorAll('.tag-suggestion').forEach((el, index) => {
        el.onclick = () => {
            const selected = suggestions[index];
            if (selected && !tagEditorCurrentTags.includes(selected.tag)) {
                tagEditorCurrentTags.push(selected.tag);
                renderCurrentTags();
                renderTagSuggestions();
            }
        };
    });
}

function getTagColor(tagName, categories) {
    if (categories) {
        for (const cat of categories) {
            if (cat.tags.includes(tagName)) return cat.color;
        }
    }
    return '#94a3b8';
}
