export type ParsedFunction = {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  bodyHash: string;
};

export function parseTypeScriptFunctions(_source: string, _filePath: string): ParsedFunction[] {
  return [];
}
