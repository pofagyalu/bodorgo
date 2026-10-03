#!/bin/sh
# Tells the CI jobs (.forgejo/workflows/server-tests.yml) which side a pull
# request or a push to main touched, so a client-only change is linted and
# tested only on the client, and a server-only change only on the server.
#
#   sh ci/changed-sides.sh <commit to compare HEAD with>
#
# Writes server=true|false and client=true|false to $GITHUB_OUTPUT. The jobs
# themselves always run (branch protection waits for them by name) - they
# just skip the steps of the side that didn't change.
#
# What belongs where:
#   client/**                       -> client
#   server/**                       -> server
#   server/src/futokor/runRules.*   -> both: the client imports the race
#                                      rules straight from the server
#   .forgejo/**, this script,
#   .prettierrc, .prettierignore    -> both: they decide how both are checked
#   anything else (README, docs…)   -> neither
#
# When in doubt (no commit to compare with, or the comparison fails), both
# sides are checked - never fewer than needed.

base="${1:-}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

report() {
  echo "server=$1" >>"$out"
  echo "client=$2" >>"$out"
  echo "Checking - server: $1, client: $2 ($3)"
  exit 0
}

case "$base" in
  '' | 0000000000000000000000000000000000000000)
    report true true 'nothing to compare with'
    ;;
esac

files=$(git -c safe.directory='*' diff --name-only "$base" HEAD) ||
  report true true "couldn't compare with $base"

server=false
client=false
for file in $files; do
  case "$file" in
    server/src/futokor/runRules.* | .forgejo/* | ci/changed-sides.sh | .prettierrc | .prettierignore)
      server=true
      client=true
      ;;
    client/*) client=true ;;
    server/*) server=true ;;
  esac
done

report "$server" "$client" "compared with $base"
