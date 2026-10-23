import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * The words a source file shows: its string literals, its template strings and the text between JSX tags — and not its
 * comments, its identifiers or its imports. What a test about the product's wording has to read; a regular expression
 * over the file would read the comments too, and the comments say things like "Añadir" to explain why a label changed.
 */
export type Copy = { text: string; line: number };

export function copyOf(path: string): Copy[] {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Copy[] = [];
  const add = (node: ts.Node, text: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed) found.push({ text: trimmed, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
  };
  const visit = (node: ts.Node) => {
    // An import's path is not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) add(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));
    else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Every `.ts` and `.tsx` file under a path, or the path itself when it is one. */
export function sourcesUnder(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = join(path, name);
    if (statSync(full).isDirectory()) return sourcesUnder(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}
