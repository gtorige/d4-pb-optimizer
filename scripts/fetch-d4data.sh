#!/bin/bash
# Fetch all paragon boards from d4data in parallel
BASE="https://raw.githubusercontent.com/DiabloTools/d4data/master/json/base/meta"
CLASSES=("Barb" "Druid" "Necro" "Sorc" "Rogue" "Paladin" "Spirit" "Warlock")
fetch() {
  local url="$1" dest="$2"
  local st=$(curl -sL -o "$dest" -w "%{http_code}" "$url")
  if [ "$st" != "200" ]; then rm -f "$dest"; fi
}
export -f fetch
# Generate list of board filenames
> /tmp/d4d/files.txt
for cls in "${CLASSES[@]}"; do
  for i in 00 01 02 03 04 05 06 07 08 09 0 10; do
    echo "Paragon_${cls}_${i}.pbd.json" >> /tmp/d4d/files.txt
  done
done
wc -l /tmp/d4d/files.txt
# Parallel fetch
xargs -a /tmp/d4d/files.txt -P 16 -I {} bash -c 'fetch "'$BASE'/ParagonBoard/{}" "/tmp/d4d/boards/{}"' 2>&1 | head -5
echo "Boards fetched:"; ls /tmp/d4d/boards/ | wc -l
