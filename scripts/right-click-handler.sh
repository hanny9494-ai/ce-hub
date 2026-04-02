#!/bin/bash
# right-click-handler.sh — Context-aware right-click menu for ce-hub TUI
#
# Usage (called by tmux binding):
#   right-click-handler.sh <pane_title> <pane_id>

CE_HUB_CWD="${CE_HUB_CWD:-$HOME/culinary-engine}"
SCRIPTS="$CE_HUB_CWD/ce-hub/scripts"
AGENTS_DIR="${CE_HUB_CWD}/.claude/agents"
SESSION="cehub"

PANE_TITLE="$1"
PANE_ID="$2"

# Get pane index reliably
PANE_INDEX=""
if [ -n "$PANE_ID" ]; then
  PANE_INDEX=$(tmux display-message -p -t "$PANE_ID" '#{pane_index}' 2>/dev/null)
fi

show_agent_menu() {
  # Build agent menu items dynamically
  # Include: switch options, separator, close pane, add new pane
  local items=()

  # List all agents (except cc-lead which is fixed)
  for f in "$AGENTS_DIR"/*.md; do
    [ -f "$f" ] || continue
    local name
    name=$(basename "$f" .md)
    [[ "$name" == _* ]] && continue
    [[ "$name" == "cc-lead" ]] && continue

    # Check if this agent is already running in some pane
    local running=""
    if tmux list-panes -t "$SESSION:main" -F '#{pane_title}' 2>/dev/null | grep -qx "$name"; then
      running=" [LIVE]"
    fi

    items+=("${name}${running}" "" "run-shell -b 'bash $SCRIPTS/pane-manager.sh switch \"$PANE_ID\" \"$name\"'")
  done

  # Separator + management options
  items+=("" "" "")
  items+=("#[fg=colour117]+ Add Agent Pane" "a" "run-shell -b 'bash $SCRIPTS/pane-manager.sh add'")
  items+=("#[fg=colour196]x Close This Pane" "x" "run-shell -b 'bash $SCRIPTS/pane-manager.sh close \"$PANE_ID\"'")
  items+=("" "" "")
  items+=("Cancel" "" "")

  tmux display-menu -T "#[bold,fg=colour214]  Switch Agent" -x P -y P "${items[@]}"
}

show_dashboard_menu() {
  tmux display-menu -T "#[bold,fg=colour117]  Dashboard" -x P -y P \
    "#[fg=colour117]+ Add Agent Pane"  a  "run-shell -b 'bash $SCRIPTS/pane-manager.sh add'" \
    ""                    "" "" \
    "View Costs"          c  "run-shell -b 'tmux display-popup -E -w 60 -h 20 \"curl -s --noproxy localhost http://localhost:8750/api/costs 2>/dev/null | python3 -m json.tool\"'" \
    "View Tasks"          t  "run-shell -b 'tmux display-popup -E -w 70 -h 25 \"curl -s --noproxy localhost http://localhost:8750/api/tasks 2>/dev/null | python3 -m json.tool\"'" \
    "System Health"       h  "run-shell -b 'tmux display-popup -E -w 60 -h 20 \"curl -s --noproxy localhost http://localhost:8750/api/health 2>/dev/null | python3 -m json.tool\"'" \
    "Agent Panes"         l  "run-shell -b 'tmux display-popup -E -w 60 -h 15 \"bash $SCRIPTS/pane-manager.sh list\"'" \
    ""                    "" "" \
    "Cancel"              "" ""
}

show_cclead_menu() {
  tmux display-menu -T "#[bold,fg=colour214]  CC Lead" -x P -y P \
    "Zoom (fullscreen)"   z  "resize-pane -t $SESSION:main.0 -Z" \
    ""                    "" "" \
    "#[fg=colour117]+ Add Agent Pane"  a  "run-shell -b 'bash $SCRIPTS/pane-manager.sh add'" \
    ""                    "" "" \
    "Restart CC Lead"     r  "send-keys -t $SESSION:main.0 C-c ; run-shell -b 'sleep 1 && tmux send-keys -t $SESSION:main.0 \"cd $CE_HUB_CWD && claude --model opus --dangerously-skip-permissions --agent cc-lead\" Enter'" \
    ""                    "" "" \
    "Cancel"              "" ""
}

# Dispatch based on pane index (most reliable) then fallback to title
case "$PANE_INDEX" in
  0)
    show_cclead_menu
    ;;
  1)
    show_dashboard_menu
    ;;
  *)
    # Pane 2+ are agent slots
    show_agent_menu
    ;;
esac
