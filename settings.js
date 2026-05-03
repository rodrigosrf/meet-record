const currentPathDisplay = document.getElementById('currentPath');
const changePathBtn = document.getElementById('changePathBtn');
const screenshotIntervalSelect = document.getElementById('screenshotInterval');
const smartCaptureCheckbox = document.getElementById('smartCapture');

async function init() {
    const config = await window.electronAPI.getConfig();
    
    // Load General Settings
    if (config.outputDirectory) {
        currentPathDisplay.textContent = config.outputDirectory;
    } else {
        currentPathDisplay.textContent = "Não selecionado";
    }

    if (config.screenshotInterval) {
        screenshotIntervalSelect.value = config.screenshotInterval;
    }

    if (config.smartCapture !== undefined) {
        smartCaptureCheckbox.checked = config.smartCapture;
    }

    // General Listeners
    changePathBtn.addEventListener('click', async () => {
        const path = await window.electronAPI.selectDirectory();
        if (path) {
            currentPathDisplay.textContent = path;
        }
    });

    screenshotIntervalSelect.addEventListener('change', async () => {
        await window.electronAPI.updateConfig({
            screenshotInterval: parseInt(screenshotIntervalSelect.value)
        });
    });

    smartCaptureCheckbox.addEventListener('change', async () => {
        await window.electronAPI.updateConfig({
            smartCapture: smartCaptureCheckbox.checked
        });
    });
}

init();
