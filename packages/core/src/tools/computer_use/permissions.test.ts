import { describe, expect, it } from "bun:test";
import {
    assertCommandAllowed,
    assertPathAllowed,
    isCommandAllowed,
    isPathAllowed,
    matchesCommand,
    matchesPath,
    splitCommandSequences,
} from "./permissions";

describe("matchesPath", () => {
    it("should match exact file path", () => {
        expect(matchesPath("/etc/hosts", "/etc/hosts")).toBe(true);
        expect(matchesPath("/etc/hosts", "/etc/passwd")).toBe(false);
    });

    it("should match directory and all children inside directory", () => {
        expect(matchesPath("/var/log", "/var/log")).toBe(true);
        expect(matchesPath("/var/log", "/var/log/syslog")).toBe(true);
        expect(matchesPath("/var/log", "/var/log/nginx/access.log")).toBe(true);
        expect(matchesPath("/var/log/", "/var/log/syslog")).toBe(true);
        expect(matchesPath("/var/log", "/var/logging/test")).toBe(false);
    });

    it("should match wildcard file patterns", () => {
        expect(matchesPath("*.log", "/var/log/syslog.log")).toBe(true);
        expect(matchesPath("*.log", "app.log")).toBe(true);
        expect(matchesPath("*.log", "app.txt")).toBe(false);

        expect(matchesPath("/tmp/*", "/tmp/temp.txt")).toBe(true);
        expect(matchesPath("/tmp/*", "/tmp/sub/temp.txt")).toBe(true);
        expect(matchesPath("/tmp/*", "/var/tmp/temp.txt")).toBe(false);
    });
});

describe("isPathAllowed and assertPathAllowed", () => {
    it("should allow everything by default when rule is undefined or empty", () => {
        expect(isPathAllowed("/any/path.txt")).toBe(true);
        expect(isPathAllowed("/any/path.txt", {})).toBe(true);
    });

    it("should block disallowed paths", () => {
        const rule = {
            disallowed: ["/etc/*", "/root/.ssh/*", "/home/*/.ssh/*", "*.env"],
        };

        expect(isPathAllowed("/etc/passwd", rule)).toBe(false);
        expect(isPathAllowed("/root/.ssh/id_rsa", rule)).toBe(false);
        expect(isPathAllowed("/home/user/.ssh/id_rsa", rule)).toBe(false);
        expect(isPathAllowed("/app/.env", rule)).toBe(false);
        expect(isPathAllowed("/workspace/file.txt", rule)).toBe(true);
    });

    it("should restrict to allowed whitelist when allowed is specified", () => {
        const rule = {
            allowed: ["/workspace", "/tmp/*"],
        };

        expect(isPathAllowed("/workspace/src/index.ts", rule)).toBe(true);
        expect(isPathAllowed("/tmp/scratch.txt", rule)).toBe(true);
        expect(isPathAllowed("/etc/passwd", rule)).toBe(false);
    });

    it("disallowed rules should take precedence over allowed rules", () => {
        const rule = {
            allowed: ["/workspace/*"],
            disallowed: ["/workspace/secret.key"],
        };

        expect(isPathAllowed("/workspace/app.ts", rule)).toBe(true);
        expect(isPathAllowed("/workspace/secret.key", rule)).toBe(false);
    });

    it("assertPathAllowed should throw descriptive error on denial", () => {
        const rule = { disallowed: ["/etc/*"] };
        expect(() => assertPathAllowed("read", "/etc/passwd", rule)).toThrow(
            /Permission denied: read access to '\/etc\/passwd' is disallowed/,
        );
        expect(() => assertPathAllowed("write", "/workspace/test", rule)).not.toThrow();
    });
});

describe("splitCommandSequences", () => {
    it("should return single command as array", () => {
        expect(splitCommandSequences("ls -la")).toEqual(["ls -la"]);
    });

    it("should split on &&, ||, ;, and |", () => {
        expect(splitCommandSequences("echo hello && ls -la")).toEqual([
            "echo hello",
            "ls -la",
        ]);
        expect(splitCommandSequences("make build || exit 1")).toEqual([
            "make build",
            "exit 1",
        ]);
        expect(splitCommandSequences("cat file | grep foo ; echo done")).toEqual([
            "cat file",
            "grep foo",
            "echo done",
        ]);
    });

    it("should preserve delimiters inside quotes", () => {
        expect(splitCommandSequences("grep 'foo;bar' file.txt")).toEqual([
            "grep 'foo;bar' file.txt",
        ]);
        expect(splitCommandSequences('echo "a && b" ; ls')).toEqual([
            'echo "a && b"',
            "ls",
        ]);
    });
});

describe("matchesCommand", () => {
    it("should match exact command", () => {
        expect(matchesCommand("bash", "bash")).toBe(true);
        expect(matchesCommand("bash", "sh")).toBe(false);
    });

    it("should match command prefix with arguments", () => {
        expect(matchesCommand("bash", "bash script.sh")).toBe(true);
        expect(matchesCommand("sh", "sh -c 'echo 1'")).toBe(true);
        expect(matchesCommand("git commit", "git commit -m 'Initial commit'")).toBe(true);
        expect(matchesCommand("git commit", "git status")).toBe(false);
        expect(matchesCommand("bash", "bashful")).toBe(false);
    });

    it("should match binary executable name from full path", () => {
        expect(matchesCommand("bash", "/bin/bash script.sh")).toBe(true);
        expect(matchesCommand("sh", "/usr/bin/sh")).toBe(true);
    });

    it("should match wildcard command patterns", () => {
        expect(matchesCommand("find *", "find /tmp -name '*.log'")).toBe(true);
        expect(matchesCommand("git *", "git checkout main")).toBe(true);
        expect(matchesCommand("git commit*", "git commit -am 'test'")).toBe(true);
    });
});

describe("isCommandAllowed and assertCommandAllowed", () => {
    it("should allow any command by default when rule is undefined or empty", () => {
        expect(isCommandAllowed("bash")).toBe(true);
        expect(isCommandAllowed("rm -rf /", {})).toBe(true);
    });

    it("should block disallowed commands", () => {
        const rule = {
            disallowed: ["bash", "sh", "git commit*"],
        };

        expect(isCommandAllowed("bash script.sh", rule)).toBe(false);
        expect(isCommandAllowed("/bin/sh", rule)).toBe(false);
        expect(isCommandAllowed("git commit -m 'test'", rule)).toBe(false);
        expect(isCommandAllowed("git status", rule)).toBe(true);
        expect(isCommandAllowed("ls -la", rule)).toBe(true);
    });

    it("should block composite command if any sub-command is disallowed", () => {
        const rule = {
            disallowed: ["bash"],
        };

        expect(isCommandAllowed("echo hello && bash", rule)).toBe(false);
        expect(isCommandAllowed("cat script.sh | bash", rule)).toBe(false);
        expect(isCommandAllowed("echo hello ; /bin/bash -c 'echo hi'", rule)).toBe(false);
        expect(isCommandAllowed("echo hello && ls", rule)).toBe(true);
    });

    it("should require all sub-commands to be allowed when allowed whitelist is present", () => {
        const rule = {
            allowed: ["find *", "echo *", "ls *"],
        };

        expect(isCommandAllowed("find . -name '*.ts'", rule)).toBe(true);
        expect(isCommandAllowed("echo hello && ls -la", rule)).toBe(true);
        expect(isCommandAllowed("cat /etc/passwd", rule)).toBe(false);
        expect(isCommandAllowed("echo ok && rm -rf /", rule)).toBe(false);
    });

    it("assertCommandAllowed should throw descriptive error on denial", () => {
        const rule = { disallowed: ["bash"] };
        expect(() => assertCommandAllowed("bash run.sh", rule)).toThrow(
            /Permission denied: Command execution 'bash run\.sh' is disallowed/,
        );
        expect(() => assertCommandAllowed("ls", rule)).not.toThrow();
    });
});
