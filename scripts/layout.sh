#!/bin/bash
# layout.sh — Set up cehub tmux session with TUI layout
#
# Layout:
#   ┌──────────────────────────────────────────────────┐
#   │                                                  │
#   │           CC Lead (固定, ~65% height)             │
#   │                                                  │
#   ├───────────────────────┬──────────────────────────┤
#   │   Dashboard           │   Agent Slot             │
#   │   (实时状态)          │   (右键切换 agent)       │
#   └───────────────────────┴──────────────────────────┘
#   ── status bar: [cehub] Slot: xxx | tasks:N | HH:MM ──
#
# Mouse interactions:
#   - Click any pane to focus
#   - Drag borders to resize
#   - Right-click agent slot → agent switch menu
#   - Right-click dashboard → ops menu
#   - Right-click CC Lead → cc-lead menu
#   - Click status bar right → agent switch menu
#
# Usage:
#   layout.sh                — full setup
#   layout.sh <agent>        — setup with agent pre-selected in slot
#   layout.sh --attach       — setup + attach
#   layout.sh --reset        — kill session and recreate

SESSION="cehub"
CE_HUB_CWD="${CE_HUB_CWD:-$HOME/culinary-engine}"
CE_HUB_DIR="$CE_HUB_CWD/ce-hub"
SCRIPTS="$CE_HUB_DIR/scripts"

BOLD='\033[1m'
GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
DIM='\033[2m'
RST='\033[0m'

SLOT_AGENT="${1:-}"

setup_session() {
  echo -e "${CYAN}Setting up tmux session: ${BOLD}$SESSION${RST}"

  # Kill old main window if exists (preserve other windows like daemon)
  tmux kill-window -t "$SESSION:main" 2>/dev/null

  # Ensure session exists
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-session -d -s "$SESSION" -n main -x 200 -y 50 -c "$CE_HUB_CWD"
    echo -e "  ${GREEN}+ Created session${RST}"
  else
    tmux new-window -t "$SESSION" -n main -c "$CE_HUB_CWD"
    echo -e "  ${GREEN}+ Created main window${RST}"
  fi

  # ── Pane 0 (top): CC Lead — takes ~65% height ──
  tmux send-keys -t "$SESSION:main.0" \
    "export no_proxy=localhost,127.0.0.1" Enter
  tmux send-keys -t "$SESSION:main.0" \
    "cd $CE_HUB_CWD && claude --model opus --dangerously-skip-permissions --agent cc-lead" Enter
  tmux select-pane -t "$SESSION:main.0" -T "cc-lead"

  # ── Split bottom: Pane 1 (bottom-left): Dashboard — 35% height ──
  tmux split-window -t "$SESSION:main.0" -v -p 35 -c "$CE_HUB_CWD"
  tmux send-keys -t "$SESSION:main.1" \
    "export no_proxy=localhost,127.0.0.1 CE_HUB_CWD=$CE_HUB_CWD; python3 $SCRIPTS/dashboard.py" Enter
  tmux select-pane -t "$SESSION:main.1" -T "dashboard"

  # ── Split bottom-right: Pane 2: Agent Slot — 55% width of bottom ──
  tmux split-window -t "$SESSION:main.1" -h -p 55 -c "$CE_HUB_CWD"
  tmux send-keys -t "$SESSION:main.2" \
    "export no_proxy=localhost,127.0.0.1" Enter

  if [ -n "$SLOT_AGENT" ]; then
    # Pre-assign agent
    tmux select-pane -t "$SESSION:main.2" -T "$SLOT_AGENT"
    local agent_file="$CE_HUB_CWD/.claude/agents/${SLOT_AGENT}.md"
    local model="sonnet"
    if [ -f "$agent_file" ]; then
      model=$(grep '^model:' "$agent_file" | head -1 | sed 's/^model: *//')
      model="${model:-sonnet}"
    fi
    case "$model" in
      opus) model="opus" ;;
      haiku) model="haiku" ;;
      *) model="sonnet" ;;
    esac
    local cmd="cd $CE_HUB_CWD && claude --model $model --dangerously-skip-permissions"
    [ -f "$agent_file" ] && cmd="$cmd --agent $SLOT_AGENT"
    tmux send-keys -t "$SESSION:main.2" "$cmd" Enter
  else
    tmux select-pane -t "$SESSION:main.2" -T "agent-slot"
    tmux send-keys -t "$SESSION:main.2" "bash $SCRIPTS/agent-select.sh" Enter
  fi

  # ── Focus CC Lead pane (where user spends most time) ──
  tmux select-pane -t "$SESSION:main.0"

  # ── Apply mouse bindings and visual styling ──
  bash "$SCRIPTS/mouse-bindings.sh"

  echo -e ""
  echo -e "  ${GREEN}Layout ready!${RST}"
  echo -e ""
  echo -e "  ${YELLOW}Mouse controls:${RST}"
  echo -e "    ${DIM}Click pane        → focus${RST}"
  echo -e "    ${DIM}Drag border       → resize${RST}"
  echo -e "    ${DIM}Right-click slot  → switch agent${RST}"
  echo -e "    ${DIM}Right-click dash  → ops menu${RST}"
  echo -e "    ${DIM}Click status bar  → switch agent${RST}"
  echo -e ""
}

# Handle args
case "${1:-}" in
  --reset)
    tmux kill-session -t "$SESSION" 2>/dev/null
    echo -e "${CYAN}Killed old session.${RST}"
    SLOT_AGENT="${2:-}"
    setup_session
    ;;
  --attach)
    SLOT_AGENT="${2:-}"
    setup_session
    if [ -n "$TMUX" ]; then
      tmux switch-client -t "$SESSION:main"
    else
      tmux attach -t "$SESSION:main"
    fi
    ;;
  --help|-h)
    cat <<'HELP'
layout.sh — ce-hub tmux TUI layout

Layout:
  ┌──────────────────────────────────────────┐
  │         CC Lead (固定, 65%)               │
  ├──────────────────┬───────────────────────┤
  │   Dashboard      │   Agent Slot          │
  │   (35%)          │   (右键切换)          │
  └──────────────────┴───────────────────────┘

Usage:
  layout.sh                  Setup with agent selector in slot
  layout.sh <agent>          Setup with agent pre-loaded
  layout.sh --attach         Setup + attach to session
  layout.sh --reset          Kill and recreate from scratch
  layout.sh --help           This help

Examples:
  layout.sh researcher       — slot pre-loaded with researcher
  layout.sh --reset coder    — fresh start with coder in slot
HELP
    ;;
  -*)
    setup_session
    ;;
  *)
    # Positional arg = agent name for slot
    setup_session
    ;;
esac
