import os
import subprocess
import urllib.parse
import wave
import struct
import lameenc

os.makedirs("public/audio", exist_ok=True)
os.makedirs("/tmp/bsod_audio_raw", exist_ok=True)

def wav_bytes_to_mp3(wav_path, mp3_path, max_seconds=None, bitrate=144):
    with wave.open(wav_path, "rb") as wf:
        nch = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        if max_seconds is not None:
            nframes = min(nframes, int(framerate * max_seconds))
        raw = wf.readframes(nframes)

    # Convert 24-bit or 8-bit or 32-bit PCM to 16-bit signed PCM if needed
    if sampwidth == 2:
        pcm16 = raw
    elif sampwidth == 1:
        # unsigned 8-bit -> signed 16-bit
        samples = [((b - 128) << 8) for b in raw]
        pcm16 = struct.pack(f"<{len(samples)}h", *samples)
    elif sampwidth == 3:
        # 24-bit little-endian -> take upper 16 bits
        out = bytearray((len(raw) // 3) * 2)
        j = 0
        for i in range(0, len(raw) - 2, 3):
            out[j] = raw[i + 1]
            out[j + 1] = raw[i + 2]
            j += 2
        pcm16 = bytes(out)
    elif sampwidth == 4:
        # Assume 32-bit int or float; inspect wave format fallback to upper 16 bits
        out = bytearray((len(raw) // 4) * 2)
        j = 0
        for i in range(0, len(raw) - 3, 4):
            out[j] = raw[i + 2]
            out[j + 1] = raw[i + 3]
            j += 2
        pcm16 = bytes(out)
    else:
        raise ValueError(f"Unsupported sampwidth {sampwidth} in {wav_path}")

    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(framerate)
    enc.set_channels(min(nch, 2))
    enc.set_quality(2)
    if nch > 2:
        # take first 2 channels
        frame_bytes = 2 * nch
        stereo = bytearray()
        for i in range(0, len(pcm16), frame_bytes):
            stereo.extend(pcm16[i:i+4])
        pcm16 = bytes(stereo)

    mp3_data = enc.encode(pcm16) + enc.flush()
    with open(mp3_path, "wb") as f:
        f.write(mp3_data)

def download_gh_raw(repo, repo_path, dest_raw):
    encoded_path = "/".join(urllib.parse.quote(seg, safe="") for seg in repo_path.split("/"))
    api_path = f"repos/{repo}/contents/{encoded_path}"
    with open(dest_raw, "wb") as out:
        subprocess.run(
            ["gh", "api", "-H", "Accept: application/vnd.github.raw", api_path],
            stdout=out,
            check=True,
        )

ASSETS = [
    # (out_name, repo, repo_path, max_sec)
    ("room_tone.mp3", "Chambrse/ZombiePrototype", "sounds/Environment/Suburb Ext Distant Traffic Loop.wav", 24.0),
    ("pc_fan_hum.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/House & Office/Home or Office/Air conditioning_Running.mp3", None),
    ("clock_tick.mp3", "Vulcania/gamepathy2026", "sounds/sfx/animatic_sfx/animatic_clock.wav", 8.0),
    ("footstep_wood.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/Character/Footsteps_walking_wood_loop.mp3", None),
    ("creak_room.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/House & Office/Home or Office/Creak.mp3", None),
    ("ui_hover.mp3", "Chambrse/ZombiePrototype", "sounds/UI & Menus/Hover Over.wav", None),
    ("mouse_click.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/House & Office/Home or Office/Switch_clicking.mp3", None),
    ("glitch_short.mp3", "FireEntity1/n-u-l-l", "audio/sfx/glitch.mp3", None),
    ("monitor_glitch.mp3", "Vulcania/gamepathy2026", "sounds/sfx/level_sfx/monitor_glitch.wav", 12.0),
    ("pain_glitch.mp3", "Chambrse/ZombiePrototype", "sounds/Horror/Pain Glitch.wav", None),
    ("reality_rift.mp3", "Chambrse/ZombiePrototype", "sounds/Horror/Reality Rift.wav", None),
    ("static_elec.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/Ambient/Static_electrical.mp3", None),
    ("horror_riser.mp3", "Chambrse/ZombiePrototype", "sounds/Motions and Impacts/Riser Distorted Wave.wav", None),
    ("wormhole_suck.mp3", "Chambrse/ZombiePrototype", "sounds/Sci-Fi/Wormhole Drive.wav", None),
    ("gasp.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/Character/Gasp.mp3", None),
    ("breathing_panic.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/Character/Breathing_fast.mp3", None),
    ("bgm_glitch_world.mp3", "Chambrse/ZombiePrototype", "sounds/Environment/Dreamscape Loop.wav", 32.0),
    ("bgm_dread_drone.mp3", "CahyoAditya/Deadline-Slayer-The-Ilham-Effect", "Sound Effects/Ambient/Ambience_haunting.mp3", None),
    ("core_scanner.mp3", "Chambrse/ZombiePrototype", "sounds/Sci-Fi/Matrix Flow Loop.wav", 16.0),
    ("anomaly_tremor.mp3", "Chambrse/ZombiePrototype", "sounds/Horror/Metallic Trembling.wav", 10.0),
    ("console_error.mp3", "Chambrse/ZombiePrototype", "sounds/UI & Menus/Error.wav", None),
    ("earthquake.mp3", "Chambrse/ZombiePrototype", "sounds/Hollywood/Earthquake Loop.wav", 10.0),
    ("shatter.mp3", "Chambrse/ZombiePrototype", "sounds/Hollywood/Metal Glass Destruction.wav", None),
    ("fall_wind.mp3", "Chambrse/ZombiePrototype", "sounds/Horror/Wind Of Rotting.wav", None),
    ("land_impact.mp3", "Chambrse/ZombiePrototype", "sounds/Motions and Impacts/Impact Redwood.wav", None),
    ("aftermath_piano.mp3", "Chambrse/ZombiePrototype", "sounds/Horror/Bleak Moon Piano.wav", None),
]

for out_name, repo, repo_path, max_sec in ASSETS:
    out_path = os.path.join("public/audio", out_name)
    ext = os.path.splitext(repo_path)[1].lower()
    raw_tmp = os.path.join("/tmp/bsod_audio_raw", out_name + ext)
    download_gh_raw(repo, repo_path, raw_tmp)
    if ext == ".wav":
        try:
            wav_bytes_to_mp3(raw_tmp, out_path, max_seconds=max_sec, bitrate=144)
        except Exception as e:
            print(f"  Note on {out_name}: {e} -> checking wave header")
            raise
    else:
        with open(raw_tmp, "rb") as src, open(out_path, "wb") as dst:
            dst.write(src.read())
    sz_kb = os.path.getsize(out_path) / 1024.0
    print(f"OK {out_name:22s} <- {repo.split('/')[1]} ({sz_kb:6.1f} KB)")

# Also convert Google Drive key-press-1..4.wav to MP3!
for idx in range(1, 5):
    src_wav = f"google_drive/key-press-{idx}.wav"
    out_mp3 = f"public/audio/key{idx}.mp3"
    wav_bytes_to_mp3(src_wav, out_mp3, bitrate=128)
    print(f"OK key{idx}.mp3               <- google_drive ({os.path.getsize(out_mp3)/1024:.1f} KB)")
