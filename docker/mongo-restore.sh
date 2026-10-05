#!/bin/bash
# Run by the mongo image once, the first time it starts with an empty data
# volume (compose.yaml mounts it into /docker-entrypoint-initdb.d): loads
# the database copy found in /dump, if there is one.
#
# The copy is a `mongodump --archive --gzip` file (the NAS's hourly backup
# is one). It may hold several databases: only DUMP_DB is taken, and it is
# loaded as MONGO_DB. Its users and roles are not restored.
#
# The image sources this file into its own start-up script, which stops at
# the first failing command - so nothing here may `exit`, and nothing may
# fail that is not meant to stop the start.

dump=""
for candidate in /dump/*.gz /dump/*.archive; do
  if [ -f "$candidate" ]; then dump="$candidate"; fi
done

if [ -z "$dump" ]; then
  echo "bodorgo: no database copy in /dump - starting with an empty database"
else
  from="${DUMP_DB:-bodorgo}"
  to="${MONGO_DB:-bodorgo}"
  restore_args=(--archive="$dump" --nsInclude="$from.*" --nsFrom="$from.*" --nsTo="$to.*")
  case "$dump" in *.gz) restore_args+=(--gzip) ;; esac
  # Left out: by default the sessions - logins that belong to the old place.
  for collection in ${DUMP_SKIP-sessions}; do
    restore_args+=(--nsExclude="$from.$collection")
  done

  echo "bodorgo: loading $dump ($from -> $to)"
  if mongorestore \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    "${restore_args[@]}"; then
    echo "bodorgo: database copy loaded"
  else
    # The database would otherwise come up empty at the next start, and
    # stay so: the copy is only read into an empty data volume.
    echo "bodorgo: LOADING THE DATABASE COPY FAILED - the database is empty or partial."
    echo "bodorgo: fix the cause, then start over: docker compose down -v && docker compose up -d"
  fi
fi
