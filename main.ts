import { App, Plugin, WorkspaceLeaf, PluginSettingTab, Setting } from 'obsidian';

// 底层默认的硬核屏蔽词库
const STOP_WORDS = new Set([
    '因此', '通过', '可以', '一个', '没有', '我们', '什么', '这个', '如果是', 
    '怎么', '如果', '可以说', '这样', '很多', '非常', '进行', '然后', '可能', 
    '因为', '所以', '各位', '谢谢', '由于', '其实', '只要', '目前', '开始', 
    '自己', '就是', '需要', '问题', '产生', '使用', '发现', '这种', '那些',
    '也是', '一样', '知道', '觉得', '时候'
]);

const FALLBACK_WORDS = [
    {word: '液冷技术', value: 10}, {word: '热管理', value: 9}, {word: '自动化', value: 9},
    {word: '系统架构', value: 8}, {word: '储能', value: 8}, {word: '服务器', value: 7},
    {word: '工作流', value: 7}, {word: '数据分析', value: 6}, {word: '性能测试', value: 6},
    {word: '核心控制', value: 5}, {word: '结构设计', value: 5}, {word: '新能源', value: 5},
    {word: '效率优化', value: 4}, {word: '解决方案', value: 4}, {word: '精密加工', value: 4},
    {word: '工艺', value: 3}, {word: '节点', value: 3}, {word: '策略', value: 3},
    {word: '矩阵', value: 2}, {word: '参数', value: 2}, {word: '模型', value: 2}
];

interface SphereNode {
    el: HTMLElement;
    lx: number; ly: number; lz: number; 
    zRatio: number;
}

// ✨ 新增：设置数据接口
interface MobilePluginSettings {
    customStopWords: string[];
    hotwordFolder: string;
    hotwordDays: number;
}

const DEFAULT_SETTINGS: MobilePluginSettings = {
    customStopWords: [],
    hotwordFolder: "",
    hotwordDays: 30
};

// 屏蔽词数量上限:防止词过多导致词云噪音与设置面板过长
const MAX_STOP_WORDS = 50;

// ✨ v1.0.6 界面双语：跟随 Obsidian 界面语言(zh=中文,其他=英文)
function getLang(): 'zh' | 'en' {
    const lang = (window.localStorage.getItem('language') || 'en').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
}

function createI18n() {
    const zh = {
        settingsTitle: 'Thought Synapse (移动版) 设置',
        folder: '检索文件夹 (留空 = 全库)',
        folderDesc: '只统计这些文件夹(含子文件夹)内最近修改的笔记，多个文件夹用逗号分隔，如：日记, 灵感捕捉。留空则扫描整个仓库。',
        folderPlaceholder: '例如: 日记, 灵感捕捉',
        days: '近期范围 (天)',
        daysDesc: '只统计最近 N 天内修改过的笔记的用词，默认 30 天。修改笔记或设置后词云会自动刷新。',
        stopwords: '自定义屏蔽词汇',
        stopDesc: '输入词后点「添加」或按回车，可连续输入；点标签上的 × 可取消屏蔽。最多 50 个。',
        inputPlaceholder: '输入要屏蔽的词…',
        add: '添加',
        emptyTags: '暂无屏蔽词',
        msgInvalid: '请输入包含文字或数字的词',
        msgLimit: `最多可屏蔽 ${MAX_STOP_WORDS} 个词，请先移除部分`,
        refreshAria: '重新统计热词',
        removeAria: (w: string) => `取消屏蔽 ${w}`,
        msgDup: (w: string) => `「${w}」已在屏蔽列表中`
    };
    const en = {
        settingsTitle: 'Thought Synapse (Mobile) Settings',
        folder: 'Search folders (empty = whole vault)',
        folderDesc: 'Only analyze recent notes inside these folders (subfolders included). Separate multiple folders with commas, e.g. Journal, Ideas. Leave empty to scan the whole vault.',
        folderPlaceholder: 'e.g. Journal, Ideas',
        days: 'Recent window (days)',
        daysDesc: 'Only analyze words from notes modified within the last N days. Default: 30. The word sphere refreshes automatically after edits.',
        stopwords: 'Custom stop words',
        stopDesc: 'Type a word and tap Add (or press Enter) — input continuously; tap × on a tag to unblock. Up to 50 words.',
        inputPlaceholder: 'Type a word to block…',
        add: 'Add',
        emptyTags: 'No stop words yet',
        msgInvalid: 'Please enter a word containing letters, CJK characters or digits',
        msgLimit: `Limit of ${MAX_STOP_WORDS} words reached — remove some first`,
        refreshAria: 'Re-analyze hot words',
        removeAria: (w: string) => `Unblock ${w}`,
        msgDup: (w: string) => `"${w}" is already blocked`
    };
    const lang = getLang();
    return lang === 'zh' ? zh : en;
}
type I18n = ReturnType<typeof createI18n>;

class WordSphereDecorativeEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    velocityX = 0.0025; 
    velocityY = 0.0025;

    animationFrameId: number = 0;
    isActive = true;
    
    visualOffsetY = 15; 

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = activeDocument.createElement('canvas');
        this.canvas.addClass('ts-mobile-canvas');
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();

        const ResizeObserverAPI = window.ResizeObserver;
        if (ResizeObserverAPI) {
            const observer = new ResizeObserverAPI(() => this.handleResize());
            observer.observe(this.container);
        }
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const safeRadiusWidth = (rect.width / 2) - 20; 
        const safeRadiusHeight = (rect.height / 2) - 20;
        let newRadius = Math.min(safeRadiusWidth, safeRadiusHeight);
        newRadius = Math.max(newRadius, 40); 

        if (this.radius > 0 && this.tags.length > 0 && this.radius !== newRadius) {
            const scaleFactor = newRadius / this.radius;
            this.tags.forEach(tag => {
                tag.lx *= scaleFactor;
                tag.ly *= scaleFactor;
                tag.lz *= scaleFactor;
            });
        }
        
        this.radius = newRadius;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }

    addTag(tagEl: HTMLElement) {
        tagEl.addClass('ts-mobile-word');
        
        this.tags.push({
            el: tagEl,
            lx: 0, ly: 0, lz: 0, 
            zRatio: 0,
        });
        
        this.container.appendChild(tagEl);
    }

    initPositions() {
        const total = this.tags.length;
        if (total === 0) return;
        
        const offset = 2 / total; 
        const increment = Math.PI * (3 - Math.sqrt(5));
        
        this.tags.forEach((tag, i) => {
            const y = ((i * offset) - 1) + (offset / 2);
            const r = Math.sqrt(1 - y * y);
            const phi = i * increment;
            
            tag.lx = Math.cos(phi) * r * this.radius;
            tag.ly = y * this.radius;
            tag.lz = Math.sin(phi) * r * this.radius;
            tag.zRatio = tag.lz / this.radius;
        });
    }

    startAnimation() {
        if (this.tags.length === 0) return;
        
        this.initPositions();

        const getComputedColor = (cssVar: string, fallback: string) => {
            const val = getComputedStyle(activeDocument.body).getPropertyValue(cssVar).trim();
            return val || fallback;
        };

        const animate = () => {
            if (!this.isActive) return;

            this.ctx.clearRect(0, 0, this.width, this.height);
            const cx = this.width / 2;
            const cy = (this.height / 2) + this.visualOffsetY;

            const colorNormal = getComputedColor('--text-normal', '#333333');
            const neutralLineColor = '128, 128, 128'; 

            this.tags.forEach(tag => {
                const x1 = tag.lx * Math.cos(this.velocityY) - tag.lz * Math.sin(this.velocityY);
                const z1 = tag.lz * Math.cos(this.velocityY) + tag.lx * Math.sin(this.velocityY);
                const y1 = tag.ly * Math.cos(this.velocityX) - z1 * Math.sin(this.velocityX);
                const z2 = z1 * Math.cos(this.velocityX) + tag.ly * Math.sin(this.velocityX);
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
                tag.zRatio = z2 / this.radius;
            });

            const renderList = [...this.tags].sort((a, b) => a.lz - b.lz);

            renderList.forEach(item => {
                if (item.lz >= 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 2, 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            renderList.forEach(item => {
                if (item.lz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            renderList.forEach(item => {
                const tag = item;
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                
                if (item.zRatio > 0.4) {
                    baseOpacity = 0.9; blur = 0; color = 'var(--text-normal)'; 
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.4 + 0.5 * (item.zRatio / 0.4); blur = 0; color = 'var(--text-muted)'; 
                } else {
                    baseOpacity = 0.1 + 0.3 * ((item.zRatio + 1) / 1); 
                    blur = Math.min(2.0, Math.abs(item.zRatio) * 2.0); color = 'var(--text-faint)';
                }

                const depthScale = 0.6 + 0.5 * ((this.radius + tag.lz) / (2 * this.radius)); 
                
                const baseTransform = `translate(-50%, -50%) translate3d(${tag.lx}px, ${tag.ly + this.visualOffsetY}px, 0px)`;
                
                tag.el.style.transform = `${baseTransform} scale(${depthScale})`;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.lz + this.radius).toString();
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string) {
        let depthOpacity = 0;
        let depthWidth = 0.3;
        
        if (item.zRatio > 0) {
            depthOpacity = 0.05 + 0.12 * item.zRatio; 
            depthWidth = 0.3 + 0.3 * item.zRatio;
        } else {
            depthOpacity = 0.05 * (1 - Math.abs(item.zRatio)); 
            depthWidth = 0.3;
        }

        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.lx, cy + item.ly);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);
        this.ctx.strokeStyle = `rgba(${neutralRGB}, ${depthOpacity})`;
        this.ctx.stroke();
        this.ctx.restore();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) window.cancelAnimationFrame(this.animationFrameId);
    }
}

// ✨ 核心修改：分析数据时，将用户设置的自定义屏蔽词与底层屏蔽词合并
// ✨ 本次升级：支持指定文件夹检索近期热词（只统计这些文件夹内、最近 N 天修改过的笔记）
// ✨ v1.0.6 多文件夹：检索文件夹支持逗号分隔多个，如 "日记, 灵感捕捉"
async function analyzeDecorativeData(app: App, settings: MobilePluginSettings) {
    try {
        const folderPrefixes = (settings.hotwordFolder || "")
            .split(/[,，]/)
            .map(p => p.trim().replace(/\/+$/, ""))
            .filter(p => p.length > 0);
        const days = Math.max(1, settings.hotwordDays || 30);
        const since = Date.now() - days * 24 * 60 * 60 * 1000;

        const files = app.vault.getMarkdownFiles()
            .filter(f => folderPrefixes.length === 0 || folderPrefixes.some(p => f.path === p || f.path.startsWith(p + "/")))
            .filter(f => f.stat.mtime >= since)
            .sort((a, b) => b.stat.mtime - a.stat.mtime)
            .slice(0, 80); // 移动端性能保护：最多精读最近 80 篇
        if (files.length === 0) return FALLBACK_WORDS;

        const wordData = new Map<string, number>();

        // 用户自定义屏蔽词（v1.0.4 起为词数组,由标签式设置页维护）
        const customStopWordsSet = new Set(settings.customStopWords);

        for (const file of files) {
            const content = await app.vault.cachedRead(file);
            const matches = content.match(/[\u4e00-\u9fa5]{2,5}/g) || [];
            
            for (const w of matches) {
                // 如果命中默认词库 或 命中用户自定义词库，则跳过
                if (STOP_WORDS.has(w) || customStopWordsSet.has(w)) continue;
                wordData.set(w, (wordData.get(w) || 0) + 1);
            }
        }

        const results = Array.from(wordData.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 32) 
            .map(([word, value]) => ({ word, value }));

        if (results.length < 15) return FALLBACK_WORDS;
        return results;
    } catch (e) {
        return FALLBACK_WORDS;
    }
}

export default class MobileStatsPlugin extends Plugin {
    settings: MobilePluginSettings; // ✨ 新增设置变量
    sphereEngine: WordSphereDecorativeEngine | null = null;
    injectedContainer: HTMLElement | null = null;
    cachedWords: {word: string, value: number}[] | null = null;
    
    mutationObserver: MutationObserver | null = null;
    currentObserverTarget: HTMLElement | null = null;
    rebuildTimer: number | null = null;

    async onload() {
        await this.loadSettings();
        
        // 注册设置面板
        this.addSettingTab(new MobileStatsSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(async () => {
            this.cachedWords = await analyzeDecorativeData(this.app, this.settings);
            this.observeAndInject();
        });

        // ✨ v1.0.6 自动刷新：笔记有增删改后，静置 90 秒(防抖)自动重算词云——
        // 用户正常书写时完全不打扰，停下笔一小会儿词球就悄悄跟上最新内容
        let vaultChangeTimer: number | null = null;
        const scheduleVaultRefresh = () => {
            if (vaultChangeTimer) window.clearTimeout(vaultChangeTimer);
            vaultChangeTimer = window.setTimeout(() => { void this.refreshSphere(); }, 90_000);
        };
        this.registerEvent(this.app.vault.on('modify', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('create', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('delete', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('rename', scheduleVaultRefresh));

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.observeAndInject();
        }));
        
        this.registerEvent(this.app.workspace.on('file-open', () => {
            this.observeAndInject();
        }));
    }

    // ✨ 加载与保存设置
    async loadSettings() {
        const data = await this.loadData() as Partial<MobilePluginSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

        // 兼容迁移：v1.0.3 及之前 customStopWords 为逗号/空格分隔的字符串
        const legacy = data?.customStopWords as unknown;
        if (typeof legacy === 'string') {
            this.settings.customStopWords = legacy.split(/[,，\s]+/).filter(w => w.trim().length > 0);
        }
        if (!Array.isArray(this.settings.customStopWords)) {
            this.settings.customStopWords = [];
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        
        // ✨ v1.0.5 防抖：连续修改设置（如逐个添加屏蔽词）时，停顿 1 秒后才重建词云，
        // 避免每加一个词就闪烁重建一次，保证连续输入体验
        if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
        this.rebuildTimer = window.setTimeout(() => { void this.refreshSphere(); }, 1000);
    }

    private async refreshSphere() {
        this.cachedWords = await analyzeDecorativeData(this.app, this.settings);
        if (this.injectedContainer) {
            this.injectedContainer.remove();
            this.injectedContainer = null;
        }
        this.observeAndInject();
    }
    
    onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
        this.cachedWords = null;
    }

    // ✨ v1.0.6 手动刷新：立即重算并重建词球(设置变化仍走 1 秒防抖,此处为即时通道)
    manualRefresh() {
        if (this.rebuildTimer) { window.clearTimeout(this.rebuildTimer); this.rebuildTimer = null; }
        void this.refreshSphere();
    }
    
    observeAndInject() {
        try {
            const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
            if (fileExplorerLeaves.length === 0) return; 

            const fileExplorerContainer = fileExplorerLeaves[0].view.containerEl;
            const navContainer = fileExplorerContainer.querySelector('.nav-files-container') as HTMLElement;
            if (!navContainer) return;

            if (!this.injectedContainer) {
                this.buildContainer(navContainer);
            }

            if (!navContainer.contains(this.injectedContainer!)) {
                navContainer.appendChild(this.injectedContainer!);
            }

            if (this.currentObserverTarget !== navContainer) {
                if (this.mutationObserver) this.mutationObserver.disconnect();
                
                this.mutationObserver = new MutationObserver(() => {
                    if (this.injectedContainer && !navContainer.contains(this.injectedContainer)) {
                        navContainer.appendChild(this.injectedContainer);
                    }
                });
                
                this.mutationObserver.observe(navContainer, { childList: true });
                this.currentObserverTarget = navContainer;
            }

        } catch (e) {
            console.error("Topology Observer Error: ", e);
        }
    }

    buildContainer(navContainer: HTMLElement) {
        if (this.sphereEngine) this.sphereEngine.destroy();

        this.injectedContainer = activeDocument.createElement('div');
        this.injectedContainer.addClass('ts-mobile-parasitic-container');

        // ✨ v1.0.6 手动刷新按钮(右上角,不遮挡文件列表)
        const i18n = createI18n();
        const refreshBtn = this.injectedContainer.createSpan({ text: '↻', cls: 'ts-mobile-refresh-btn', attr: { 'aria-label': i18n.refreshAria } });
        refreshBtn.onclick = (e) => { e.stopPropagation(); this.manualRefresh(); };

        const heatmapDiv = this.injectedContainer.createDiv();
        heatmapDiv.addClass('ts-mobile-heatmap-div');

        navContainer.appendChild(this.injectedContainer);
        
        const heatmapWords = this.cachedWords || FALLBACK_WORDS;
        if (heatmapWords.length === 0) return;

        const maxWordCount = heatmapWords[0].value;
        const baseRadius = Math.max((heatmapDiv.clientWidth / 2) * 0.75, 55); 

        this.sphereEngine = new WordSphereDecorativeEngine(heatmapDiv, baseRadius);

        heatmapWords.forEach(({word, value}) => {
            const wordEl = activeDocument.createElement('div');
            wordEl.innerText = word;
            
            const fontSize = Math.max(11, Math.min(21, 11 + (value/maxWordCount)*10));
            const fontWeight = value > maxWordCount * 0.5 ? '700' : '400'; 

            wordEl.style.fontSize = `${fontSize}px`;
            wordEl.style.fontWeight = fontWeight;
            
            this.sphereEngine!.addTag(wordEl);
        });

        this.sphereEngine.startAnimation();
    }
}

// ✨ 新增：移动端插件设置面板
class MobileStatsSettingTab extends PluginSettingTab {
    plugin: MobileStatsPlugin;

    constructor(app: App, plugin: MobileStatsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ✨ v1.0.6 界面双语：跟随 Obsidian 界面语言自动切换
        const t = createI18n();

        new Setting(containerEl).setName(t.settingsTitle).setHeading();

        new Setting(containerEl)
            .setName(t.folder)
            .setDesc(t.folderDesc)
            .addText(text => {
                text
                    .setPlaceholder(t.folderPlaceholder)
                    .setValue(this.plugin.settings.hotwordFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.hotwordFolder = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(t.days)
            .setDesc(t.daysDesc)
            .addText(text => {
                text
                    .setPlaceholder('30')
                    .setValue(String(this.plugin.settings.hotwordDays))
                    .onChange(async (value) => {
                        const n = parseInt(value);
                        if (!isNaN(n) && n > 0) {
                            this.plugin.settings.hotwordDays = n;
                            await this.plugin.saveSettings();
                        }
                    });
            });

        // ✨ v1.0.5 标签式屏蔽词管理：连续输入、去重提示、数量上限(50)、限高滚动
        new Setting(containerEl)
            .setName(t.stopwords)
            .setHeading()
            .setDesc(t.stopDesc);

        const manager = containerEl.createDiv('stopword-manager');
        const inputRow = manager.createDiv('stopword-input-row');
        const wordInput = inputRow.createEl('input', {
            cls: 'stopword-input',
            type: 'text',
            attr: { placeholder: t.inputPlaceholder, 'aria-label': t.inputPlaceholder }
        });
        const addBtn = inputRow.createEl('button', { cls: 'stopword-add-btn', text: t.add });

        const metaRow = manager.createDiv('stopword-meta-row');
        const msgEl = metaRow.createDiv({ cls: 'stopword-msg', text: '' });
        const counterEl = metaRow.createDiv({ cls: 'stopword-counter' });
        const tagsWrap = manager.createDiv('stopword-tags');

        let msgTimer: number | null = null;
        const flashMsg = (text: string) => {
            msgEl.setText(text);
            msgEl.addClass('is-visible');
            if (msgTimer) window.clearTimeout(msgTimer);
            msgTimer = window.setTimeout(() => msgEl.removeClass('is-visible'), 2000);
        };

        // animateWord: 只有刚添加的词播放入场动画，其余标签保持静止（解决"每加一个闪一下"）
        const renderTags = (animateWord?: string) => {
            const words = this.plugin.settings.customStopWords;
            counterEl.setText(`${words.length} / ${MAX_STOP_WORDS}`);
            tagsWrap.empty();
            if (words.length === 0) {
                tagsWrap.createDiv({ cls: 'stopword-empty', text: t.emptyTags });
                return;
            }
            words.forEach(word => {
                const chip = tagsWrap.createDiv('stopword-chip');
                if (animateWord && word === animateWord) chip.addClass('is-new');
                chip.createSpan({ text: word, cls: 'stopword-chip-text' });
                const removeBtn = chip.createSpan({ text: '×', cls: 'stopword-chip-remove', attr: { 'aria-label': t.removeAria(word) } });
                removeBtn.onclick = () => {
                    void (async () => {
                        this.plugin.settings.customStopWords = words.filter(w => w !== word);
                        await this.plugin.saveSettings();
                        renderTags();
                    })();
                };
            });
        };

        const addWord = () => {
            void (async () => {
                const word = wordInput.value.trim();
                if (!word) return;
                // 过滤纯符号（如单独的逗号、句号）
                if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(word)) {
                    flashMsg(t.msgInvalid);
                    return;
                }
                const words = this.plugin.settings.customStopWords;
                if (words.includes(word)) {
                    flashMsg(t.msgDup(word));
                    wordInput.value = '';
                    return;
                }
                if (words.length >= MAX_STOP_WORDS) {
                    flashMsg(t.msgLimit);
                    return;
                }
                words.push(word);
                await this.plugin.saveSettings();
                wordInput.value = '';
                renderTags(word);
                wordInput.focus();
            })();
        };

        // 点击按钮时不让输入框失焦（键盘保持弹出，实现连续输入）
        addBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        addBtn.onclick = () => addWord();
        wordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addWord(); }
        });

        renderTags();
    }
}
