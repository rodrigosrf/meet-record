import fs from 'fs';
import path from 'path';
import { generateOrUpdateMarkdownSidecar } from './markdownService.js';

export async function getLibraryVideosAsync(outputDir) {
    if (!outputDir) return [];
    
    try {
        await fs.promises.access(outputDir);
    } catch {
        return [];
    }

    const recordings = [];

    // Pre-read screenshots directory to calculate screenshot count efficiently
    let screenshotsFiles = [];
    try {
        const sDir = path.join(outputDir, 'screenshots');
        await fs.promises.access(sDir);
        screenshotsFiles = await fs.promises.readdir(sDir);
    } catch (e) {
        screenshotsFiles = [];
    }

    async function scanDir(currentPath) {
        let entries;
        try {
            entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        } catch (e) {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'archive' || entry.name === 'screenshots') continue;
                await scanDir(fullPath);
            } else if (entry.name.endsWith('.mp3') || entry.name.endsWith('.webm')) {
                const baseName = path.parse(fullPath).name;
                const metadataPath = path.join(currentPath, baseName + '.json');
                let metadata = {};
                
                try {
                    await fs.promises.access(metadataPath);
                    const metaContent = await fs.promises.readFile(metadataPath, 'utf8');
                    metadata = JSON.parse(metaContent);
                } catch (e) { /* ignore missing metadata */ }

                // Count linked screenshots strictly in outputDir/screenshots
                const fName = metadata.folderName || baseName;
                let count = 0;
                for (const sf of screenshotsFiles) {
                    if ((sf.endsWith('.jpg') || sf.endsWith('.png')) && (sf.startsWith(fName) || sf.startsWith(baseName))) {
                        count++;
                    }
                }
                metadata.screenshotCount = count;

                try {
                    const stat = await fs.promises.stat(fullPath);
                    recordings.push({
                        name: entry.name,
                        path: fullPath,
                        date: stat.birthtime,
                        size: stat.size,
                        metadata: metadata
                    });
                } catch (e) { /* ignore stat failure */ }
            }
        }
    }

    try {
        await scanDir(outputDir);
        return recordings.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (err) {
        console.error("Error scanning library:", err);
        return [];
    }
}

export async function getRecordingScreenshotsAsync(outputDir, folderName, recPath) {
    if (!outputDir) return [];

    const baseName = recPath ? path.parse(recPath).name : folderName;
    const targetPrefixes = Array.from(new Set([folderName, baseName].filter(Boolean)));
    const screenshotsDir = path.join(outputDir, 'screenshots');
    const screenshots = [];

    try {
        await fs.promises.access(screenshotsDir);
        const files = await fs.promises.readdir(screenshotsDir);

        for (const file of files) {
            if (!file.endsWith('.jpg') && !file.endsWith('.png')) continue;

            const matches = targetPrefixes.some(prefix => file.startsWith(prefix));
            if (!matches) continue;

            const filePath = path.join(screenshotsDir, file);
            try {
                const stat = await fs.promises.stat(filePath);
                const buf = await fs.promises.readFile(filePath);
                const isCover = file.includes('_cover');

                screenshots.push({
                    name: file,
                    path: filePath,
                    size: stat.size,
                    date: stat.mtime,
                    type: isCover ? 'cover' : 'manual',
                    buffer: new Uint8Array(buf)
                });
            } catch (e) { /* ignore read failure */ }
        }
    } catch (e) {
        return [];
    }

    // Sort: cover first, then chronologically by creation/mtime
    screenshots.sort((a, b) => {
        if (a.type === 'cover' && b.type !== 'cover') return -1;
        if (b.type === 'cover' && a.type !== 'cover') return 1;
        return new Date(a.date) - new Date(b.date);
    });

    return screenshots;
}

export async function getRecordingThumbnailAsync(outputDir, folderName, recPath) {
    if (!outputDir) return null;

    const baseName = recPath ? path.parse(recPath).name : folderName;
    const targetPrefixes = Array.from(new Set([folderName, baseName].filter(Boolean)));
    const screenshotsDir = path.join(outputDir, 'screenshots');

    try {
        await fs.promises.access(screenshotsDir);
        const files = await fs.promises.readdir(screenshotsDir);
        const matchingFiles = files.filter(f => 
            (f.endsWith('.jpg') || f.endsWith('.png')) && 
            targetPrefixes.some(prefix => f.startsWith(prefix))
        );

        if (matchingFiles.length === 0) return null;
        matchingFiles.sort();

        let selectedImage = null;
        let largestImage = null;
        let maxSize = 0;

        for (const file of matchingFiles) {
            const fullPath = path.join(screenshotsDir, file);
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > maxSize) {
                maxSize = stat.size;
                largestImage = file;
            }
            if (!selectedImage && stat.size > 100000) {
                selectedImage = file;
            }
        }

        const finalImage = selectedImage || largestImage;
        if (finalImage) {
            const fullPath = path.join(screenshotsDir, finalImage);
            const buffer = await fs.promises.readFile(fullPath);
            return { success: true, buffer: new Uint8Array(buffer) };
        }
    } catch (e) {
        return null;
    }

    return null;
}

export async function deleteRecordingAsync(filePath, outputDir) {
    try {
        await fs.promises.access(filePath);
        const baseName = path.parse(filePath).name;
        const dir = path.dirname(filePath);

        // Read metadata if available to get folderName
        let folderName = baseName;
        try {
            const metaContent = await fs.promises.readFile(path.join(dir, baseName + '.json'), 'utf8');
            const meta = JSON.parse(metaContent);
            if (meta.folderName) folderName = meta.folderName;
        } catch (e) { /* ignore */ }

        // Delete primary file
        await fs.promises.unlink(filePath);

        // Delete associated sidecars (.json, .md, alternative webm/mp3)
        const extensions = ['.json', '.md', filePath.endsWith('.mp3') ? '.webm' : '.mp3'];
        for (const ext of extensions) {
            const relatedPath = path.join(dir, baseName + ext);
            try {
                await fs.promises.access(relatedPath);
                await fs.promises.unlink(relatedPath);
            } catch (e) { /* ignore if doesn't exist */ }
        }

        // Helper to delete matching images in a directory
        const deleteMatchingImagesInDir = async (targetDir) => {
            if (!targetDir) return;
            try {
                const files = await fs.promises.readdir(targetDir);
                for (const file of files) {
                    const isImg = file.endsWith('.jpg') || file.endsWith('.png');
                    if (isImg && (file.startsWith(baseName) || (folderName && file.startsWith(folderName)))) {
                        try {
                            await fs.promises.unlink(path.join(targetDir, file));
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
        };

        // Delete associated screenshots/prints starting with baseName or folderName in dir
        await deleteMatchingImagesInDir(dir);

        // Delete associated screenshots/prints in outputDir/screenshots
        const effectiveOutputDir = outputDir || path.dirname(dir);
        if (effectiveOutputDir) {
            await deleteMatchingImagesInDir(path.join(effectiveOutputDir, 'screenshots'));
        }

        return { success: true };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
    }
}

export async function archiveRecordingsAsync(outputDir, archivePath, olderThanDays) {
    if (!outputDir || !archivePath) {
        return { success: false, error: 'Diretório de saída ou archive não configurado.' };
    }

    try {
        await fs.promises.mkdir(archivePath, { recursive: true });
    } catch (e) { /* ignore */ }

    const now = Date.now();
    const cutoff = now - (olderThanDays || 30) * 24 * 60 * 60 * 1000;
    let movedCount = 0;

    async function archiveDir(currentPath, relativePath) {
        try {
            await fs.promises.access(currentPath);
        } catch { return; }

        const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(currentPath, item.name);

            if (item.isDirectory()) {
                if (item.name === 'screenshots') continue;
                await archiveDir(fullPath, path.join(relativePath, item.name));
                try {
                    const remaining = await fs.promises.readdir(fullPath);
                    if (remaining.length === 0) {
                        await fs.promises.rmdir(fullPath);
                    }
                } catch (e) { /* ignore */ }
            } else if (item.name.endsWith('.mp3') || item.name.endsWith('.webm') || item.name.endsWith('.json') || item.name.endsWith('.md') || item.name.endsWith('.jpg') || item.name.endsWith('.png')) {
                const stat = await fs.promises.stat(fullPath);
                if (stat.mtimeMs < cutoff) {
                    const destDir = path.join(archivePath, relativePath);
                    await fs.promises.mkdir(destDir, { recursive: true });
                    const destPath = path.join(destDir, item.name);
                    await fs.promises.rename(fullPath, destPath);
                    movedCount++;
                }
            }
        }
    }

    try {
        await archiveDir(outputDir, '');
        return { success: true, movedCount };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function reorganizeFilesAsync(outputDir, pathTemplate, resolveTemplateFn) {
    if (!outputDir) return { success: false, error: 'Diretório de saída não configurado.' };

    let reorgCount = 0;

    async function scanAndMove(currentPath) {
        try {
            await fs.promises.access(currentPath);
        } catch { return; }

        const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(currentPath, item.name);

            if (item.isDirectory()) {
                if (item.name === 'archive' || item.name === 'screenshots') continue;
                await scanAndMove(fullPath);
                try {
                    const remaining = await fs.promises.readdir(fullPath);
                    if (remaining.length === 0) {
                        await fs.promises.rmdir(fullPath);
                    }
                } catch (e) { /* ignore */ }
            } else if (item.name.endsWith('.json')) {
                try {
                    const metaStr = await fs.promises.readFile(fullPath, 'utf8');
                    const metadata = JSON.parse(metaStr);
                    const baseName = path.parse(item.name).name;
                    const resolvedDir = resolveTemplateFn(pathTemplate, metadata);
                    const targetDir = path.join(outputDir, resolvedDir);

                    if (path.dirname(fullPath) !== targetDir) {
                        await fs.promises.mkdir(targetDir, { recursive: true });

                        const extensions = ['.mp3', '.webm', '.json', '.md'];
                        for (const ext of extensions) {
                            const relatedFile = path.join(currentPath, baseName + ext);
                            try {
                                await fs.promises.access(relatedFile);
                                const destFile = path.join(targetDir, baseName + ext);
                                await fs.promises.rename(relatedFile, destFile);
                                reorgCount++;
                            } catch (e) { /* ignore missing */ }
                        }

                        // Also move matching images/prints
                        try {
                            const files = await fs.promises.readdir(currentPath);
                            for (const f of files) {
                                if (f.startsWith(baseName) && (f.endsWith('.jpg') || f.endsWith('.png'))) {
                                    const srcImg = path.join(currentPath, f);
                                    const destImg = path.join(targetDir, f);
                                    await fs.promises.rename(srcImg, destImg);
                                    reorgCount++;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) {
                    console.error('Error reading metadata for reorg:', e);
                }
            }
        }
    }

    try {
        await scanAndMove(outputDir);
        return { success: true, reorgCount };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function renameRecordingAsync(outputDir, oldFilePath, newTitle) {
    if (!oldFilePath) {
        return { success: false, error: 'Caminho do arquivo não fornecido.' };
    }
    const cleanTitle = (newTitle || '').trim();
    if (!cleanTitle) {
        return { success: false, error: 'O título não pode ser vazio.' };
    }

    try {
        await fs.promises.access(oldFilePath);
    } catch {
        return { success: false, error: 'Arquivo original não encontrado.' };
    }

    try {
        const dir = path.dirname(oldFilePath);
        const parsed = path.parse(oldFilePath);
        const oldExt = parsed.ext; // .mp3 or .webm
        const oldBaseName = parsed.name;

        // Sanitiza o título para nome de arquivo no Windows
        const safeTitle = cleanTitle.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');

        // Detecta se existe carimbo cronológico na base do arquivo (ex: 20260905_1430 ou 2026-09-05_1430)
        const timestampMatch = oldBaseName.match(/^(\d{8}_\d{4,6}|\d{4}-\d{2}-\d{2}[_T-]?\d{0,6}|\d{13,14})(_|$)/);
        let newBaseName = '';
        if (timestampMatch) {
            const prefix = timestampMatch[1];
            newBaseName = `${prefix}_${safeTitle}`;
        } else {
            newBaseName = safeTitle;
        }

        // Se o nome gerado for vazio (ex: só continha caracteres inválidos), define um fallback
        if (!newBaseName || newBaseName === '_') {
            newBaseName = `Gravacao_${Date.now()}`;
        }

        // Evitar colisão se outro arquivo já existir com o mesmo newBaseName
        let finalBaseName = newBaseName;
        let counter = 1;
        while (
            finalBaseName !== oldBaseName &&
            (fs.existsSync(path.join(dir, finalBaseName + oldExt)) ||
             fs.existsSync(path.join(dir, finalBaseName + '.json')))
        ) {
            finalBaseName = `${newBaseName}_${counter}`;
            counter++;
        }

        const newPrimaryPath = path.join(dir, finalBaseName + oldExt);

        // 1. Ler e atualizar Metadados (.json)
        const oldJsonPath = path.join(dir, oldBaseName + '.json');
        const newJsonPath = path.join(dir, finalBaseName + '.json');
        let metadata = {};

        if (fs.existsSync(oldJsonPath)) {
            try {
                const metaStr = await fs.promises.readFile(oldJsonPath, 'utf8');
                metadata = JSON.parse(metaStr);
            } catch (e) {
                metadata = {};
            }
        }

        metadata.title = cleanTitle;
        const oldFolderName = metadata.folderName;
        let newFolderName = finalBaseName;
        if (oldFolderName) {
            const folderTsMatch = oldFolderName.match(/^(\d{8}_\d{4,6}|\d{4}-\d{2}-\d{2}[_T-]?\d{0,6}|\d{13,14})(_|$)/);
            if (folderTsMatch) {
                newFolderName = `${folderTsMatch[1]}_${safeTitle}`;
            }
            metadata.folderName = newFolderName;
        } else {
            metadata.folderName = finalBaseName;
        }

        // 2. Se o nome da base mudou, renomear arquivos físicos
        if (finalBaseName !== oldBaseName) {
            // Renomeia o arquivo principal (.mp3 ou .webm)
            await fs.promises.rename(oldFilePath, newPrimaryPath);

            // Renomeia sidecar alternativo (.webm <-> .mp3) se existir
            const altExt = oldExt.toLowerCase() === '.mp3' ? '.webm' : '.mp3';
            const oldAltPath = path.join(dir, oldBaseName + altExt);
            const newAltPath = path.join(dir, finalBaseName + altExt);
            if (fs.existsSync(oldAltPath)) {
                try {
                    await fs.promises.rename(oldAltPath, newAltPath);
                } catch (e) { /* ignore */ }
            }

            // Escreve o novo .json e apaga o antigo
            await fs.promises.writeFile(newJsonPath, JSON.stringify(metadata, null, 2), 'utf8');
            if (fs.existsSync(oldJsonPath) && oldJsonPath !== newJsonPath) {
                try {
                    await fs.promises.unlink(oldJsonPath);
                } catch (e) { /* ignore */ }
            }

            // Renomeia e atualiza o .md se existir
            const oldMdPath = path.join(dir, oldBaseName + '.md');
            const newMdPath = path.join(dir, finalBaseName + '.md');
            if (fs.existsSync(oldMdPath)) {
                try {
                    await fs.promises.rename(oldMdPath, newMdPath);
                } catch (e) { /* ignore */ }
            }
            await generateOrUpdateMarkdownSidecar(newMdPath, metadata);

            // Renomeia prints/screenshots associados no diretório da gravação e na pasta única screenshots/
            const renameMatchingImagesInDir = async (targetDir) => {
                if (!targetDir) return;
                try {
                    await fs.promises.access(targetDir);
                    const dirFiles = await fs.promises.readdir(targetDir);
                    for (const file of dirFiles) {
                        const isImg = file.endsWith('.jpg') || file.endsWith('.png');
                        if (!isImg) continue;

                        let newImgName = null;
                        if (file.startsWith(oldBaseName)) {
                            newImgName = file.replace(oldBaseName, finalBaseName);
                        } else if (oldFolderName && file.startsWith(oldFolderName)) {
                            newImgName = file.replace(oldFolderName, newFolderName);
                        }

                        if (newImgName && newImgName !== file) {
                            const oldImgPath = path.join(targetDir, file);
                            const newImgPath = path.join(targetDir, newImgName);
                            try {
                                await fs.promises.rename(oldImgPath, newImgPath);
                            } catch (e) { /* ignore */ }
                        }
                    }
                } catch (e) { /* ignore */ }
            };

            await renameMatchingImagesInDir(dir);
            if (outputDir) {
                await renameMatchingImagesInDir(path.join(outputDir, 'screenshots'));
            }
        } else {
            // Mesma base de arquivo, apenas atualiza .json e .md
            await fs.promises.writeFile(newJsonPath, JSON.stringify(metadata, null, 2), 'utf8');
            const mdPath = path.join(dir, finalBaseName + '.md');
            await generateOrUpdateMarkdownSidecar(mdPath, metadata);
        }

        return {
            success: true,
            newPath: newPrimaryPath,
            newName: path.basename(newPrimaryPath),
            newTitle: cleanTitle
        };
    } catch (err) {
        console.error('Erro ao renomear gravação:', err);
        return { success: false, error: err.message };
    }
}

