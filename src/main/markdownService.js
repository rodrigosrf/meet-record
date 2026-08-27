import fs from 'fs';
import path from 'path';

/**
 * Formata duração em milissegundos para HH:MM:SS
 */
export function formatDuration(durationMs) {
    const totalSeconds = Math.floor((Number(durationMs) || 0) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Formata data ISO ou Date para o padrão pt-BR
 */
export function formatDate(dateVal) {
    try {
        const d = dateVal ? new Date(dateVal) : new Date();
        if (!isNaN(d.getTime())) {
            return d.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    } catch (e) { /* ignore */ }
    return new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Formata lista de tags para o padrão markdown (#tag1, #tag2)
 */
export function formatTagsList(tags) {
    if (!tags) return '';
    const arr = Array.isArray(tags) ? tags : [tags];
    const cleaned = arr
        .filter(t => t && typeof t === 'string' && t.trim().length > 0)
        .map(t => '#' + t.replace(/^#+/, '').trim());
    return Array.from(new Set(cleaned)).join(', ');
}

/**
 * Extrai hashtags a partir de um texto comum
 */
export function extractHashtags(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(/#([a-zA-Z0-9_\u00C0-\u017F-]+)/g);
    if (!matches) return [];
    return Array.from(new Set(matches.map(m => m.replace(/^#/, '').trim())));
}

/**
 * Cria ou atualiza o arquivo Markdown sidecar (.md) associado a uma gravação.
 * Preserva o conteúdo existente (notas, títulos) e sincroniza as tags.
 *
 * @param {string} mdPath Caminho absoluto do arquivo .md
 * @param {object} metadata Metadados da gravação (title, date, duration, note, tags)
 * @returns {Promise<boolean>}
 */
export async function generateOrUpdateMarkdownSidecar(mdPath, metadata = {}) {
    if (!mdPath) return false;

    try {
        const tags = metadata.tags !== undefined ? metadata.tags : [];
        const formattedTags = formatTagsList(tags);
        const hasTags = formattedTags.length > 0;
        const hasNote = Boolean(metadata.note && metadata.note.trim());

        const exists = fs.existsSync(mdPath);

        if (exists) {
            let content = await fs.promises.readFile(mdPath, 'utf8');

            if (metadata.tags !== undefined) {
                const tagsRegex = /^\*\*Tags:\*\*.*$/m;
                if (hasTags) {
                    const tagLine = `**Tags:** ${formattedTags}`;
                    if (tagsRegex.test(content)) {
                        content = content.replace(tagsRegex, tagLine);
                    } else if (/^\*\*Duração:\*\*.*$/m.test(content)) {
                        content = content.replace(/^(\*\*Duração:\*\*.*$)/m, `$1\n${tagLine}`);
                    } else if (/^\*\*Data:\*\*.*$/m.test(content)) {
                        content = content.replace(/^(\*\*Data:\*\*.*$)/m, `$1\n${tagLine}`);
                    } else if (/^# .*$/m.test(content)) {
                        content = content.replace(/^(# .*$)/m, `$1\n\n${tagLine}`);
                    } else {
                        content = `${tagLine}\n\n${content}`;
                    }
                } else {
                    // Remover linha de tags se lista ficou vazia
                    content = content.replace(/^\*\*Tags:\*\*.*(?:\r?\n)?/m, '');
                }
            }

            await fs.promises.writeFile(mdPath, content, 'utf8');
            return true;
        } else {
            // Se o arquivo ainda não existe, só criamos se houver tags ou notas
            if (!hasTags && !hasNote) {
                return false;
            }

            const formattedDate = formatDate(metadata.date);
            const formattedDuration = formatDuration(metadata.duration);
            const title = metadata.title || path.parse(mdPath).name || 'Sem Título';
            const noteText = hasNote ? metadata.note.trim() : '_Nenhuma nota registrada._';
            const tagLine = hasTags ? `\n**Tags:** ${formattedTags}` : '';

            const mdContent = `# ${title}

**Data:** ${formattedDate}
**Duração:** ${formattedDuration}${tagLine}

---

## Notas da Reunião
${noteText}
`;

            await fs.promises.mkdir(path.dirname(mdPath), { recursive: true });
            await fs.promises.writeFile(mdPath, mdContent, 'utf8');
            return true;
        }
    } catch (err) {
        console.error('Erro ao gerar/atualizar arquivo Markdown sidecar:', err);
        return false;
    }
}
