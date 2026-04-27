const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');
const autoTranscribeCheckbox = document.getElementById('autoTranscribe');

// AI Elements
const aiProviderSelect = document.getElementById('aiProvider');
const aiModelInput = document.getElementById('aiModel');
const aiApiKeyInput = document.getElementById('aiApiKey');
const aiSystemPromptInput = document.getElementById('aiSystemPrompt');
const autoSummarizeCheckbox = document.getElementById('autoSummarize');

// Tab Switching
const sidebarItems = document.querySelectorAll('.sidebar-item');
const tabContents = document.querySelectorAll('.tab-content');

async function init() {
    const config = await window.electronAPI.getConfig();
    
    // Load General Settings
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }
    autoTranscribeCheckbox.checked = config.autoTranscribe !== false;

    // Load AI Settings
    if (config.aiConfig) {
        aiProviderSelect.value = config.aiConfig.provider || 'openrouter';
        aiModelInput.value = config.aiConfig.model || '';
        aiApiKeyInput.value = config.aiConfig.apiKey || '';
        aiSystemPromptInput.value = config.aiConfig.systemPrompt || '';
        autoSummarizeCheckbox.checked = config.aiConfig.autoSummarize || false;
    }

    // General Listeners
    changePathBtn.addEventListener('click', async () => {
        const path = await window.electronAPI.selectDirectory();
        if (path) {
            currentPathDisplay.textContent = path;
        }
    });

    autoTranscribeCheckbox.addEventListener('change', async () => {
        await window.electronAPI.updateConfig({ 
            autoTranscribe: autoTranscribeCheckbox.checked 
        });
    });

    // AI Listeners - Save on change/blur
    const saveAIConfig = async () => {
        await window.electronAPI.updateConfig({
            aiConfig: {
                provider: aiProviderSelect.value,
                model: aiModelInput.value,
                apiKey: aiApiKeyInput.value,
                systemPrompt: aiSystemPromptInput.value,
                autoSummarize: autoSummarizeCheckbox.checked
            }
        });
    };

    [aiProviderSelect, aiModelInput, aiApiKeyInput, aiSystemPromptInput, autoSummarizeCheckbox].forEach(el => {
        el.addEventListener('change', saveAIConfig);
    });

    // Sidebar/Tab Logic
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            
            // Update Sidebar
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Update Content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${tabId}-tab`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

init();
