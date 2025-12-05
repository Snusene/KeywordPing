/**
 * @name KeywordPing
 * @author Snues
 * @description Get notified when messages match your keywords. Uses the same notification system as @mentions.
 * @version 2.2.0
 * @source https://github.com/Snusene/KeywordPing
 * @updateUrl https://raw.githubusercontent.com/Snusene/KeywordPing/main/KeywordPing.plugin.js
 */

module.exports = class KeywordPing {
    constructor() {
        this.defaultSettings = {
            keywords: [],
            whitelistedUsers: [],
            ignoredUsers: [],
            guilds: {},
            wholeWord: true
        };
        this.settings = null;
        this.currentUserId = null;
        this.UserStore = null;
        this.ChannelStore = null;
        this.css = `
            .kp-settings-panel { padding: 10px; }
            .kp-settings-group { margin-bottom: 20px; }
            .kp-settings-group-title { color: var(--header-secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
            .kp-textarea { width: 100%; min-height: 84px; background: var(--input-background); border: none; border-radius: 4px; padding: 10px; color: var(--text-normal); font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box; }
            .kp-textarea:focus { outline: none; }
            .kp-textarea::placeholder { color: var(--text-muted); }
            .kp-hint { color: var(--text-muted); font-size: 12px; margin-top: 8px; line-height: 1.5; }
            .kp-hint code { background: var(--background-secondary); padding: 2px 6px; border-radius: 3px; font-family: monospace; }
            .kp-checkbox-group { display: flex; align-items: center; cursor: pointer; margin-bottom: 8px; }
            .kp-checkbox { margin-right: 10px; width: 18px; height: 18px; cursor: pointer; accent-color: var(--brand-experiment); }
            .kp-checkbox-title { color: var(--header-primary); font-size: 16px; font-weight: 500; }
            .kp-error { color: var(--text-danger); font-size: 12px; margin-top: 4px; }
        `;
    }

    getName() { return "KeywordPing"; }
    getDescription() { return "Get Discord notifications when messages match your keywords."; }
    getVersion() { return "2.2.0"; }
    getAuthor() { return "Snues"; }

    start() {
        BdApi.DOM.addStyle(this.getName(), this.css);
        this.loadSettings();
        this.UserStore = BdApi.Webpack.getStore("UserStore");
        this.ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        this.currentUserId = this.UserStore?.getCurrentUser()?.id;
        this.patchDispatcher();
    }

    stop() {
        BdApi.DOM.removeStyle(this.getName());
        BdApi.Patcher.unpatchAll(this.getName());
        this.saveSettings();
        this.UserStore = null;
        this.ChannelStore = null;
        this.currentUserId = null;
    }

    loadSettings() {
        const saved = BdApi.Data.load(this.getName(), "settings") || {};
        this.settings = {
            keywords: saved.keywords || [],
            whitelistedUsers: saved.whitelistedUsers || [],
            ignoredUsers: saved.ignoredUsers || [],
            guilds: saved.guilds || {},
            wholeWord: saved.wholeWord ?? true
        };
    }

    saveSettings() {
        BdApi.Data.save(this.getName(), "settings", this.settings);
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "kp-settings-panel";

        panel.appendChild(this.createCheckboxSetting("Match whole words only", "When enabled, <code>cat</code> matches \"cat\" but not \"category\". Regex patterns are unaffected.", this.settings.wholeWord, (val) => { this.settings.wholeWord = val; this.saveSettings(); }));
        panel.appendChild(this.createTextAreaSetting("Keywords", "One keyword per line. Supports regex: /pattern/flags<br>Filters: @userid:keyword, #channelid:keyword, serverid:keyword", this.settings.keywords.join("\n"), (val) => { this.settings.keywords = val.split("\n").filter(k => k.trim()); this.saveSettings(); }, true));
        panel.appendChild(this.createTextAreaSetting("Whitelisted Users", "One per line - username, display name, or user ID", this.settings.whitelistedUsers.join("\n"), (val) => { this.settings.whitelistedUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        panel.appendChild(this.createTextAreaSetting("Ignored Users", "One per line - username, display name, or user ID", this.settings.ignoredUsers.join("\n"), (val) => { this.settings.ignoredUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        return panel;
    }

    createCheckboxSetting(title, hint, value, onChange) {
        const group = document.createElement("div");
        group.className = "kp-settings-group";
        const label = document.createElement("label");
        label.className = "kp-checkbox-group";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "kp-checkbox";
        checkbox.checked = value;
        checkbox.addEventListener("change", () => onChange(checkbox.checked));
        const titleSpan = document.createElement("span");
        titleSpan.className = "kp-checkbox-title";
        titleSpan.textContent = title;
        label.appendChild(checkbox);
        label.appendChild(titleSpan);
        group.appendChild(label);
        const hintEl = document.createElement("div");
        hintEl.className = "kp-hint";
        hintEl.innerHTML = hint;
        group.appendChild(hintEl);
        return group;
    }

    createTextAreaSetting(title, hint, value, onChange, validate = false) {
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
        group.appendChild(textarea);

        const errorEl = document.createElement("div");
        errorEl.className = "kp-error";
        errorEl.style.display = "none";
        group.appendChild(errorEl);

        const hintEl = document.createElement("div");
        hintEl.className = "kp-hint";
        hintEl.innerHTML = hint;
        group.appendChild(hintEl);

        const updateValidation = () => {
            if (!validate) return;
            const invalid = textarea.value.split("\n").filter(k => k.trim() && !this.isValidPattern(k));
            if (invalid.length) {
                errorEl.textContent = `Invalid pattern: ${invalid.join(", ")}`;
                errorEl.style.display = "block";
            } else {
                errorEl.style.display = "none";
            }
        };

        textarea.addEventListener("change", () => { onChange(textarea.value); updateValidation(); });
        textarea.addEventListener("input", updateValidation);
        updateValidation();

        return group;
    }

    isValidPattern(keyword) {
        let pattern = keyword;
        const filterMatch = /^([@#]?)(\d+):(.+)$/.exec(keyword);
        if (filterMatch) pattern = filterMatch[3];
        const regexMatch = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
        if (regexMatch) {
            try { new RegExp(regexMatch[1], regexMatch[2]); return true; }
            catch { return false; }
        }
        return true;
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

        if (!this.currentUserId) {
            this.currentUserId = this.UserStore?.getCurrentUser()?.id;
            if (!this.currentUserId) return;
        }

        const channel = this.ChannelStore?.getChannel(message.channel_id);
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
            const currentUser = this.UserStore?.getCurrentUser();
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
            if (regexMatch) {
                return { filter, regex: new RegExp(regexMatch[1], regexMatch[2]) };
            }
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regexPattern = this.settings.wholeWord ? `(?<!\\w)${escaped}(?!\\w)` : escaped;
            return { filter, regex: new RegExp(regexPattern, "i") };
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
