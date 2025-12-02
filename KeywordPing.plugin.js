/**
 * @name KeywordPing
 * @author Snues
 * @description Get Discord notifications when messages match your keywords. Uses native Discord notifications with click-to-jump support.
 * @version 2.1.0
 * @source https://github.com/Snusene/KeywordPing
 * @updateUrl https://raw.githubusercontent.com/Snusene/KeywordPing/main/KeywordPing.plugin.js
 */

module.exports = class KeywordPing {
    constructor() {
        this.defaultSettings = {
            keywords: [],
            whitelistedUsers: [],
            ignoredUsers: [],
            guilds: {}
        };
        this.settings = null;
        this.currentUserId = null;
        this.css = `
            .kp-settings-panel { padding: 10px; }
            .kp-settings-group { margin-bottom: 20px; }
            .kp-settings-group-title { color: var(--header-secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
            .kp-textarea { width: 100%; min-height: 100px; background: var(--input-background); border: none; border-radius: 4px; padding: 10px; color: var(--text-normal); font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box; }
            .kp-textarea:focus { outline: none; }
            .kp-textarea::placeholder { color: var(--text-muted); }
            .kp-hint { color: var(--text-muted); font-size: 12px; margin-top: 8px; line-height: 1.5; }
            .kp-hint code { background: var(--background-secondary); padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        `;
    }

    getName() { return "KeywordPing"; }
    getDescription() { return "Get Discord notifications when messages match your keywords."; }
    getVersion() { return "2.1.0"; }
    getAuthor() { return "Snues"; }

    start() {
        BdApi.DOM.addStyle(this.getName(), this.css);
        this.loadSettings();
        const UserStore = BdApi.Webpack.getStore("UserStore");
        this.currentUserId = UserStore?.getCurrentUser()?.id;
        this.patchDispatcher();
    }

    stop() {
        BdApi.DOM.removeStyle(this.getName());
        BdApi.Patcher.unpatchAll(this.getName());
        this.saveSettings();
    }

    loadSettings() {
        const saved = BdApi.Data.load(this.getName(), "settings") || {};
        this.settings = {
            keywords: saved.keywords || [],
            whitelistedUsers: saved.whitelistedUsers || [],
            ignoredUsers: saved.ignoredUsers || [],
            guilds: saved.guilds || {}
        };
    }

    saveSettings() {
        BdApi.Data.save(this.getName(), "settings", this.settings);
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "kp-settings-panel";
        panel.appendChild(this.createTextAreaSetting("Keywords", "One keyword per line. Supports regex: /pattern/flags<br>Filters: @userid:keyword, #channelid:keyword, serverid:keyword", this.settings.keywords.join("\n"), (val) => { this.settings.keywords = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        panel.appendChild(this.createTextAreaSetting("Whitelisted Users", "One per line - username, display name, or user ID", this.settings.whitelistedUsers.join("\n"), (val) => { this.settings.whitelistedUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        panel.appendChild(this.createTextAreaSetting("Ignored Users", "One per line - username, display name, or user ID", this.settings.ignoredUsers.join("\n"), (val) => { this.settings.ignoredUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        return panel;
    }

    createTextAreaSetting(title, hint, value, onChange) {
        const group = document.createElement("div");
        group.className = "kp-settings-group";
        const titleEl = document.createElement("div");
        titleEl.className = "kp-settings-group-title";
        titleEl.textContent = title;
        group.appendChild(titleEl);
        const textarea = document.createElement("textarea");
        textarea.className = "kp-textarea";
        textarea.value = value;
        textarea.placeholder = `Enter ${title.toLowerCase()}...`;
        textarea.addEventListener("change", () => onChange(textarea.value));
        group.appendChild(textarea);
        const hintEl = document.createElement("div");
        hintEl.className = "kp-hint";
        hintEl.innerHTML = hint;
        group.appendChild(hintEl);
        return group;
    }

    patchDispatcher() {
        const Dispatcher = BdApi.Webpack.getByKeys("dispatch", "subscribe");
        if (!Dispatcher) return;
        BdApi.Patcher.before(this.getName(), Dispatcher, "dispatch", (_, [event]) => {
            if (event?.type === "MESSAGE_CREATE") this.handleMessage(event);
        });
    }

    handleMessage(event) {
        const { message } = event;
        if (!message?.author || (!message.content && !message.embeds?.length)) return;
        if (event.optimistic) return;
        const ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        const channel = ChannelStore?.getChannel(message.channel_id);
        if (!channel?.guild_id) return;
        if (!message.guild_id) message.guild_id = channel.guild_id;
        if (message.author.id === this.currentUserId) return;
        if (message.author.bot) return;
        if (this.matchesUser(this.settings.ignoredUsers, message.author)) return;
        const guildSettings = this.settings.guilds[channel.guild_id];
        if (guildSettings?.enabled === false) return;
        if (guildSettings?.channels?.[channel.id] === false) return;
        let matched = this.matchesUser(this.settings.whitelistedUsers, message.author);
        if (!matched) {
            for (const keyword of this.settings.keywords) {
                if (!keyword.trim()) continue;
                const result = this.parseKeyword(keyword);
                if (!result) continue;
                if (result.filter && !this.passesFilter(result.filter, message)) continue;
                if (result.regex.test(message.content || "") || message.embeds?.some(e => result.regex.test(JSON.stringify(e)))) {
                    matched = true;
                    break;
                }
            }
        }
        if (matched) {
            const UserStore = BdApi.Webpack.getStore("UserStore");
            const currentUser = UserStore?.getCurrentUser();
            if (currentUser && !message.mentions?.some(m => m.id === currentUser.id)) {
                message.mentions = message.mentions || [];
                message.mentions.push(currentUser);
                message.mentioned = true;
            }
        }
    }

    parseKeyword(keyword) {
        let filter = null, pattern = keyword;
        const filterMatch = /^([@#]?)(\d+):(.+)$/.exec(keyword);
        if (filterMatch) {
            filter = { type: filterMatch[1] || "guild", id: filterMatch[2] };
            pattern = filterMatch[3];
        }
        try {
            const regexMatch = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
            const regex = regexMatch ? new RegExp(regexMatch[1], regexMatch[2]) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
            return { filter, regex };
        } catch { return null; }
    }

    passesFilter(filter, message) {
        if (filter.type === "@") return message.author.id === filter.id;
        if (filter.type === "#") return message.channel_id === filter.id;
        return message.guild_id === filter.id;
    }

    matchesUser(list, author) {
        const username = author.username?.toLowerCase();
        const displayName = (author.globalName || author.global_name)?.toLowerCase();
        return list.some(entry => {
            const e = entry.toLowerCase();
            return author.id === entry || username === e || displayName === e;
        });
    }
};
