const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');
const autoTranscribeCheckbox = document.getElementById('autoTranscribe');

async function init() {
    const config = await window.electronAPI.getConfig();
    
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }

    autoTranscribeCheckbox.checked = config.autoTranscribe !== false;

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
}

init();
