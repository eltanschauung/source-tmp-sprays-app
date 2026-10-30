#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f dist/index.html && -d dist/assets ]]
frontend="/home/kogasa/Kogasatopia-Frontend/priv/static/sprays"
release=$(readlink -f /opt/kogasatopia/current)
[[ "$release" == /opt/kogasatopia/releases/* && -d "$release" ]]
mapfile -t roots < <(find "$release/lib" -maxdepth 3 -type d -path '*/kogasa_frontend-*/priv/static')
[[ ${#roots[@]} -eq 1 ]]
live="${roots[0]}/sprays"
[[ ! -L "$frontend" && ! -L "$live" ]]
mkdir -p "$frontend"
sudo install -d -o root -g kogasa -m 0750 "$live"
# Do not delete old content hashes while visitors may still use the previous index.
rsync -a --exclude index.html dist/ "$frontend/"
sudo rsync -r --chown=root:kogasa --chmod=D750,F640 --exclude index.html dist/ "$live/"
install -m 0644 dist/index.html "$frontend/index.html.next"
mv -f "$frontend/index.html.next" "$frontend/index.html"
sudo install -o root -g kogasa -m 0640 dist/index.html "$live/index.html.next"
sudo mv -f "$live/index.html.next" "$live/index.html"
curl --fail --silent --show-error https://kogasa.tf/sprays/ | grep -q '<title>Source Sprays Collage</title>'
printf 'Published https://kogasa.tf/sprays/\n'
