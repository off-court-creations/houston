# Bash completion for houston via companion helper binary
_houston()
{
  local cur prev words cword IFS
  _init_completion -n : || return
  # Build suggestions using helper binary; fallback if missing
  if command -v houston-complete >/dev/null 2>&1; then
    local out
    IFS=$'\n' read -d '' -r -a COMPREPLY < <(HOUSTON_NO_INTERACTIVE=1 houston-complete --shell bash --cword "$COMP_CWORD" -- "${COMP_WORDS[@]}" 2>/dev/null && printf '\0')
  else
    COMPREPLY=()
  fi
}

complete -F _houston houston

