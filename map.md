# 🗺️ Repository Map & LLM Context Guide (`map.md`)

> **Finalidade deste arquivo**: Fornecer um guia conciso, estruturado e mapeado de toda a base de código do **Meet Record**. Este mapa foi projetado para que **Modelos de Linguagem (LLMs)** e agentes de IA compreendam a arquitetura, o fluxo de dados e os pontos de entrada sem precisarem ler milhares de linhas de código desnecessariamente, **reduzindo o consumo de tokens** e **acelerando a busca de informações**.
>
> ⚠️ **REGRA DE MANUTENÇÃO (IMPORTANTE PARA LLMS E DESENVOLVEDORES)**: Sempre que uma alteração importante for realizada no projeto (como adição/remoção de arquivos, novos canais IPC, mudanças arquiteturais, novos módulos ou alteração no fluxo de dados), **este arquivo (`map.md`) DEVE ser atualizado obrigatoriamente** para manter o mapa sincronizado e eficiente.

---

## 🚀 1. Visão Geral do Projeto & Tech Stack

**Meet Record** é uma aplicação desktop em **Electron** para detecção automática, gravação, organização e gerenciamento de reuniões online (Google Meet, Microsoft Teams, Zoom, Webex, etc.).

*   **Runtime / Framework**: Electron v41+ (Node.js ESM, `type: "module"` no `package.json`).
*   **Main Process**: JavaScript (`main.js`) + Módulos Node.js em `src/main/`.
*   **Renderer Process**: Vanilla JS, HTML5, CSS3 + Módulos em `src/renderer/`.
*   **Detecção de Reuniões**: Script PowerShell Daemon ([detectMeetings.ps1](file:///d:/Dev/meet-record/detectMeetings.ps1)) executado em background via `spawn`.
*   **Processamento de Mídia**: FFmpeg estático ([src/main/ffmpegService.js](file:///d:/Dev/meet-record/src/main/ffmpegService.js)) via biblioteca `ffmpeg-static`.
*   **Persistência de Configurações**: `electron-store`.

---

## 📁 2. Estrutura de Diretórios & Responsabilidades

```
meet-record/
├── 📄 main.js                   # Entry point do Electron (Main Process, IPC handlers, PowerShell daemon, Janelas)
├── 📄 preload.js                # Context Bridge (Expõe window.electronAPI de forma segura para o Renderer)
├── 📄 detectMeetings.ps1        # Daemon PowerShell que monitora processos/janelas de reuniões ativas
├── 📄 index.html                # UI principal da aplicação (Dashboard, Player, Biblioteca, Logs)
├── 📄 renderer.js               # Lógica principal da janela principal (Gravação WebRTC/MediaRecorder, AudioCtx)
├── 📄 style.css                 # Estilos globais e tema da interface principal
├── 📄 overlay.html / .js / .css # Widget flutuante de controle de gravação (Status, Timer, Pausa, Screenshot)
├── 📄 settings.html / .js       # Janela de configurações (Caminhos, templates de nomes, tags, auto-arquivamento)
├── 📄 package.json              # Configurações do projeto, scripts e electron-builder
├── 📂 src/
│   ├── 📂 main/
│   │   ├── 📄 ffmpegService.js  # Conversão de áudio para MP3, extração e junção via FFmpeg
│   │   └── 📄 libraryService.js # Gestão de arquivos de gravação no disco, thumbs, exclusão e arquivamento
│   └── 📂 renderer/
│       ├── 📄 audioDeviceManager.js # Enumeração e gerenciamento de dispositivos de entrada/saída de áudio
│       ├── 📄 audioPlayer.js        # Controller de reprodução de gravações na interface
│       ├── 📄 audioVisualizer.js    # Engine de equalizador de áudio High-DPI (Espectro Neon, Ondas, LED, Radial, VU Meter)
│       ├── 📄 libraryManager.js     # Renderização, filtragem e ordenação da biblioteca de reuniões
│       └── 📄 tagEditor.js          # Modal e editor de tags/categorias para reuniões salvas
```

---

## 🔄 3. Fluxos de Funcionamento Principais

### A. Detecção Automática de Reuniões
1. `main.js` inicia o daemon `detectMeetings.ps1` usando `child_process.spawn`.
2. O script PowerShell roda em loop contínuo (modo interativo/daemon) checando processos (Teams, Zoom, Webex) e títulos de janelas de navegadores (Chrome, Edge, Brave, Firefox - Google Meet).
3. `detectMeetings.ps1` emite JSON estruturado via `stdout`.
4. `main.js` consome o buffer e dispara eventos `meeting-detected` ou `no-meeting-detected` para o Renderer via `webContents.send`.

### B. Ciclo de Gravação de Áudio/Vídeo
1. **Início**: Acionado automaticamente pela detecção ou manualmente via UI/Overlay (`start-manual-recording`).
2. **Captura**: O Renderer (`renderer.js`) utiliza `navigator.mediaDevices.getUserMedia` / `desktopCapturer` para capturar áudio/vídeo e exibe o overlay flutuante.
3. **Detecção de Silêncio**: O Renderer monitora o áudio usando `AudioContext` e `AnalyserNode`. Se houver silêncio pelo tempo configurado (`autoStopSilenceMinutes`), dispara o auto-stop.
4. **Finalização**: Os Chunks gravados via `MediaRecorder` são enviados para o Main Process (`save-file`).
5. **Pós-processamento**: `main.js` salva os arquivos e chama `ffmpegService.js` para converter/otimizar o áudio para MP3 se configurado.

---

## 🔌 4. Registro Completo de Canais IPC (`preload.js` -> `main.js`)

Para evitar busca no código, aqui estão os principais canais expostos em `window.electronAPI`:

| Canal IPC | Tipo | Origem -> Destino | Descrição |
| :--- | :--- | :--- | :--- |
| `get-sources` | `invoke` | Renderer -> Main | Lista fontes de captura de tela/janela (`desktopCapturer`) |
| `select-directory` | `invoke` | Renderer -> Main | Abre caixa de diálogo nativa para selecionar pasta |
| `get-config` / `update-config` | `invoke` | Renderer -> Main | Lê ou atualiza as configurações do `electron-store` |
| `open-settings` | `send` | Renderer -> Main | Abre a janela secundária de configurações |
| `meeting-detected` | `on` | Main -> Renderer | Notifica que uma reunião ativa foi encontrada pelo PowerShell |
| `no-meeting-detected` | `on` | Main -> Renderer | Notifica término/ausência de reuniões |
| `save-file` | `invoke` | Renderer -> Main | Envia os blobs gravados para salvamento no sistema de arquivos |
| `get-library-videos` | `invoke` | Renderer -> Main | Retorna a lista de gravações salvas na pasta configurada |
| `show-overlay` / `hide-overlay` | `send` | Renderer -> Main | Exibe ou oculta o widget de overlay |
| `overlay-update` / `sync-overlay` | `on`/`send` | Bidirecional | Sincroniza estado de gravação, timer e título entre Main e Overlay |
| `get-organization-config` / `update-organization-config` | `invoke` | Renderer -> Main | Gerencia templates de organização de arquivos |
| `update-recording-tags` / `get-tag-categories` | `invoke` | Renderer -> Main | Gerencia sistema de tags de reuniões |

---

## ⚙️ 5. Esquema de Configurações (`electron-store`)

Configuração padrão definida em `main.js`:
```json
{
  "outputDirectory": "",
  "autoRecord": true,
  "autoStopSilenceMinutes": 1,
  "organizationConfig": {
    "pathTemplate": "{year}-{month}-{day}",
    "fileNamingTemplate": "{timestamp}_{title}",
    "autoArchiveDays": 0,
    "archivePath": "",
    "compressionEnabled": false,
    "separateVideoFolder": false
  },
  "tagCategories": []
}
```

---

## 💡 6. Guia Rápido de Localização de Código (Cheat Sheet para LLMs)

Ao modificar uma funcionalidade específica, consulte este guia antes de ler os arquivos:

*   **Alterar detecção de reuniões (novos apps ou navegadores)**:
    👉 Editar [detectMeetings.ps1](file:///d:/Dev/meet-record/detectMeetings.ps1) (função `Get-ActiveMeetings`) e parsing em [main.js](file:///d:/Dev/meet-record/main.js).
*   **Ajustar conversão de áudio, geração de .md ou execução do FFmpeg**:
    👉 Editar [src/main/ffmpegService.js](file:///d:/Dev/meet-record/src/main/ffmpegService.js) (Nota: arquivos `.md` sidecar só são gerados se houver comentários registrados).
*   **Modificar a lista de gravações, biblioteca, capas/thumbnails**:
    👉 Editar [src/main/libraryService.js](file:///d:/Dev/meet-record/src/main/libraryService.js) e [src/renderer/libraryManager.js](file:///d:/Dev/meet-record/src/renderer/libraryManager.js) (capas automáticas são capturadas após 1 min com foco na janela do Teams).
*   **Ajustar a captura de áudio/vídeo WebRTC, visualizador contínuo ou detecção de silêncio**:
    👉 Editar [renderer.js](file:///d:/Dev/meet-record/renderer.js), [src/renderer/audioVisualizer.js](file:///d:/Dev/meet-record/src/renderer/audioVisualizer.js) e [src/renderer/audioDeviceManager.js](file:///d:/Dev/meet-record/src/renderer/audioDeviceManager.js).
*   **Modificar o Overlay flutuante**:
    👉 Editar [overlay.js](file:///d:/Dev/meet-record/overlay.js), [overlay.html](file:///d:/Dev/meet-record/overlay.html) e tratadores de eventos de overlay em [main.js](file:///d:/Dev/meet-record/main.js).

---

## 🛠️ 7. Comandos de Build e Execução

*   **Iniciar aplicação em desenvolvimento**:
    `npm run start` (ou `npx electron .`)
*   **Gerar instalador executável (.exe)**:
    `npm run build` (Executa `electron-builder --win --x64`, saída na pasta `dist/`)
