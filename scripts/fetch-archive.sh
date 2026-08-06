#!/bin/sh
#
# Download one monthly archive from Sensor.Community, in parallel parts.
#
# Usage: scripts/fetch-archive.sh <dir> <YYYY-MM> <sensor-type> [parts]
#
# The archive serves about 0.3 MB/s down a single connection, which makes the 3.3 GB SDS011 file a
# three-hour download. It honours range requests, and ten of them in parallel bring that to roughly
# ten minutes. The parts are concatenated rather than written in place because `curl -C` cannot
# resume into the middle of a file.
#
# Already have the file? Nothing happens. That is what makes this safe to rerun after a dropped
# connection, and why the parts carry a leading dot — a half-finished download must never look like
# a finished one to `make backfill`.
set -eu

DIR="$1"
MONTH="$2"
TYPE="$3"
PARTS="${4:-8}"

URL="https://archive.sensor.community/csv_per_month/${MONTH}/${MONTH}_${TYPE}.zip"
OUT="${DIR}/${MONTH}_${TYPE}.zip"

if [ -f "$OUT" ]; then
  echo "have ${MONTH}_${TYPE}.zip"
  exit 0
fi

mkdir -p "$DIR"

LEN=$(curl -sI --max-time 30 "$URL" | tr -d '\r' | awk '/[Cc]ontent-[Ll]ength/{print $2}')
if [ -z "${LEN:-}" ] || [ "$LEN" -lt 1000 ] 2>/dev/null; then
  # Not every hardware type is published every month — sps30 has no July file at all. Say so and
  # carry on rather than failing the whole fetch.
  echo "skip ${MONTH}_${TYPE}: not in the archive"
  exit 0
fi

echo "${MONTH}_${TYPE}: $((LEN / 1048576)) MB in ${PARTS} parts"
CHUNK=$(( (LEN + PARTS - 1) / PARTS ))

i=0
while [ "$i" -lt "$PARTS" ]; do
  START=$(( i * CHUNK ))
  END=$(( START + CHUNK - 1 ))
  [ "$END" -ge "$LEN" ] && END=$(( LEN - 1 ))
  curl -s --retry 5 --retry-delay 3 --max-time 7200 -r "${START}-${END}" "$URL" \
    -o "${DIR}/.${MONTH}_${TYPE}.part${i}" &
  i=$(( i + 1 ))
done
wait

i=0
: > "${DIR}/.${MONTH}_${TYPE}.joined"
while [ "$i" -lt "$PARTS" ]; do
  cat "${DIR}/.${MONTH}_${TYPE}.part${i}" >> "${DIR}/.${MONTH}_${TYPE}.joined"
  i=$(( i + 1 ))
done
rm -f "${DIR}/.${MONTH}_${TYPE}".part*

GOT=$(wc -c < "${DIR}/.${MONTH}_${TYPE}.joined" | tr -d ' ')
if [ "$GOT" != "$LEN" ]; then
  rm -f "${DIR}/.${MONTH}_${TYPE}.joined"
  echo "${MONTH}_${TYPE}: got ${GOT} of ${LEN} bytes — refusing a short file" >&2
  exit 1
fi

mv "${DIR}/.${MONTH}_${TYPE}.joined" "$OUT"
echo "${MONTH}_${TYPE}: done, $((GOT / 1048576)) MB"
