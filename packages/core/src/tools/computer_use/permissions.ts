import path from "node:path";
import { matchesPattern } from "../filter";

/**
 * Rules specifying allowed and disallowed targets.
 */
export interface PermissionRule {
    allowed?: string[];
    disallowed?: string[];
}

/**
 * Computer Use permissions covering read, write, and command execution.
 */
export interface ComputerPermissions {
    read?: PermissionRule;
    write?: PermissionRule;
    execute?: PermissionRule;
}

/**
 * Matches a target file/directory path against a pattern.
 * Supports:
 * - Direct paths: "/var/log" matches "/var/log" and any child like "/var/log/app.log"
 * - Wildcard paths: "/tmp/*", "*.json", "/home/user/.ssh/*", etc.
 */
export function matchesPath(pattern: string, targetPath: string): boolean {
    const normTarget = path.normalize(targetPath);
    const hasWildcard = pattern.includes("*") || pattern.includes("?");

    if (!hasWildcard) {
        const normPattern = path.normalize(pattern);
        if (normTarget === normPattern) {
            return true;
        }
        const dirPrefix = normPattern.endsWith(path.sep)
            ? normPattern
            : normPattern + path.sep;
        if (normTarget.startsWith(dirPrefix)) {
            return true;
        }
        return false;
    }

    // Pattern contains wildcards
    if (matchesPattern(pattern, normTarget)) {
        return true;
    }

    // Check basename match (e.g. pattern "*.log" or "secret.*")
    const basename = path.basename(normTarget);
    if (matchesPattern(pattern, basename)) {
        return true;
    }

    // If pattern represents a wildcard directory and target is inside it
    const patternWithChild = pattern.endsWith("/") ? `${pattern}*` : `${pattern}/*`;
    if (matchesPattern(patternWithChild, normTarget)) {
        return true;
    }

    return false;
}

/**
 * Determines whether a file/directory path is allowed according to the permission rule.
 */
export function isPathAllowed(targetPath: string, rule?: PermissionRule): boolean {
    if (!rule) {
        return true;
    }

    // Disallowed patterns take highest precedence
    if (rule.disallowed && rule.disallowed.length > 0) {
        for (const pattern of rule.disallowed) {
            if (matchesPath(pattern, targetPath)) {
                return false;
            }
        }
    }

    // If allowed is defined and non-empty, path must match at least one allowed pattern
    if (rule.allowed && rule.allowed.length > 0) {
        const isExplicitlyAllowed = rule.allowed.some((pattern) =>
            matchesPath(pattern, targetPath),
        );
        if (!isExplicitlyAllowed) {
            return false;
        }
    }

    return true;
}

/**
 * Asserts that a file/directory path is permitted; throws descriptive Error otherwise.
 */
export function assertPathAllowed(
    action: "read" | "write",
    targetPath: string,
    rule?: PermissionRule,
): void {
    if (!isPathAllowed(targetPath, rule)) {
        throw new Error(
            `Permission denied: ${action} access to '${targetPath}' is disallowed by computer use security rules.`,
        );
    }
}

/**
 * Splits a composite shell command line into sub-commands (e.g., delimited by &&, ||, ;, |),
 * respecting quotes so quoted delimiters (like 'foo;bar') are preserved.
 */
export function splitCommandSequences(command: string): string[] {
    const sequences: string[] = [];
    let current = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        const nextChar = command[i + 1];

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += char;
        } else if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char;
        } else if (!inSingleQuote && !inDoubleQuote) {
            if (
                (char === "&" && nextChar === "&") ||
                (char === "|" && nextChar === "|")
            ) {
                if (current.trim()) {
                    sequences.push(current.trim());
                }
                current = "";
                i++; // skip second operator character
            } else if (char === ";" || char === "|") {
                if (current.trim()) {
                    sequences.push(current.trim());
                }
                current = "";
            } else {
                current += char;
            }
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        sequences.push(current.trim());
    }

    return sequences.length > 0 ? sequences : [command.trim()];
}

/**
 * Matches a single sub-command against a pattern.
 * Supports:
 * - Exact match: "bash" matches "bash"
 * - Prefix/sequence match: "git commit" matches "git commit -m 'update'", "bash" matches "bash script.sh"
 * - Executable name match: "bash" matches "/bin/bash", "/usr/bin/bash -c '...'"
 * - Wildcard pseudo-regex: "find *" matches "find /tmp -name '*.log'"
 */
export function matchesCommand(pattern: string, command: string): boolean {
    const trimmed = command.trim();
    const patternTrimmed = pattern.trim();

    if (!trimmed || !patternTrimmed) {
        return false;
    }

    // 1. Exact match
    if (trimmed === patternTrimmed) {
        return true;
    }

    // 2. Wildcard pattern match
    if (patternTrimmed.includes("*") || patternTrimmed.includes("?")) {
        if (matchesPattern(patternTrimmed, trimmed)) {
            return true;
        }
    }

    // 3. Command prefix match (e.g. pattern "git commit" or "bash" before arguments)
    if (trimmed.startsWith(`${patternTrimmed} `)) {
        return true;
    }

    // 4. Executable binary name match (e.g. pattern "bash" matches "/bin/bash" or "/bin/bash script.sh")
    const firstToken = trimmed.split(/\s+/)[0] ?? "";
    const exeName = path.basename(firstToken);
    if (exeName === patternTrimmed) {
        return true;
    }

    return false;
}

/**
 * Determines whether a command or command sequence is allowed according to the permission rule.
 */
export function isCommandAllowed(command: string, rule?: PermissionRule): boolean {
    if (!rule) {
        return true;
    }

    const subCommands = splitCommandSequences(command);

    // If ANY sub-command matches a disallowed pattern, reject the command
    if (rule.disallowed && rule.disallowed.length > 0) {
        for (const sub of subCommands) {
            for (const pattern of rule.disallowed) {
                if (matchesCommand(pattern, sub)) {
                    return false;
                }
            }
        }
    }

    // If allowed is defined and non-empty, ALL sub-commands must match an allowed pattern
    if (rule.allowed && rule.allowed.length > 0) {
        for (const sub of subCommands) {
            const isSubAllowed = rule.allowed.some((pattern) =>
                matchesCommand(pattern, sub),
            );
            if (!isSubAllowed) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Asserts that a command is permitted; throws descriptive Error otherwise.
 */
export function assertCommandAllowed(command: string, rule?: PermissionRule): void {
    if (!isCommandAllowed(command, rule)) {
        throw new Error(
            `Permission denied: Command execution '${command}' is disallowed by computer use security rules.`,
        );
    }
}
