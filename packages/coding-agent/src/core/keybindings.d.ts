import { type Keybinding, type KeybindingsConfig, type KeyId, KeybindingsManager as TuiKeybindingsManager } from "@my-agent/tui";
export interface AppKeybindings {
    "app.interrupt": true;
    "app.clear": true;
    "app.exit": true;
    "app.suspend": true;
    "app.thinking.cycle": true;
    "app.model.cycleForward": true;
    "app.model.cycleBackward": true;
    "app.model.select": true;
    "app.tools.expand": true;
    "app.thinking.toggle": true;
    "app.session.toggleNamedFilter": true;
    "app.editor.external": true;
    "app.message.copy": true;
    "app.message.followUp": true;
    "app.message.dequeue": true;
    "app.clipboard.pasteImage": true;
    "app.session.new": true;
    "app.session.tree": true;
    "app.session.fork": true;
    "app.session.resume": true;
    "app.tree.foldOrUp": true;
    "app.tree.unfoldOrDown": true;
    "app.tree.editLabel": true;
    "app.tree.toggleLabelTimestamp": true;
    "app.session.togglePath": true;
    "app.session.toggleSort": true;
    "app.session.rename": true;
    "app.session.delete": true;
    "app.session.deleteNoninvasive": true;
    "app.models.save": true;
    "app.models.enableAll": true;
    "app.models.clearAll": true;
    "app.models.toggleProvider": true;
    "app.models.reorderUp": true;
    "app.models.reorderDown": true;
    "app.tree.filter.default": true;
    "app.tree.filter.noTools": true;
    "app.tree.filter.userOnly": true;
    "app.tree.filter.labeledOnly": true;
    "app.tree.filter.all": true;
    "app.tree.filter.cycleForward": true;
    "app.tree.filter.cycleBackward": true;
}
export type AppKeybinding = keyof AppKeybindings;
declare module "@my-agent/tui" {
    interface Keybindings extends AppKeybindings {
    }
}
export declare const KEYBINDINGS: KeybindingDefinitions;
export declare function migrateKeybindingsConfig(rawConfig: Record<string, unknown>): {
    config: Record<string, unknown>;
    migrated: boolean;
};
export declare class KeybindingsManager extends TuiKeybindingsManager {
    private configPath;
    constructor(userBindings?: KeybindingsConfig, configPath?: string);
    static create(agentDir?: string): KeybindingsManager;
    reload(): void;
    getEffectiveConfig(): KeybindingsConfig;
    private static loadFromFile;
}
export type { Keybinding, KeyId, KeybindingsConfig };
//# sourceMappingURL=keybindings.d.ts.map