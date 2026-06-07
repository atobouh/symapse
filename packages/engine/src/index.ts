export type FunctionChange = {
  functionName: string;
  previousHash: string;
  currentHash: string;
};

export function detectChangedFunctions(_previous: Map<string, string>, _current: Map<string, string>): FunctionChange[] {
  return [];
}
