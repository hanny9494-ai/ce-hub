#!/bin/bash
# mouse-bindings.sh — Configure tmux mouse bindings for ce-hub TUI
#
# Pane layout:
#   pane 0: CC Lead (top)
#   pane 1: Dashboard (bottom-left)
#   pane 2: Agent Slot (bottom-right)

CE_HUB_CWD="${CE_HUB_CWD:-$HOME/culinary-engine}"
SCRIPTS="$CE_HUB_CWD/ce-hub/scripts"
AGENTS_DIR="${CE_HUB_CWD}/.claude/agents"
SESSION="cehub"
CONF_FILE="/tmp/cehub-mouse.conf"

apply_bindings() {
  echo "Applying mouse bindings to session: $SESSION"

  # Generate a .conf file and source it — avoids shell quoting issues with { }
  cat > "$CONF_FILE" <<TMUXCONF
# ce-hub mouse bindings (auto-generated)
set-option -g mouse on

# Right-click on any pane → context-aware menu via handler script
bind-key -T root MouseDown3Pane {
  select-pane -t=
  run-shell -b "bash ${SCRIPTS}/right-click-handler.sh '#{pane_title}' '#{pane_id}'"
}

# Left-click on status right → agent switch menu
bind-key -T root MouseDown1StatusRight run-shell -b "bash ${SCRIPTS}/right-click-handler.sh 'agent-slot' ''"

# Pane border titles
set-option pane-border-status top
set-option pane-border-format " #{?pane_active,#[fg=colour214 bold],#[fg=colour245 dim]}#{pane_title}#[default] "
set-option pane-border-style "fg=colour238"
set-option pane-active-border-style "fg=colour214"

# Status bar style
set-option status-style "bg=colour235,fg=colour245"
set-option status-interval 5
set-option status-left-length 20
set-option status-right-length 80
set-option status-left "#[fg=colour214,bold] [cehub] #[fg=colour245,nobold]"
TMUXCONF

  # Status-right needs shell expansion for SCRIPTS path, so set via tmux command
  tmux source-file "$CONF_FILE" 2>&1

  # Status bar right (dynamic: task count + slot name + time)
  local status_right
  status_right="#[fg=colour245]tasks:#(curl -s --noproxy localhost http://localhost:8750/api/health 2>/dev/null | python3 -c \"import sys,json;print(json.load(sys.stdin).get('taskCount',0))\" 2>/dev/null || echo '?') "
  status_right+="#[fg=colour250]| #[fg=colour117,bold]Slot: #(tmux display-message -p -t ${SESSION}:main.2 '#{pane_title}' 2>/dev/null || echo 'none') "
  status_right+="#[fg=colour245,nobold]| %H:%M "

  tmux set-option status-right "$status_right" 2>/dev/null

  echo "Mouse bindings applied."
}

build_agent_menu_cmd() {
  local menu_items=""
  local i=1
  for f in "$AGENTS_DIR"/*.md; do
    [ -f "$f" ] || continue
    local name
    name=$(basename "$f" .md)
    [[ "$name" == _* ]] && continue
    [[ "$name" == "cc-lead" ]] && continue
    menu_items="$menu_items \"$i. $name\" $i \"run-shell -b 'bash $SCRIPTS/switch-agent.sh $name'\""
    i=$((i + 1))
  done
  echo "display-menu -T '#[bold]Switch Agent' -x R -y S $menu_items"
}

case "${1:-}" in
  --menu)
    build_agent_menu_cmd
    ;;
  *)
    apply_bindings
    ;;
esac
