import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';

function getFfmpegPath() {
    let binaryPath = ffmpegStatic;
    if (binaryPath) {
        // Handle Electron app.asar unpacked path if needed
        binaryPath = binaryPath.replace(/\bapp\.asar\b/g, 'app.asar.unpacked');
        if (fs.existsSync(binaryPath)) {
            return binaryPath;
        }
    }
    return 'ffmpeg'; // System PATH fallback
}

export async function convertToMp3AndSave({ tempWebmPath, finalMp3Path, finalWebmPath, hasVideo, metadata }) {
    const ffmpegExe = getFfmpegPath();
    
    let metadataArgs = '';
    if (metadata) {
        let combinedTitle = metadata.title || 'Sem Título';
        if (metadata.note) {
            combinedTitle += ` - ${metadata.note.replace(/\r?\n/g, ' ')}`;
        }
        
        const safeTitle = combinedTitle.replace(/"/g, '\\"');
        metadataArgs += ` -metadata title="${safeTitle}"`;
        
        if (metadata.note) {
            const safeNote = metadata.note.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
            metadataArgs += ` -metadata comment="${safeNote}"`;
        }
    }

    const ffmpegCommand = `"${ffmpegExe}" -i "${tempWebmPath}" -vn -ab 128k -id3v2_version 3${metadataArgs} "${finalMp3Path}"`;

    return new Promise((resolve) => {
        exec(ffmpegCommand, async (error) => {
            if (error) {
                console.error('Error converting to mp3 with ffmpeg:', error);
                try {
                    if (fs.existsSync(tempWebmPath)) await fs.promises.unlink(tempWebmPath);
                } catch (e) { /* ignore */ }
                resolve({ success: false, error: 'Falha na conversão para MP3. Verifique as configurações de mídia.' });
                return;
            }

            try {
                // Handle WebM file retention
                if (hasVideo) {
                    await fs.promises.rename(tempWebmPath, finalWebmPath);
                } else {
                    if (fs.existsSync(tempWebmPath)) {
                        await fs.promises.unlink(tempWebmPath);
                    }
                }

                // Save JSON metadata
                if (metadata) {
                    const metadataPath = finalMp3Path.replace(/\.mp3$/, '.json');
                    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

                    // Generate Markdown Sidecar for NotebookLM (Only if note/comment exists)
                    if (metadata.note && metadata.note.trim()) {
                        try {
                            const mdPath = finalMp3Path.replace(/\.mp3$/, '.md');
                            const date = new Date(metadata.date);
                            const formattedDate = date.toLocaleString('pt-BR', { 
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                            });
                            
                            const durationSeconds = Math.floor((metadata.duration || 0) / 1000);
                            const h = Math.floor(durationSeconds / 3600);
                            const m = Math.floor((durationSeconds % 3600) / 60);
                            const s = durationSeconds % 60;
                            const formattedDuration = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

                            const mdContent = `# ${metadata.title || 'Sem Título'}

**Data:** ${formattedDate}
**Duração:** ${formattedDuration}

---

## Notas da Reunião
${metadata.note.trim()}
`;
                            await fs.promises.writeFile(mdPath, mdContent, 'utf8');
                        } catch (mdError) {
                            console.error('Error generating Markdown sidecar:', mdError);
                        }
                    }
                }

                resolve({ success: true, path: hasVideo ? finalWebmPath : finalMp3Path });
            } catch (fsErr) {
                console.error('Error finalizing saved files:', fsErr);
                resolve({ success: false, error: fsErr.message });
            }
        });
    });
}
