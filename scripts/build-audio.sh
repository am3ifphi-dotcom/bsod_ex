#!/usr/bin/env bash
# Builds the game's audio assets from CC0 sources.
# Source: https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds (CC0)
#         (Kenney, Maximiliano Stradex Ambient, sci-fi packs, Micro Packs)
# Usage: SRC=/path/to/cloned/repo bash scripts/build-audio.sh
set -euo pipefail
SRC=${SRC:-/tmp/audio/repo}
FF=${FF:-node_modules/@ffmpeg-installer/linux-x64/ffmpeg}
OUT=public/audio
mkdir -p $OUT/music $OUT/amb $OUT/sfx

loopify() { # in out seconds
  local in=$1 out=$2 dur=${3:-40} xf=${4:-4}
  $FF -y -hide_banner -loglevel error -i "$in" -filter_complex "
    [0:a]atrim=0:${dur},asetpts=N/SR/TB,asplit=2[main][head];
    [head]atrim=0:${xf},afade=t=out:st=0:d=${xf}[h];
    [0:a]atrim=${dur}:$((dur+xf)),asetpts=N/SR/TB,afade=t=in:st=0:d=${xf}[t];
    [h][t]amix=inputs=2:duration=shortest,volume=2[xt];
    [main]atrim=start=${xf}:end=${dur},asetpts=N/SR/TB[rest];
    [xt][rest]concat=n=2:v=0:a=1[out]" -map "[out]" -ac 2 -c:a libvorbis -q:a 4 "$out"
}

sfx() { # in out [quality]
  $FF -y -hide_banner -loglevel error -i "$1" -ac 2 -c:a libvorbis -q:a ${3:-4} "$2"
}

# ---- music beds ----
loopify "$SRC/Maximiliano-Stradex-Ambient/Ambient_1.mp3" $OUT/music/room.ogg 40 4
loopify "$SRC/Maximiliano-Stradex-Ambient/Theme_1.mp3"   $OUT/music/world.ogg 40 4
loopify "$SRC/Maximiliano-Stradex-Ambient/Ambient_2.mp3" $OUT/music/void.ogg 40 4

# ---- ambience loops ----
sfx "$SRC/30-cc0-sfx-loops/rain.ogg"                       $OUT/amb/rain.ogg 3
sfx "$SRC/sci-fi-sounds/Audio/computerNoise_000.ogg"       $OUT/amb/pc_fan.ogg 3
sfx "$SRC/sci-fi-sounds/Audio/spaceEngineLow_000.ogg"      $OUT/amb/void_drone.ogg 3
sfx "$SRC/30-cc0-sfx-loops/noise_01.ogg"                   $OUT/amb/static.ogg 3
sfx "$SRC/Micro Pack - NazdyNate - Electromagnetic Sounds/NazdyNate -Computer Tower 1.wav" $OUT/amb/tower.ogg 3
sfx "$SRC/Micro Pack - NazdyNate - Electromagnetic Sounds/NazdyNate - EM Room Noise 1.wav" $OUT/amb/room_noise.ogg 3
sfx "$SRC/30-cc0-sfx-loops/ambient_02.ogg"                 $OUT/amb/whisper_bed.ogg 3

# ---- room / UI ----
sfx "$SRC/kenney_interfacesounds/Audio/click_002.ogg"    $OUT/sfx/click.ogg
sfx "$SRC/kenney_interfacesounds/Audio/click_005.ogg"    $OUT/sfx/click_soft.ogg
sfx "$SRC/kenney_interfacesounds/Audio/open_002.ogg"     $OUT/sfx/ui_open.ogg
sfx "$SRC/kenney_interfacesounds/Audio/close_002.ogg"    $OUT/sfx/ui_close.ogg
sfx "$SRC/kenney_interfacesounds/Audio/tick_001.ogg"     $OUT/sfx/ui_tick.ogg
sfx "$SRC/kenney_interfacesounds/Audio/error_004.ogg"    $OUT/sfx/ui_error.ogg
sfx "$SRC/kenney_interfacesounds/Audio/question_001.ogg" $OUT/sfx/ui_deny.ogg
sfx "$SRC/kenney_interfacesounds/Audio/switch_002.ogg"   $OUT/sfx/switch.ogg

# ---- glitch ----
sfx "$SRC/kenney_interfacesounds/Audio/glitch_001.ogg"   $OUT/sfx/glitch1.ogg
sfx "$SRC/kenney_interfacesounds/Audio/glitch_002.ogg"   $OUT/sfx/glitch2.ogg
sfx "$SRC/kenney_interfacesounds/Audio/glitch_004.ogg"   $OUT/sfx/glitch3.ogg
sfx "$SRC/kenney_digitalaudio/Audio/phaseJump2.ogg"      $OUT/sfx/glitch4.ogg
sfx "$SRC/kenney_digitalaudio/Audio/zap1.ogg"            $OUT/sfx/zap.ogg
sfx "$SRC/kenney_digitalaudio/Audio/lowDown.ogg"         $OUT/sfx/lowdown.ogg
sfx "$SRC/kenney_digitalaudio/Audio/powerUp4.ogg"        $OUT/sfx/powerup.ogg
sfx "$SRC/30-cc0-weird-sfx/weird_03.ogg"                 $OUT/sfx/weird.ogg
sfx "$SRC/30-cc0-weird-sfx/weird_11.ogg"                 $OUT/sfx/weird2.ogg

# ---- movement / impacts ----
for i in 1 2 3; do
  sfx "$SRC/kenney_impactsounds/Audio/footstep_carpet_00$((i-1)).ogg" $OUT/sfx/step_carpet$i.ogg 3
  sfx "$SRC/kenney_impactsounds/Audio/footstep_wood_00$((i-1)).ogg"   $OUT/sfx/step_wood$i.ogg 3
  sfx "$SRC/kenney_impactsounds/Audio/footstep_concrete_00$((i-1)).ogg" $OUT/sfx/step_concrete$i.ogg 3
done
sfx "$SRC/kenney_impactsounds/Audio/impactSoft_heavy_001.ogg"  $OUT/sfx/impact_soft.ogg
sfx "$SRC/kenney_impactsounds/Audio/impactPlate_heavy_001.ogg" $OUT/sfx/impact_plate.ogg
sfx "$SRC/kenney_impactsounds/Audio/impactGlass_heavy_001.ogg" $OUT/sfx/impact_glass.ogg
sfx "$SRC/sci-fi-sounds/Audio/lowFrequency_explosion_000.ogg"  $OUT/sfx/sub_drop.ogg
sfx "$SRC/75-cc0-breaking-falling-hit-sfx/bfh1_rock_breaking_01.ogg" $OUT/sfx/rock_break.ogg
sfx "$SRC/75-cc0-breaking-falling-hit-sfx/bfh1_rock_breaking_03.ogg" $OUT/sfx/rock_break2.ogg
sfx "$SRC/75-cc0-breaking-falling-hit-sfx/bfh1_rock_falling_02.ogg"  $OUT/sfx/rock_fall.ogg
sfx "$SRC/75-cc0-breaking-falling-hit-sfx/bfh1_glass_breaking_02.ogg" $OUT/sfx/glass_break.ogg

# ---- whooshes / transitions ----
sfx "$SRC/Micro Pack - Organic Wooshes/Swish 1.wav" "$OUT/sfx/whoosh1.ogg" 6
sfx "$SRC/Micro Pack - Organic Wooshes/Slash.wav"   "$OUT/sfx/whoosh2.ogg" 6
sfx "$SRC/Micro Pack - Organic Wooshes/Combo 2.wav" "$OUT/sfx/whoosh3.ogg" 6
sfx "$SRC/Micro Pack - Organic Wooshes/Twirl 1.wav" "$OUT/sfx/whoosh4.ogg" 6

echo "audio built:"; du -sh $OUT; find $OUT -type f | wc -l
