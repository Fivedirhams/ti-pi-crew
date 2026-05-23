import { formatToolProgress, formatCurrentToolLine } from "./src/runtime/tool-progress.ts";

const progress = {
  recentTools: [{ tool: "bash", args: "ls", endedAt: "2024-01-01T00:00:00.000Z" }],
  toolCount: 1,
  activityState: "active"
};

const display = formatToolProgress(progress);
console.log("currentTool:", display.currentTool);
console.log("toolCount:", display.toolCount);
console.log("TEST PASSED if no errors above");
