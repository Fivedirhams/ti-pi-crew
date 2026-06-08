#!/bin/bash
# Deep review loop for pi-crew - runs every 15 minutes
# Usage: ./run-deep-review-loop.sh &

PI_CREW_PATH="/home/bom/source/my_pi/pi-crew"
WORKFLOW_PATH="/home/bom/.claude/projects/-home-bom-source-my-pi-pi-crew/7f0c2fdb-49fb-45c0-bb20-ccee6f659c73/workflows/scripts/pi-crew-deep-review-loop-wf_eb8cb9f5-2b5.js"
LOG_FILE="/home/bom/.claude/projects/-home-bom-source-my-pi/memory/deep-review-loop.log"

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting deep review loop..." >> "$LOG_FILE"
    
    # Run the workflow using the current Claude Code session
    cd "$PI_CREW_PATH"
    claude --print "(use Workflow tool with scriptPath: '$WORKFLOW_PATH')" 2>&1 >> "$LOG_FILE"
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Review complete. Sleeping 15 minutes..." >> "$LOG_FILE"
    sleep 900
done
