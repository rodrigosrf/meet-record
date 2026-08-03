const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');

// Organization elements
const pathTemplateInput = document.getElementById('pathTemplateInput');
const pathTemplatePreview = document.getElementById('pathTemplatePreview');
const fileNamingInput = document.getElementById('fileNamingInput');
const fileNamingPreview = document.getElementById('fileNamingPreview');
const autoArchiveDaysInput = document.getElementById('autoArchiveDaysInput');
const archivePathDisplay = document.getElementById('archivePathDisplay');
const changeArchivePathBtn = document.getElementById('changeArchivePathBtn');
const compressionCheckbox = document.getElementById('compressionCheckbox');
const archiveNowBtn = document.getElementById('archiveNowBtn');
const archiveStatus = document.getElementById('archiveStatus');
const reorganizeNowBtn = document.getElementById('reorganizeNowBtn');
const reorgStatus = document.getElementById('reorgStatus');

// Tags elements
const tagCategoriesList = document.getElementById('tagCategoriesList');
const newCategoryName = document.getElementById('newCategoryName');
const newCategoryTags = document.getElementById('newCategoryTags');
const newCategoryColor = document.getElementById('newCategoryColor');
const addCategoryBtn = document.getElementById('addCategoryBtn');

// Tab navigation
const sidebarItems = document.querySelectorAll('.sidebar-item');
const tabContents = document.querySelectorAll('.tab-content');

let organizationConfig = {};
let tagCategories = [];
let outputDir = '';

sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        
        // Update active sidebar item
        sidebarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Show corresponding tab
        tabContents.forEach(t => t.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');
    });
});

async function init() {
    const config = await window.electronAPI.getConfig();
    outputDir = config.outputDirectory || '';
    
    // Load General Settings
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }

    // General Listeners
    if (changePathBtn) {
        changePathBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.selectDirectory();
            if (path) {
                currentPathDisplay.textContent = path;
                outputDir = path;
                updateOrgPreviews();
            }
        });
    }

    // ===== ORGANIZATION =====
    organizationConfig = await window.electronAPI.getOrganizationConfig();
    if (organizationConfig) {
        pathTemplateInput.value = organizationConfig.pathTemplate || '{year}-{month}-{day}';
        fileNamingInput.value = organizationConfig.fileNamingTemplate || '{timestamp}_{title}';
        autoArchiveDaysInput.value = organizationConfig.autoArchiveDays || 0;
        if (organizationConfig.archivePath) {
            archivePathDisplay.textContent = organizationConfig.archivePath;
        }
        compressionCheckbox.checked = organizationConfig.compressionEnabled || false;
    }

    // Save organization config on change
    async function saveOrgConfig() {
        organizationConfig.pathTemplate = pathTemplateInput.value;
        organizationConfig.fileNamingTemplate = fileNamingInput.value;
        organizationConfig.autoArchiveDays = parseInt(autoArchiveDaysInput.value) || 0;
        organizationConfig.compressionEnabled = compressionCheckbox.checked;
        organizationConfig.separateVideoFolder = organizationConfig.separateVideoFolder || false;
        await window.electronAPI.updateOrganizationConfig(organizationConfig);
    }

    async function updateOrgPreviews() {
        // Path preview
        const pathResult = await window.electronAPI.previewOrganizationPath({
            template: pathTemplateInput.value,
            title: 'Exemplo_Titulo'
        });
        if (pathResult.success) {
            pathTemplatePreview.textContent = `Preview: ${pathResult.path}\\`;
        }

        // File naming preview
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestamp = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}_${pad(today.getHours())}${pad(today.getMinutes())}`;
        const resolvedName = fileNamingInput.value
            .replace('{timestamp}', timestamp)
            .replace('{title}', 'Exemplo_Titulo')
            .replace('{year}', today.getFullYear())
            .replace('{month}', pad(today.getMonth() + 1))
            .replace('{day}', pad(today.getDate()));
        fileNamingPreview.textContent = `Preview: ${resolvedName}.mp3`;
    }

    pathTemplateInput.addEventListener('input', () => {
        updateOrgPreviews();
        saveOrgConfig();
    });

    fileNamingInput.addEventListener('input', () => {
        updateOrgPreviews();
        saveOrgConfig();
    });

    autoArchiveDaysInput.addEventListener('change', saveOrgConfig);
    compressionCheckbox.addEventListener('change', saveOrgConfig);

    updateOrgPreviews();

    // Archive path selection
    changeArchivePathBtn.addEventListener('click', async () => {
        const archivePath = await window.electronAPI.selectDirectory();
        if (archivePath) {
            archivePathDisplay.textContent = archivePath;
            organizationConfig.archivePath = archivePath;
            await saveOrgConfig();
        }
    });

    // Archive Now button
    archiveNowBtn.addEventListener('click', async () => {
        const days = parseInt(autoArchiveDaysInput.value) || 30;
        archiveStatus.style.display = 'block';
        archiveStatus.textContent = 'Arquivando...';
        archiveStatus.style.color = '#f59e0b';
        
        const result = await window.electronAPI.archiveRecordings({ olderThanDays: days });
        
        if (result.success) {
            archiveStatus.textContent = `${result.movedCount} arquivo(s) movido(s) para o archive.`;
            archiveStatus.style.color = '#22c55e';
        } else {
            archiveStatus.textContent = `Erro: ${result.error}`;
            archiveStatus.style.color = '#ef4444';
        }
        setTimeout(() => { archiveStatus.style.display = 'none'; }, 5000);
    });

    // Reorganize Now button
    reorganizeNowBtn.addEventListener('click', async () => {
        reorgStatus.style.display = 'block';
        reorgStatus.textContent = 'Reorganizando...';
        reorgStatus.style.color = '#f59e0b';
        
        const result = await window.electronAPI.reorganizeFiles({ 
            pathTemplate: pathTemplateInput.value 
        });
        
        if (result.success) {
            reorgStatus.textContent = `${result.reorgCount} arquivo(s) reorganizado(s).`;
            reorgStatus.style.color = '#22c55e';
        } else {
            reorgStatus.textContent = `Erro: ${result.error}`;
            reorgStatus.style.color = '#ef4444';
        }
        setTimeout(() => { reorgStatus.style.display = 'none'; }, 5000);
    });

    // ===== TAGS =====
    tagCategories = await window.electronAPI.getTagCategories();
    renderTagCategories();

    addCategoryBtn.addEventListener('click', async () => {
        const name = newCategoryName.value.trim();
        const tagsStr = newCategoryTags.value.trim();
        const color = newCategoryColor.value;

        if (!name || !tagsStr) {
            alert('Preencha o nome e as tags da categoria.');
            return;
        }

        const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
        
        const category = {
            id: Date.now().toString(),
            name,
            color,
            tags
        };

        tagCategories.push(category);
        await window.electronAPI.updateTagCategories(tagCategories);
        
        newCategoryName.value = '';
        newCategoryTags.value = '';
        newCategoryColor.value = '#3b82f6';
        
        renderTagCategories();
    });
}

function renderTagCategories() {
    if (!tagCategoriesList) return;
    
    if (tagCategories.length === 0) {
        tagCategoriesList.innerHTML = '<p class="help-text" style="text-align:center; padding: 2rem;">Nenhuma categoria configurada. Adicione abaixo.</p>';
        return;
    }

    tagCategoriesList.innerHTML = tagCategories.map(cat => `
        <div class="tag-category-item" style="border-left: 4px solid ${cat.color};">
            <div class="tag-category-header">
                <div class="tag-category-info">
                    <span class="tag-category-dot" style="background-color: ${cat.color};"></span>
                    <strong>${cat.name}</strong>
                </div>
                <button class="btn-cancel" onclick="deleteCategory('${cat.id}')" title="Excluir categoria">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="tag-category-tags">
                ${cat.tags.map(t => `<span class="tag-badge-sm" style="background-color: ${cat.color}22; color: ${cat.color}; border: 1px solid ${cat.color}44;">${t}</span>`).join('')}
            </div>
        </div>
    `).join('');
}

async function deleteCategory(id) {
    if (!confirm('Tem certeza que deseja excluir esta categoria?')) return;
    tagCategories = tagCategories.filter(c => c.id !== id);
    await window.electronAPI.updateTagCategories(tagCategories);
    renderTagCategories();
}

window.deleteCategory = deleteCategory;

init();