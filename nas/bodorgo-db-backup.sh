#!/bin/sh
# Hourly dumps of MongoDB (Bódorgó app) and all PostgreSQL databases
# (Forgejo, Authentik, ...) into /volume2/backups/bodorgo-db, picked up
# from there by Hyper Backup (Backblaze) and the USB backup.
#   hourly/: the last 24 hours (each hour overwrites the same hour yesterday)
#   daily/:  one per day (the 03:00 run), kept for 60 days
set -eu
. /volume2/docker/backup-secrets/bodorgo-backup.env

DEST=/volume2/backups/bodorgo-db
HOUR=$(date +%H)
DAY=$(date +%F)
mkdir -p "$DEST/hourly" "$DEST/daily"

# Written to .tmp first, renamed when complete - a half-written dump never
# looks like a good one.
docker exec mongodb mongodump --quiet \
  --username "$MONGO_BACKUP_USER" --password "$MONGO_BACKUP_PASS" \
  --authenticationDatabase admin --archive --gzip \
  > "$DEST/hourly/mongo-$HOUR.archive.gz.tmp"
mv "$DEST/hourly/mongo-$HOUR.archive.gz.tmp" "$DEST/hourly/mongo-$HOUR.archive.gz"

docker exec PostgreSQL sh -c 'pg_dumpall -U "$POSTGRES_USER"' 2>/dev/null \
  | gzip > "$DEST/hourly/postgres-$HOUR.sql.gz.tmp"
mv "$DEST/hourly/postgres-$HOUR.sql.gz.tmp" "$DEST/hourly/postgres-$HOUR.sql.gz"

if [ "$HOUR" = "03" ]; then
  cp "$DEST/hourly/mongo-$HOUR.archive.gz" "$DEST/daily/mongo-$DAY.archive.gz"
  cp "$DEST/hourly/postgres-$HOUR.sql.gz" "$DEST/daily/postgres-$DAY.sql.gz"
  find "$DEST/daily" -type f -mtime +60 -delete
fi

# Authentik's database once more, on its own: the one the Bódorgó app's
# logins need, in a file that can travel without the other databases
# (Forgejo, ...). No owners or grants in it, so it loads into any new
# Authentik's database, whatever its user is called. pg_dump gzips it
# itself: with no pipe, a failed dump fails this script (and sends the mail).
# Last on purpose - if it fails, the dumps above are already in place.
docker exec PostgreSQL sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges -Z 6 authentik' \
  > "$DEST/hourly/authentik-$HOUR.sql.gz.tmp"
mv "$DEST/hourly/authentik-$HOUR.sql.gz.tmp" "$DEST/hourly/authentik-$HOUR.sql.gz"
if [ "$HOUR" = "03" ]; then
  cp "$DEST/hourly/authentik-$HOUR.sql.gz" "$DEST/daily/authentik-$DAY.sql.gz"
fi
