import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 400,
        height: 300,
        title: 'Reunião de Teste - Teams'
    });
    win.loadURL('data:text/html,<h1>Simulação de Reunião</h1><p>Esta janela deve ser detectada pelo Meet Recorder.</p>');
});
