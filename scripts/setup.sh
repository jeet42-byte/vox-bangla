#!/usr/bin/env bash
# One-time setup: python deps, the offline Bangla TTS model, textures.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m pip install -q -r requirements.txt

MODEL=vits-coqui-bn-custom_female
if [ ! -f "models/$MODEL/model.onnx" ]; then
  mkdir -p models
  echo "downloading Bangla TTS model (~108 MB)…"
  curl -fL -o "models/$MODEL.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$MODEL.tar.bz2"
  tar -xjf "models/$MODEL.tar.bz2" -C models && rm "models/$MODEL.tar.bz2"
fi

python3 engine/textures.py
command -v ffmpeg >/dev/null || echo "!! install ffmpeg (apt install ffmpeg / brew install ffmpeg)"
node -e "require('playwright')" 2>/dev/null || echo "!! install playwright: npm i -g playwright && npx playwright install chromium"
echo "setup done"
