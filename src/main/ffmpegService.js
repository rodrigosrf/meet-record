import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { generateOrUpdateMarkdownSidecar } from './markdownService.js';

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

export async function generateSoundwaveBanner(inputAudioPath, outputImagePath) {
    const ffmpegExe = getFfmpegPath();
    if (!fs.existsSync(inputAudioPath)) return false;

    // Gerar onda senoidal estilizada com gradiente neon ciano ⇄ violeta
    const ffmpegCmd = `"${ffmpegExe}" -y -i "${inputAudioPath}" -filter_complex "aformat=channel_layouts=mono,showwavespic=s=800x160:colors=0x38bdf8|0x818cf8" -frames:v 1 "${outputImagePath}"`;

    return new Promise((resolve) => {
        exec(ffmpegCmd, (err) => {
            if (err) {
                console.warn('Falha ao gerar banner de waveform com FFmpeg:', err.message);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

export async function convertToMp3AndSave({ tempWebmPath, finalMp3Path, finalWebmPath, hasVideo, metadata, visualEffectsConfig = {} }) {
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

                // Gerar banner de onda sonora (waveform.png) se habilitado
                if (visualEffectsConfig.generateWaveformBanner !== false) {
                    const waveformPath = finalMp3Path.replace(/\.mp3$/, '_waveform.png');
                    await generateSoundwaveBanner(finalMp3Path, waveformPath);
                }

                // Save JSON metadata
                if (metadata) {
                    const metadataPath = finalMp3Path.replace(/\.mp3$/, '.json');
                    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

                    // Generate Markdown Sidecar for NotebookLM & Tags
                    const mdPath = finalMp3Path.replace(/\.mp3$/, '.md');
                    await generateOrUpdateMarkdownSidecar(mdPath, metadata);
                }

                resolve({ success: true, path: hasVideo ? finalWebmPath : finalMp3Path });
            } catch (fsErr) {
                console.error('Error finalizing saved files:', fsErr);
                resolve({ success: false, error: fsErr.message });
            }
        });
    });
}
