/** 写入类风险：清空文件、写入系统配置和持久化敏感路径。 */
import { getEffectiveCommand, parseOutputRedirects, readShellTokens } from "./shell-syntax.js";

// 写入这些位置可能篡改系统配置、植入持久化或登录凭据，即使是常规写入也必须审批。
export const SENSITIVE_WRITE_PATH_PATTERNS = [
  /^\/+$/,
  /^\/(etc|boot|usr|bin|sbin|lib|lib32|lib64|sys|proc)(\/|$)/,
  /^\/var\/(spool\/cron|lib)(\/|$)/,
  /^\/dev\/(?!(null|stdout|stderr|tty)$)/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.(bashrc|bash_profile|bash_login|bash_logout|profile|zshrc|zprofile|zlogin|zshenv|kshrc|cshrc|tcshrc)$/,
  /(^|\/)\.config\/(autostart|systemd)(\/|$)/,
];

export function isSensitiveWritePath(path: string): boolean {
  const normalized = path.trim();
  return (
    Boolean(normalized) && SENSITIVE_WRITE_PATH_PATTERNS.some(pattern => pattern.test(normalized))
  );
}

export function isEmptyOutputCommand(commandText: string): boolean {
  return /^(|:|true|false|cat \/dev\/null|echo( -[neE]+)*( ''| "")?|printf( ''| "")?)$/.test(
    commandText,
  );
}

export function getNonOptionArguments(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith("-"));
}

export function getOptionValues(args: string[], names: string[]): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    for (const name of names) {
      if (arg === name && args[index + 1]) values.push(args[index + 1]!);
      if (name.startsWith("--") && arg.startsWith(`${name}=`))
        values.push(arg.slice(name.length + 1));
      if (!name.startsWith("--") && arg.startsWith(name) && arg.length > name.length) {
        values.push(arg.slice(name.length));
      }
    }
  });
  return values;
}

/** 返回命令会写入的目标路径，用于识别对系统配置和持久化位置的写入。 */
export function getCommandWriteTargets(commandName: string, args: string[]): string[] {
  switch (commandName) {
    case "tee":
      return getNonOptionArguments(args);
    case "mv":
      // 移动会同时删除源路径，源和目标都需要检查。
      return [
        ...getOptionValues(args, ["-t", "--target-directory"]),
        ...getNonOptionArguments(args),
      ];
    case "cp":
    case "install":
    case "ln":
    case "rsync": {
      const targetDirectories = getOptionValues(args, ["-t", "--target-directory"]);
      const operands = getNonOptionArguments(args);
      return targetDirectories.length > 0 ? targetDirectories : operands.slice(-1);
    }
    case "sed":
      return args.some(arg => /^-[A-Za-z]*i/.test(arg) || arg.startsWith("--in-place"))
        ? getNonOptionArguments(args)
        : [];
    case "curl":
      return getOptionValues(args, ["-o", "--output"]);
    case "wget":
      return getOptionValues(args, ["-O", "--output-document"]);
    case "tar":
      return getOptionValues(args, ["-C", "--directory"]);
    case "unzip":
      return getOptionValues(args, ["-d"]);
    default:
      return [];
  }
}

/**
 * 常规文件写入可以自主执行，但清空文件内容、写入系统配置和持久化位置
 * （/etc、~/.ssh、Shell 启动脚本等）属于删除或提权级别的影响，必须审批。
 */
export function getWriteRiskReason(segment: string): string | null {
  const { redirects, commandText } = parseOutputRedirects(segment);

  for (const redirect of redirects) {
    if (isSensitiveWritePath(redirect.target)) {
      return `写入系统配置或持久化敏感路径：${redirect.target}`;
    }
  }

  const overwritesFile = redirects.some(
    redirect =>
      redirect.operator !== ">>" && !/^\/dev\/(null|stdout|stderr|tty)$/.test(redirect.target),
  );
  if (overwritesFile && isEmptyOutputCommand(commandText)) {
    return "命令会清空文件内容，相当于删除数据";
  }

  const effective = getEffectiveCommand(commandText);
  const args = readShellTokens(effective.normalized)
    .slice(1)
    .map(token => token.value);
  if (effective.commandName === "cp" && getNonOptionArguments(args)[0] === "/dev/null") {
    return "命令会清空文件内容，相当于删除数据";
  }

  const sensitiveTarget = getCommandWriteTargets(effective.commandName, args).find(
    isSensitiveWritePath,
  );
  return sensitiveTarget ? `写入系统配置或持久化敏感路径：${sensitiveTarget}` : null;
}
