const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');

async function init() {
    const config = await window.electronAPI.getConfig();
    
    // Load General Settings
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }

    // General Listeners
    changePathBtn.addEventListener('click', async () => {
        const path = await window.electronAPI.selectDirectory();
        if (path) {
            currentPathDisplay.textContent = path;
        }
    });
}

init();
