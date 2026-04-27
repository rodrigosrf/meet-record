const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');

async function init() {
    const config = await window.electronAPI.getConfig();
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }

    changePathBtn.addEventListener('click', async () => {
        const path = await window.electronAPI.selectDirectory();
        if (path) {
            currentPathDisplay.textContent = path;
            // Notify the main window to refresh its config
            // In a real app we might use a store with change listeners
            // but for simplicity, the next time the main window needs it, it will fetch or we can send a message.
            // Actually, the main window should probably reload its config.
        }
    });
}

init();
