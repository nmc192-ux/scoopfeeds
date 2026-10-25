#!/bin/bash
# notify-macos.sh MESSAGE - a Mac notification for radio alerts (RADIO_ALERT_CMD). The message is passed as an
# argument to AppleScript, never spliced into the script text.
/usr/bin/osascript - "${1:-ScoopFeeds Radio alert}" <<'AS' >/dev/null 2>&1
on run argv
  display notification (item 1 of argv) with title "ScoopFeeds Radio"
end run
AS
exit 0
