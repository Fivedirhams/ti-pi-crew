// Goal wrap functionality - placeholder
// TODO: implement or remove import

export function isGoalWrapEnabled(cwd: string, workflowName: string): boolean {
  return false;
}

export function shouldGoalWrap(cwd: string, workflow: any): boolean {
  return false;
}

export async function startGoalWrappedRun(params: any, ctx: any, workflow: any, goal: string): Promise<any> {
  throw new Error("Goal wrap not implemented");
}
