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

export async function getRecordingThumbnailAsync(outputDir, folderName, recPath) {
    if (!outputDir || !folderName) return null;

    const findImageInDir = async (dirPath) => {
        try {
            await fs.promises.access(dirPath);
            const files = await fs.promises.readdir(dirPath);
            const matchingFiles = files.filter(f => (f.endsWith('.jpg') || f.endsWith('.png')) && f.startsWith(folderName));

            if (matchingFiles.length === 0) return null;
            matchingFiles.sort();

            let selectedImage = null;
            let largestImage = null;
            let maxSize = 0;

            for (const file of matchingFiles) {
                const fullPath = path.join(dirPath, file);
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
                const fullPath = path.join(dirPath, finalImage);
                const buffer = await fs.promises.readFile(fullPath);
                return { success: true, buffer: new Uint8Array(buffer) };
            }
        } catch (e) {
            return null;
        }
        return null;
    };

    // 1. Try directory of recPath if provided
    if (recPath) {
        const recDir = path.dirname(recPath);
        const result = await findImageInDir(recDir);
        if (result) return result;
    }

    // 2. Recursive scan in outputDir
    async function scanForImage(currentPath) {
        try {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'archive') continue;
                    const res = await findImageInDir(fullPath);
                    if (res) return res;
                    const subRes = await scanForImage(fullPath);
                    if (subRes) return subRes;
                }
            }
        } catch (e) {}
        return null;
    }

    return await scanForImage(outputDir);
}

export async function migrateImagesDirectoryAsync(outputDir) {
    if (!outputDir) return;
    const imagesDir = path.join(outputDir, 'images');
    try {
        await fs.promises.access(imagesDir);
    } catch {
        return;
    }

    try {
        const files = await fs.promises.readdir(imagesDir);
        for (const file of files) {
            const srcPath = path.join(imagesDir, file);
            const stat = await fs.promises.stat(srcPath);
            if (stat.isFile() && (file.endsWith('.jpg') || file.endsWith('.png'))) {
                let targetSubDir = '';
                const match = file.match(/^(\d{4})(\d{2})(\d{2})/);
                if (match) {
                    targetSubDir = `${match[1]}-${match[2]}-${match[3]}`;
                } else {
                    const d = stat.mtime;
                    const pad = n => String(n).padStart(2, '0');
                    targetSubDir = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                }

                const destDir = path.join(outputDir, targetSubDir);
                await fs.promises.mkdir(destDir, { recursive: true });
                const destPath = path.join(destDir, file);
                await fs.promises.rename(srcPath, destPath);
            }
        }

        const remaining = await fs.promises.readdir(imagesDir);
        if (remaining.length === 0) {
            await fs.promises.rmdir(imagesDir);
        }
    } catch (e) {
        console.error('Error migrating images directory:', e);
    }
}

export async function deleteRecordingAsync(filePath) {
    try {
        await fs.promises.access(filePath);
        const baseName = path.parse(filePath).name;
        const dir = path.dirname(filePath);

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

        // Delete associated screenshots/prints starting with baseName in dir
        try {
            const files = await fs.promises.readdir(dir);
            for (const file of files) {
                if (file.startsWith(baseName) && (file.endsWith('.jpg') || file.endsWith('.png'))) {
                    await fs.promises.unlink(path.join(dir, file));
                }
            }
        } catch (e) { /* ignore */ }

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
                if (item.name === 'archive') continue;
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
        if (metadata.folderName && metadata.folderName.startsWith(oldBaseName)) {
            metadata.folderName = metadata.folderName.replace(oldBaseName, finalBaseName);
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

            // Renomeia prints/screenshots associados
            try {
                const dirFiles = await fs.promises.readdir(dir);
                for (const file of dirFiles) {
                    if (file.startsWith(oldBaseName) && (file.endsWith('.jpg') || file.endsWith('.png'))) {
                        const oldImgPath = path.join(dir, file);
                        const newImgName = file.replace(oldBaseName, finalBaseName);
                        const newImgPath = path.join(dir, newImgName);
                        try {
                            await fs.promises.rename(oldImgPath, newImgPath);
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
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

