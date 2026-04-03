#!/bin/bash
# layout.sh — ce-hub tmux TUI layout
#
# Layout:
#   ┌──────────────────────────────────────────────────┐
#   │              CC Lead (固定, ~55% height)           │
#   ├────────────────────────┬─────────────────────────┤
#   │     Agent Slot 1       │     Agent Slot 2        │
#   │     (可切换)           │     (可切换)            │
#   └────────────────────────┴─────────────────────────┘
#    [cehub] agents:2/9 | tasks:0 | 5h:441M | $0 | 01:30
#
# Mouse:
#   Click pane → focus | Drag border → resize
#   Right-click agent → switch/add/close/zoom menu
#   Right-click CC Lead → zoom/restart menu
#   Drag-select text → auto-copy to clipboard, selection stays
#   Double-click → select word + copy
#
# Usage:
#   layout.sh                     — 2 agent slots with selector
#   layout.sh <a1> [a2]          — pre-assign agents
#   layout.sh --attach [a1] [a2] — setup + attach
#   layout.sh --reset [a1] [a2]  — kill session and recreate

SESSION="cehub"
CE_HUB_CWD="${CE_HUB_CWD:-$HOME/culinary-engine}"
CE_HUB_DIR="$CE_HUB_CWD/ce-hub"
SCRIPTS="$CE_HUB_DIR/scripts"

GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
DIM='\033[2m'
BOLD='\033[1m'
RST='\033[0m'

start_agent_or_menu() {
  local pane="$1"
  local agent="$2"
  local pane_target="$SESSION:main.${pane}"

  tmux send-keys -t "$pane_target" "export no_proxy=localhost,127.0.0.1" Enter

  if [ -n "$agent" ]; then
    tmux select-pane -t "$pane_target" -T "$agent"
    local agent_file="$CE_HUB_CWD/.claude/agents/${agent}.md"
    local model="sonnet"
    if [ -f "$agent_file" ]; then
      model=$(grep '^model:' "$agent_file" | head -1 | sed 's/^model: *//')
      model="${model:-sonnet}"
    fi
    case "$model" in opus) model="opus" ;; haiku) model="haiku" ;; *) model="sonnet" ;; esac
    local cmd="cd $CE_HUB_CWD && claude --model $model --dangerously-skip-permissions"
    [ -f "$agent_file" ] && cmd="$cmd --agent $agent"
    tmux send-keys -t "$pane_target" "$cmd" Enter
  else
    tmux select-pane -t "$pane_target" -T "agent-slot"
    tmux send-keys -t "$pane_target" "bash $SCRIPTS/agent-select.sh" Enter
  fi
}

setup_session() {
  local agent1="$1"
  local agent2="$2"

  echo -e "${CYAN}Setting up ${BOLD}$SESSION${RST}"

  # Kill old main window
  tmux kill-window -t "$SESSION:main" 2>/dev/null

  # Ensure session
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-session -d -s "$SESSION" -n main -x 200 -y 50 -c "$CE_HUB_CWD"
  else
    tmux new-window -t "$SESSION" -n main -c "$CE_HUB_CWD"
  fi

  # ── Pane 0 (top): CC Lead — ~55% height ──
  tmux send-keys -t "$SESSION:main.0" "export no_proxy=localhost,127.0.0.1" Enter
  tmux send-keys -t "$SESSION:main.0" \
    "cd $CE_HUB_CWD && claude --model opus --dangerously-skip-permissions --agent cc-lead" Enter
  tmux select-pane -t "$SESSION:main.0" -T "cc-lead"

  # ── Pane 1 (bottom-left): Agent Slot 1 — 45% height ──
  tmux split-window -t "$SESSION:main.0" -v -p 45 -c "$CE_HUB_CWD"
  start_agent_or_menu 1 "$agent1"

  # ── Pane 2 (bottom-right): Agent Slot 2 — 50% width of bottom ──
  tmux split-window -t "$SESSION:main.1" -h -p 50 -c "$CE_HUB_CWD"
  start_agent_or_menu 2 "$agent2"

  # Focus CC Lead
  tmux select-pane -t "$SESSION:main.0"

  # Apply mouse bindings + status bar
  bash "$SCRIPTS/mouse-bindings.sh"

  echo -e "${GREEN}Ready!${RST} ${DIM}right-click for menus | drag to resize | drag-select to copy${RST}"
}

# Parse args
DO_ATTACH=false
DO_RESET=false
AGENTS=()

for arg in "$@"; do
  case "$arg" in
    --attach) DO_ATTACH=true ;;
    --reset)  DO_RESET=true ;;
    --help|-h)
      cat <<'HELP'
layout.sh — ce-hub tmux TUI

Layout:
  ┌──────────────────────────────────────┐
  │         CC Lead (固定, 55%)           │
  ├──────────────────┬───────────────────┤
  │   Agent Slot 1   │   Agent Slot 2   │
  └──────────────────┴───────────────────┘

Usage:
  layout.sh                       Interactive agent selection
  layout.sh researcher coder      Pre-assign agents
  layout.sh --attach              Setup + attach
  layout.sh --reset               Fresh start

Mouse:
  Right-click agent pane → switch/zoom/add/close
  Right-click CC Lead    → zoom/restart
  Drag border            → resize
  Drag-select            → copy to clipboard (stays selected)
  Double-click word      → select + copy
HELP
      exit 0 ;;
    -*) ;;
    *) AGENTS+=("$arg") ;;
  esac
done

if $DO_RESET; then
  tmux kill-session -t "$SESSION" 2>/dev/null
fi

setup_session "${AGENTS[0]:-}" "${AGENTS[1]:-}"

if $DO_ATTACH; then
  if [ -n "$TMUX" ]; then
    tmux switch-client -t "$SESSION:main"
  else
    tmux attach -t "$SESSION:main"
  fi
fi
