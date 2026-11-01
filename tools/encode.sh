#!/usr/bin/env bash
# Usage: bash encode.sh frames_dir audio.wav out.mp4 [fps]
#   frames_dir : directory with f_00000.jpg, f_00001.jpg, ... (from capture.js)
#   audio.wav  : soundtrack (any format ffmpeg reads)
#   out.mp4    : output (H.264 high@yuv420p + AAC 192k, +faststart)
#   fps        : frame rate of the frame sequence (default 30)
# Output is trimmed to the shorter of video / audio (-shortest).
set -euo pipefail

if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: bash $0 frames_dir audio.wav out.mp4 [fps]" >&2
  exit 2
fi
FRAMES=${1%/}
AUDIO=$2
OUT=$3
FPS=${4:-30}

[ -d "$FRAMES" ]   || { echo "encode.sh: frames dir not found: $FRAMES" >&2; exit 1; }
[ -f "$AUDIO" ]    || { echo "encode.sh: audio not found: $AUDIO" >&2; exit 1; }
[ -f "$FRAMES/f_00000.jpg" ] || { echo "encode.sh: $FRAMES/f_00000.jpg missing (expected f_%05d.jpg sequence)" >&2; exit 1; }

NFRAMES=$(find "$FRAMES" -maxdepth 1 -name 'f_*.jpg' | wc -l)
echo "encode.sh: $NFRAMES frames @ ${FPS} fps (~$(awk -v n="$NFRAMES" -v f="$FPS" 'BEGIN{printf "%.2f", n/f}') s) + $AUDIO"

# Chromium screenshots are full-range BT.601 JPEG (JFIF); convert to limited-range BT.709 and tag it.
# Width/height are rounded down to even for yuv420p.
VF="scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p"

ffmpeg -hide_banner -loglevel error -stats -y \
  -framerate "$FPS" -start_number 0 -i "$FRAMES/f_%05d.jpg" \
  -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -vf "$VF" -r "$FPS" -fps_mode cfr \
  -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 192k -ar 48000 \
  -shortest -movflags +faststart \
  "$OUT"

echo "encode.sh: wrote $OUT"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames \
  -of default=nw=1 "$OUT" || true
