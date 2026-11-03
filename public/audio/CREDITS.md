# Audio credits

## Thunder (`thunder_*.wav`)

The storm is built from real field recordings, not synthesis. They were imported and
normalised with `scripts/import-thunder-audio.py`; the processing chain only trims dead air
before the strike, removes inaudible sub-sonic rumble, applies a gentle top-end roll-off and
peak-normalises. No pitch shifting, no time stretching, no generated noise.

| file | source | licence |
| --- | --- | --- |
| `thunder_close_1.wav` | [ImmersiveThunder](https://github.com/netcatgirl/ImmersiveThunder) — `thunder_close_1.ogg` | MIT © netcatgirl |
| `thunder_close_2.wav` | ImmersiveThunder — `thunder_close_2.ogg` | MIT © netcatgirl |
| `thunder_close_3.wav` | ImmersiveThunder — `thunder_close_3.ogg` | MIT © netcatgirl |
| `thunder_mid_1.wav` | ImmersiveThunder — `thunder_medium_1.ogg` | MIT © netcatgirl |
| `thunder_mid_2.wav` | ImmersiveThunder — `thunder_medium_2.ogg` | MIT © netcatgirl |
| `thunder_far_1.wav` | ImmersiveThunder — `thunder_far_1.ogg` | MIT © netcatgirl |
| `thunder_far_2.wav` | ImmersiveThunder — `thunder_far_3.ogg` | MIT © netcatgirl |
| `thunder_roll.wav` | [Stargate Sample Pack](https://github.com/stargatedaw/stargate-sample-pack) — `fugue-state-audio/found-sounds/thunder.wav` | CC0 1.0 |

MIT licence text: <https://github.com/netcatgirl/ImmersiveThunder/blob/1.21.6/LICENSE>
CC0 1.0 text: <https://github.com/stargatedaw/stargate-sample-pack/blob/main/LICENSE>

To regenerate (both source downloads are needed):

```bash
python3 scripts/import-thunder-audio.py \
  --immersive <ImmersiveThunder>/common/src/main/resources/assets/immersivethunder/sounds \
  --stargate <stargate-sample-pack>/stargate-sample-pack/fugue-state-audio/found-sounds/thunder.wav \
  --out public/audio
```

## Everything else

The remaining `*.mp3` beds and stingers in this folder are generated assets produced for this
project.
