import type { AgentHandle } from "@/agents";
import type { Tool, ToolProvider } from "./tools";

/**
 * Checks if a tool name matches a wildcard/pseudo-regex pattern.
 * Supports '*' (match 0 or more characters) and '?' (match 1 character).
 * Example: 'read_*_file' matches 'read_temp_file' or 'read__file'.
 */
export function matchesPattern(pattern: string, name: string): boolean {
    if (pattern === "*") {
        return true;
    }
    if (pattern === name) {
        return true;
    }

    // Escape regex characters except '*' and '?'
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexPattern = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
    const regex = new RegExp(regexPattern);
    return regex.test(name);
}

/**
 * Options for filtering tools and configuring user input requirements.
 */
export interface ToolFilterOptions {
    allowedTools?: string[];
    disallowedTools?: string[];
    userInputTools?: string[];
}

/**
 * ToolProvider wrapper that filters available tools and flags tools requiring user confirmation.
 */
export class FilteredToolProvider implements ToolProvider {
    private provider: ToolProvider;
    private options: ToolFilterOptions;

    constructor(provider: ToolProvider, options: ToolFilterOptions) {
        this.provider = provider;
        this.options = options;
    }

    get name(): string | undefined {
        return (this.provider as any).name ?? (this.provider as any).config?.name;
    }

    get innerProvider(): ToolProvider {
        return this.provider;
    }

    /**
     * Determines whether a tool with the given name is permitted.
     */
    isToolAllowed(name: string): boolean {
        // Disallowed / rejected patterns take highest precedence
        const disallowedPatterns = this.options.disallowedTools ?? [];

        for (const pattern of disallowedPatterns) {
            if (matchesPattern(pattern, name)) {
                return false;
            }
        }

        // If allowedTools is specified and non-empty, the tool must match at least one allowed pattern
        if (this.options.allowedTools && this.options.allowedTools.length > 0) {
            const isExplicitlyAllowed = this.options.allowedTools.some(
                (pattern) => matchesPattern(pattern, name),
            );
            if (!isExplicitlyAllowed) {
                return false;
            }
        }

        return true;
    }

    /**
     * Checks if a tool requires user confirmation before execution.
     */
    requiresUserInput(name: string, originalRequiresUserInput?: boolean): boolean {
        if (originalRequiresUserInput === true) {
            return true;
        }

        if (
            this.options.userInputTools &&
            this.options.userInputTools.length > 0
        ) {
            return this.options.userInputTools.some((pattern) =>
                matchesPattern(pattern, name),
            );
        }

        return false;
    }

    async getToolByName(
        name: string,
        agent?: AgentHandle,
    ): Promise<Tool | null> {
        if (!this.isToolAllowed(name)) {
            return null;
        }

        const tool = await this.provider.getToolByName(name, agent);
        if (!tool || !this.isToolAllowed(tool.name)) {
            return null;
        }

        return {
            ...tool,
            requires_user_input: this.requiresUserInput(
                tool.name,
                tool.requires_user_input,
            ),
        };
    }

    async getAllTools(agent?: AgentHandle): Promise<Tool[]> {
        const tools = await this.provider.getAllTools(agent);

        return tools
            .filter((tool) => this.isToolAllowed(tool.name))
            .map((tool) => ({
                ...tool,
                requires_user_input: this.requiresUserInput(
                    tool.name,
                    tool.requires_user_input,
                ),
            }));
    }
}

/**
 * Wraps a tool provider with filtering logic if any filter rules are provided.
 */
export function withToolFilter(
    provider: ToolProvider,
    options?: ToolFilterOptions,
): ToolProvider {
    if (!options) {
        return provider;
    }

    const hasAllowed = options.allowedTools && options.allowedTools.length > 0;
    const hasDisallowed =
        (options.disallowedTools && options.disallowedTools.length > 0);
    const hasUserInput =
        options.userInputTools && options.userInputTools.length > 0;

    if (!hasAllowed && !hasDisallowed && !hasUserInput) {
        return provider;
    }

    return new FilteredToolProvider(provider, options);
}
