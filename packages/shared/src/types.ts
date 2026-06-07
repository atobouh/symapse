export type FunctionRecord = {
  id: number;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  bodyHash: string;
  updatedAt: string;
};

export type ImpactResult = {
  sourceFunction: string;
  impactedFunctions: string[];
  impactedFiles: string[];
};
