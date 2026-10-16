#!/usr/bin/env bash
# Puts the lab matcher's model and runtime files (#102) under public/lab-models/match/, so the lab
# site serves them itself and nothing loads from a CDN at run time. Every file is pinned to an exact
# version or revision and checked against its SHA-256; a file that doesn't match is deleted and the
# script stops. Files already in place with the right hash aren't downloaded again.
#   bash tools/lab/fetch-models.sh
# tools/deploy-lab.sh runs it before every lab deploy. The files are git-ignored (about 38 MB), so
# the public repo never carries them.
#
# What it fetches, and the licenses that allow hosting them:
#   all-MiniLM-L6-v2, quantized ONNX (Xenova/all-MiniLM-L6-v2 at 751bff3)   Apache-2.0
#   @huggingface/transformers 4.3.0, transformers.min.js                      Apache-2.0
#   onnxruntime-web 1.31.0-dev.20260914-8d85527a0, the plain WASM build      MIT
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=public/lab-models/match
REV=751bff37182d3f1213fa05d7196b954e230abad9
HF="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/$REV"
TF="https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0"
ORT="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist"
M="$OUT/models/751bff3/Xenova/all-MiniLM-L6-v2"
V_TF="$OUT/vendor/transformers-4.3.0"
V_ORT="$OUT/vendor/ort-1.31.0-dev.20260914-8d85527a0"

# path | url | sha256
FILES="
$M/config.json|$HF/config.json|7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7
$M/tokenizer.json|$HF/tokenizer.json|da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0
$M/tokenizer_config.json|$HF/tokenizer_config.json|9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3
$M/special_tokens_map.json|$HF/special_tokens_map.json|b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3
$M/onnx/model_quantized.onnx|$HF/onnx/model_quantized.onnx|afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1
$V_TF/transformers.min.js|$TF/dist/transformers.min.js|1475fd440e9932ab206682ee42cb18f6097403e9ee77ea62084c592d0f83597d
$V_TF/LICENSE.txt|$TF/LICENSE|cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
$V_ORT/ort-wasm-simd-threaded.wasm|$ORT/ort-wasm-simd-threaded.wasm|06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3
$V_ORT/ort-wasm-simd-threaded.mjs|$ORT/ort-wasm-simd-threaded.mjs|c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f
"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
fetched=0
while IFS='|' read -r path url want; do
  [ -z "$path" ] && continue
  if [ -f "$path" ] && [ "$(sha "$path")" = "$want" ]; then continue; fi
  mkdir -p "$(dirname "$path")"
  echo "Fetching $path"
  curl -sfL --retry 3 -o "$path.part" "$url"
  got=$(sha "$path.part")
  if [ "$got" != "$want" ]; then rm -f "$path.part"; echo "SHA-256 mismatch for $path (got $got)"; exit 1; fi
  mv "$path.part" "$path"
  fetched=$((fetched + 1))
done <<< "$FILES"

cat > "$OUT/NOTICE.txt" <<'EOF'
Third-party files served by the Paper Trail lab's on-device matcher (#102).

models/751bff3/Xenova/all-MiniLM-L6-v2/
                                  all-MiniLM-L6-v2 by sentence-transformers, ONNX export by Xenova,
                                  revision 751bff37182d3f1213fa05d7196b954e230abad9. Apache License 2.0.
                                  https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
vendor/transformers-4.3.0/        @huggingface/transformers 4.3.0. Apache License 2.0 (LICENSE.txt there).
vendor/ort-1.31.0-dev.20260914-8d85527a0/
                                  onnxruntime-web 1.31.0-dev.20260914-8d85527a0, Copyright (c) Microsoft
                                  Corporation. MIT License. https://github.com/microsoft/onnxruntime/blob/main/LICENSE
EOF
echo "Lab matcher files ready in $OUT ($fetched fetched, $(du -sh "$OUT" | cut -f1) in all)."
