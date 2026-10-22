/** Shell 命令的词法与结构解析：规范化、分词、拆分复合命令、识别无法审查的结构和输出重定向。 */

export interface ShellCommandSegment {
  command: string;
  separatorBefore: ";" | "&&" | "||" | "|" | null;
}

export const MAX_AI_COMMAND_CHARS = 4_096;

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function getCommandValidationError(command: string): string | null {
  if (!command.trim()) return "命令为空";
  if (command.length > MAX_AI_COMMAND_CHARS) {
    return `命令长度超过 ${MAX_AI_COMMAND_CHARS} 个字符`;
  }
  if (command.includes("\0")) return "命令包含非法空字符";

  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = quote === char ? null : (quote ?? char);
    }
  }

  if (quote) return "命令包含未闭合引号";
  if (escaped) return "命令以未完成的转义符结尾";
  return null;
}

export interface LeadingToken {
  value: string;
  start: number;
  end: number;
}

export function readShellTokens(command: string): LeadingToken[] {
  const tokens: LeadingToken[] = [];
  let index = 0;

  while (index < command.length) {
    while (/\s/.test(command[index] ?? "")) index += 1;
    if (index >= command.length) break;

    const start = index;
    let value = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;
    for (; index < command.length; index += 1) {
      const char = command[index] ?? "";
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\" && quote !== "'") {
        escaped = true;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = quote === char ? null : (quote ?? char);
        continue;
      }
      if (!quote && /\s/.test(char)) break;
      value += char;
    }
    tokens.push({ value, start, end: index });
  }

  return tokens;
}

export function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

export function getEffectiveCommand(normalized: string): {
  commandName: string;
  normalized: string;
} {
  const tokens = readShellTokens(normalized);
  let index = 0;

  while (index < tokens.length && isEnvironmentAssignment(tokens[index]!.value)) {
    index += 1;
  }

  for (let depth = 0; depth < 8 && index < tokens.length; depth += 1) {
    const token = getCommandBasename(tokens[index]!.value.toLowerCase());
    if (token === "!") {
      index += 1;
      continue;
    }
    if (token === "env") {
      index += 1;
      while (index < tokens.length) {
        const value = tokens[index]!.value;
        if (isEnvironmentAssignment(value)) {
          index += 1;
          continue;
        }
        if (value === "-u" || value === "--unset") {
          index += 2;
          continue;
        }
        if (value.startsWith("-")) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (token === "command" || token === "builtin" || token === "exec") {
      index += 1;
      while (tokens[index]?.value.startsWith("-")) index += 1;
      continue;
    }
    if (token === "nice") {
      index += 1;
      if (tokens[index]?.value === "-n") index += 2;
      else if (tokens[index]?.value === "--adjustment") index += 2;
      else if (tokens[index]?.value.startsWith("--adjustment=")) index += 1;
      else if (/^-\d+$/.test(tokens[index]?.value ?? "")) index += 1;
      continue;
    }
    if (token === "nohup") {
      index += 1;
      if (tokens[index]?.value === "--") index += 1;
      continue;
    }
    break;
  }

  const effective = tokens[index];
  if (!effective) return { commandName: "", normalized };
  const commandName = getCommandBasename(effective.value.toLowerCase());
  return {
    commandName,
    normalized: `${commandName}${normalized.slice(effective.end)}`,
  };
}

export function getFirstWord(normalized: string): string {
  return normalized.split(" ")[0]?.toLowerCase() ?? "";
}

export function getCommandBasename(firstWord: string): string {
  // 兼容 /usr/bin/tool 这类绝对路径，只用命令名判断高风险前缀。
  return firstWord.replace(/\\/g, "/").split("/").pop() ?? firstWord;
}

export function splitAiShellCommands(command: string): ShellCommandSegment[] {
  const segments: ShellCommandSegment[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let separatorBefore: ShellCommandSegment["separatorBefore"] = null;

  const pushCurrent = (): void => {
    const text = current.trim();
    if (text) {
      segments.push({ command: text, separatorBefore });
      separatorBefore = null;
    }
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      pushCurrent();
      separatorBefore = ";";
      continue;
    }

    if (char === "&" && next === "&") {
      pushCurrent();
      separatorBefore = "&&";
      index += 1;
      continue;
    }

    if (char === "|" && next === "|") {
      pushCurrent();
      separatorBefore = "||";
      index += 1;
      continue;
    }

    // >| 是强制覆盖重定向，不属于管道。
    if (char === "|" && !current.endsWith(">")) {
      pushCurrent();
      separatorBefore = "|";
      if (next === "&") index += 1;
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

/**
 * 查找本地策略无法逐段审查的 Shell 结构：命令替换、子 Shell、分组、输入重定向和后台执行。
 * 这些结构可以把任意命令藏在看似安全的外层命令后面，自主执行模式下统一要求审批。
 */
export function getUnsupportedShellStructureReason(command: string): string | null {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const previous = command[index - 1] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && (char === "`" || (char === "$" && next === "("))) {
        return "命令包含动态命令替换，必须确认";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "`" || (char === "$" && next === "(")) {
      return "命令包含动态命令替换，必须确认";
    }
    if (char === "(" || char === ")") {
      return "命令包含子 Shell 或分组结构，本地策略无法逐段审查";
    }
    if (
      (char === "{" && /^$|[\s;&|]/.test(previous) && /\s/.test(next)) ||
      (char === "}" && /[\s;]/.test(previous) && /^$|[\s;&|]/.test(next))
    ) {
      return "命令包含命令分组结构，本地策略无法逐段审查";
    }
    if (char === "<") {
      return "命令包含输入重定向或 Here-Doc，本地策略无法审查输入内容";
    }
    if (char === "&") {
      if (next === "&") {
        index += 1;
        continue;
      }
      // 2>&1、>&2、&>file、|& 属于重定向或管道写法。
      if (previous === ">" || previous === "<" || previous === "|" || next === ">") continue;
      return "命令包含后台执行符 &，本地策略无法跟踪其执行结果";
    }
  }

  return null;
}

export interface OutputRedirect {
  operator: ">" | ">>" | ">|";
  target: string;
}

/** 解析单段命令中的输出重定向，并返回去掉重定向后的命令文本。 */
export function parseOutputRedirects(segment: string): {
  redirects: OutputRedirect[];
  commandText: string;
} {
  const redirects: OutputRedirect[] = [];
  let commandText = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] ?? "";

    if (escaped) {
      escaped = false;
      commandText += char;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      commandText += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      commandText += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      commandText += char;
      continue;
    }
    if (char !== ">") {
      commandText += char;
      continue;
    }

    // 去掉紧邻的文件描述符或 &>，它们属于重定向本身。
    commandText = commandText.replace(/(^|\s)(\d+|&)$/, "$1");
    let operator: OutputRedirect["operator"] = ">";
    if (segment[index + 1] === ">") {
      operator = ">>";
      index += 1;
    } else if (segment[index + 1] === "|") {
      operator = ">|";
      index += 1;
    } else if (segment[index + 1] === "&" && /[\d-]/.test(segment[index + 2] ?? "")) {
      // >&2、2>&1 只复制文件描述符，不写入文件。
      index += 2;
      while (/\d/.test(segment[index + 1] ?? "")) index += 1;
      continue;
    } else if (segment[index + 1] === "&") {
      index += 1;
    }

    while (/\s/.test(segment[index + 1] ?? "")) index += 1;
    let target = "";
    let targetQuote: "'" | '"' | null = null;
    while (index + 1 < segment.length) {
      const targetChar = segment[index + 1] ?? "";
      if (!targetQuote && /[\s;&|<>]/.test(targetChar)) break;
      index += 1;
      if (targetQuote) {
        if (targetChar === targetQuote) targetQuote = null;
        else target += targetChar;
        continue;
      }
      if (targetChar === "'" || targetChar === '"') {
        targetQuote = targetChar;
        continue;
      }
      target += targetChar;
    }
    redirects.push({ operator, target });
    commandText += " ";
  }

  return { redirects, commandText: normalizeCommand(commandText) };
}

export function splitShellFallbackSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = (): void => {
    const text = current.trim();
    if (text) {
      segments.push(text);
    }
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "|" && next === "|") {
      pushCurrent();
      index += 1;
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}
