export { createBashTool, createBashToolDefinition, createLocalBashOperations, } from "./bash.ts";
export { createEditTool, createEditToolDefinition, } from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export { createFindTool, createFindToolDefinition, } from "./find.ts";
export { createGrepTool, createGrepToolDefinition, } from "./grep.ts";
export { createLsTool, createLsToolDefinition, } from "./ls.ts";
export { createReadTool, createReadToolDefinition, } from "./read.ts";
export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateLine, truncateTail, } from "./truncate.ts";
export { createWriteTool, createWriteToolDefinition, } from "./write.ts";
import { createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition } from "./edit.ts";
import { createFindTool, createFindToolDefinition } from "./find.ts";
import { createGrepTool, createGrepToolDefinition } from "./grep.ts";
import { createLsTool, createLsToolDefinition } from "./ls.ts";
import { createReadTool, createReadToolDefinition } from "./read.ts";
import { createWriteTool, createWriteToolDefinition } from "./write.ts";
export const allToolNames = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
export function createToolDefinition(toolName, cwd, options) {
    switch (toolName) {
        case "read":
            return createReadToolDefinition(cwd, options?.read);
        case "bash":
            return createBashToolDefinition(cwd, options?.bash);
        case "edit":
            return createEditToolDefinition(cwd, options?.edit);
        case "write":
            return createWriteToolDefinition(cwd, options?.write);
        case "grep":
            return createGrepToolDefinition(cwd, options?.grep);
        case "find":
            return createFindToolDefinition(cwd, options?.find);
        case "ls":
            return createLsToolDefinition(cwd, options?.ls);
        default:
            throw new Error(`Unknown tool name: ${toolName}`);
    }
}
export function createTool(toolName, cwd, options) {
    switch (toolName) {
        case "read":
            return createReadTool(cwd, options?.read);
        case "bash":
            return createBashTool(cwd, options?.bash);
        case "edit":
            return createEditTool(cwd, options?.edit);
        case "write":
            return createWriteTool(cwd, options?.write);
        case "grep":
            return createGrepTool(cwd, options?.grep);
        case "find":
            return createFindTool(cwd, options?.find);
        case "ls":
            return createLsTool(cwd, options?.ls);
        default:
            throw new Error(`Unknown tool name: ${toolName}`);
    }
}
export function createCodingToolDefinitions(cwd, options) {
    return [
        createReadToolDefinition(cwd, options?.read),
        createBashToolDefinition(cwd, options?.bash),
        createEditToolDefinition(cwd, options?.edit),
        createWriteToolDefinition(cwd, options?.write),
    ];
}
export function createReadOnlyToolDefinitions(cwd, options) {
    return [
        createReadToolDefinition(cwd, options?.read),
        createGrepToolDefinition(cwd, options?.grep),
        createFindToolDefinition(cwd, options?.find),
        createLsToolDefinition(cwd, options?.ls),
    ];
}
export function createAllToolDefinitions(cwd, options) {
    return {
        read: createReadToolDefinition(cwd, options?.read),
        bash: createBashToolDefinition(cwd, options?.bash),
        edit: createEditToolDefinition(cwd, options?.edit),
        write: createWriteToolDefinition(cwd, options?.write),
        grep: createGrepToolDefinition(cwd, options?.grep),
        find: createFindToolDefinition(cwd, options?.find),
        ls: createLsToolDefinition(cwd, options?.ls),
    };
}
export function createCodingTools(cwd, options) {
    return [
        createReadTool(cwd, options?.read),
        createBashTool(cwd, options?.bash),
        createEditTool(cwd, options?.edit),
        createWriteTool(cwd, options?.write),
    ];
}
export function createReadOnlyTools(cwd, options) {
    return [
        createReadTool(cwd, options?.read),
        createGrepTool(cwd, options?.grep),
        createFindTool(cwd, options?.find),
        createLsTool(cwd, options?.ls),
    ];
}
export function createAllTools(cwd, options) {
    return {
        read: createReadTool(cwd, options?.read),
        bash: createBashTool(cwd, options?.bash),
        edit: createEditTool(cwd, options?.edit),
        write: createWriteTool(cwd, options?.write),
        grep: createGrepTool(cwd, options?.grep),
        find: createFindTool(cwd, options?.find),
        ls: createLsTool(cwd, options?.ls),
    };
}
