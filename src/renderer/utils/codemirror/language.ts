import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";
import { getFileExtension } from "../format";

export function getFileEditorLanguageExtension(fileName: string): Extension {
  const lowerName = fileName.toLowerCase();
  const extension = getFileExtension(lowerName);

  if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension)) {
    return javascript({ jsx: extension === ".jsx" });
  }

  if ([".ts", ".tsx"].includes(extension)) {
    return javascript({ typescript: true, jsx: extension === ".tsx" });
  }

  if ([".json", ".jsonc"].includes(extension)) {
    return json();
  }

  if ([".html", ".htm", ".vue", ".svelte"].includes(extension)) {
    return html();
  }

  if ([".css", ".scss", ".sass", ".less"].includes(extension)) {
    if (extension === ".scss") {
      return sass();
    }

    if (extension === ".sass") {
      return sass({ indented: true });
    }

    return css();
  }

  if ([".md", ".markdown"].includes(extension)) {
    return markdown();
  }

  if (extension === ".py") {
    return python();
  }

  if ([".java", ".kt", ".kts"].includes(extension)) {
    return java();
  }

  if ([".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".cs"].includes(extension)) {
    return cpp();
  }

  if (extension === ".go") {
    return go();
  }

  if (extension === ".rs") {
    return rust();
  }

  if (extension === ".php") {
    return php();
  }

  if (extension === ".rb") {
    return StreamLanguage.define(ruby);
  }

  if (extension === ".swift") {
    return StreamLanguage.define(swift);
  }

  if (extension === ".lua") {
    return StreamLanguage.define(lua);
  }

  if (extension === ".pl") {
    return StreamLanguage.define(perl);
  }

  if (extension === ".r") {
    return StreamLanguage.define(r);
  }

  if ([".sh", ".bash", ".zsh", ".fish", ".bat", ".cmd"].includes(extension)) {
    return StreamLanguage.define(shell);
  }

  if (extension === ".ps1") {
    return StreamLanguage.define(powerShell);
  }

  if (extension === ".sql") {
    return sql();
  }

  if ([".yaml", ".yml"].includes(extension)) {
    return yaml();
  }

  if (extension === ".xml") {
    return xml();
  }

  if ([".toml"].includes(extension)) {
    return StreamLanguage.define(toml);
  }

  if (extension === ".properties") {
    return StreamLanguage.define(properties);
  }

  if (lowerName === "dockerfile" || lowerName.endsWith(".dockerfile")) {
    return StreamLanguage.define(dockerFile);
  }

  if (lowerName === "cmakelists.txt") {
    return StreamLanguage.define(cmake);
  }

  return [];
}
