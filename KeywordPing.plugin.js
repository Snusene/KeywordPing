/**
 * @name KeywordPing
 * @author Snues
 * @description Get notified when messages match your keywords. Uses Discord's native notification system, so it looks and sounds just like a regular @mention.
 * @version 2.3.0
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
        this.compiledKeywords = [];
        this.currentUserId = null;
        this.UserStore = null;
        this.ChannelStore = null;
        this.GuildStore = null;
        this.GuildMemberStore = null;
        this.css = `
            .kp-settings-panel { padding: 10px; }
            .kp-settings-group { margin-bottom: 20px; }
            .kp-settings-group-title { color: var(--header-secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; display: inline; margin-right: 6px; }
            .kp-settings-group-header { margin-bottom: 8px; }
            .kp-textarea { width: 100%; min-height: 84px; background: var(--input-background); border: none; border-radius: 4px; padding: 10px; color: var(--text-normal); font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--scrollbar-thin-thumb) transparent; }
            .kp-textarea::-webkit-scrollbar { width: 8px; }
            .kp-textarea::-webkit-scrollbar-track { background: transparent; }
            .kp-textarea::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb); border-radius: 4px; }
            .kp-textarea:focus { outline: none; }
            .kp-textarea::placeholder { color: var(--text-muted); }
            .kp-hint { color: var(--text-muted); font-size: 12px; line-height: 1.5; display: inline; }
            .kp-hint-footer { display: block; margin-top: 8px; }
            .kp-hint code { background: var(--background-secondary); padding: 2px 6px; border-radius: 3px; font-family: monospace; }
            .kp-error { color: var(--text-danger); font-size: 12px; margin-top: 4px; }
        `;
    }

    start() {
        BdApi.DOM.addStyle("KeywordPing", this.css);
        this.loadSettings();
        this.compileKeywords();
        this.UserStore = BdApi.Webpack.getStore("UserStore");
        this.ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        this.GuildStore = BdApi.Webpack.getStore("GuildStore");
        this.GuildMemberStore = BdApi.Webpack.getStore("GuildMemberStore");
        this.currentUserId = this.UserStore?.getCurrentUser()?.id;
        this.patchDispatcher();
    }

    stop() {
        BdApi.DOM.removeStyle("KeywordPing");
        BdApi.Patcher.unpatchAll("KeywordPing");
        this.saveSettings();
        this.UserStore = null;
        this.ChannelStore = null;
        this.GuildStore = null;
        this.GuildMemberStore = null;
        this.currentUserId = null;
        this.compiledKeywords = [];
    }

    loadSettings() {
        const saved = BdApi.Data.load("KeywordPing", "settings") || {};
        this.settings = {
            keywords: saved.keywords || [],
            whitelistedUsers: saved.whitelistedUsers || [],
            ignoredUsers: saved.ignoredUsers || [],
            guilds: saved.guilds || {}
        };
    }

    saveSettings() {
        BdApi.Data.save("KeywordPing", "settings", this.settings);
    }

    compileKeywords() {
        this.compiledKeywords = [];
        for (const keyword of this.settings.keywords) {
            if (!keyword.trim()) continue;
            const result = this.parseKeyword(keyword);
            if (result) this.compiledKeywords.push(result);
        }
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "kp-settings-panel";

        panel.appendChild(this.createTextAreaSetting("Keywords", "One keyword per line. Supports regex: /pattern/flags<br>Filters: @userid:keyword, #channelid:keyword, serverid:keyword", this.settings.keywords.join("\n"), (val) => { this.settings.keywords = val.split("\n").filter(k => k.trim()); this.compileKeywords(); this.saveSettings(); }, true));
        panel.appendChild(this.createTextAreaSetting("Whitelisted Users", "One per line - username, display name, nickname, or user ID", this.settings.whitelistedUsers.join("\n"), (val) => { this.settings.whitelistedUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        panel.appendChild(this.createTextAreaSetting("Ignored Users", "One per line - username, display name, nickname, or user ID", this.settings.ignoredUsers.join("\n"), (val) => { this.settings.ignoredUsers = val.split("\n").filter(k => k.trim()); this.saveSettings(); }));
        return panel;
    }

    createTextAreaSetting(title, hint, value, onChange, validate = false) {
        const group = document.createElement("div");
        group.className = "kp-settings-group";

        const [mainHint, footerHint] = hint.split("<br>");

        const header = document.createElement("div");
        header.className = "kp-settings-group-header";

        const titleEl = document.createElement("span");
        titleEl.className = "kp-settings-group-title";
        titleEl.textContent = title;
        header.appendChild(titleEl);

        const hintEl = document.createElement("span");
        hintEl.className = "kp-hint";
        hintEl.innerHTML = mainHint;
        header.appendChild(hintEl);

        group.appendChild(header);

        const textarea = document.createElement("textarea");
        textarea.className = "kp-textarea";
        textarea.value = value;
        textarea.placeholder = `Enter ${title.toLowerCase()}...`;
        group.appendChild(textarea);

        const errorEl = document.createElement("div");
        errorEl.className = "kp-error";
        errorEl.style.display = "none";
        group.appendChild(errorEl);

        if (footerHint) {
            const footerEl = document.createElement("div");
            footerEl.className = "kp-hint kp-hint-footer";
            footerEl.innerHTML = footerHint;
            group.appendChild(footerEl);
        }

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

        BdApi.Patcher.before("KeywordPing", Dispatcher, "dispatch", (_, [event]) => {
            if (event?.type === "MESSAGE_CREATE") {
                this.handleMessage(event);
            }
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
        if (this.matchesUser(this.settings.ignoredUsers, message.author, channel.guild_id)) return;

        const guildSettings = this.settings.guilds[channel.guild_id];
        if (guildSettings?.enabled === false) return;
        if (guildSettings?.channels?.[channel.id] === false) return;

        let matched = this.matchesUser(this.settings.whitelistedUsers, message.author, channel.guild_id);
        if (!matched) {
            for (const compiled of this.compiledKeywords) {
                if (compiled.filter && !this.passesFilter(compiled.filter, message)) continue;
                if (compiled.regex.test(message.content || "") || message.embeds?.some(e => compiled.regex.test(JSON.stringify(e)))) {
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
            return { filter, regex: new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i") };
        } catch { return null; }
    }

    passesFilter(filter, message) {
        if (filter.type === "@") return message.author.id === filter.id;
        if (filter.type === "#") return message.channel_id === filter.id;
        return message.guild_id === filter.id;
    }

    matchesUser(list, author, guildId = null) {
        const user = this.UserStore?.getUser(author.id) || author;
        const username = (user.username || author.username)?.toLowerCase();
        const displayName = (user.globalName || user.global_name || author.globalName || author.global_name)?.toLowerCase();

        let nickname = null;
        if (guildId && this.GuildMemberStore) {
            nickname = this.GuildMemberStore.getMember(guildId, author.id)?.nick?.toLowerCase();
        }

        return list.some(entry => {
            const e = entry.toLowerCase();
            return author.id === entry || username === e || displayName === e || nickname === e;
        });
    }
};
