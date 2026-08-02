import os, json

base = os.path.join(os.environ["APPDATA"], "audio-playground", "Local Storage", "leveldb")
data = b""
for name in sorted(os.listdir(base)):
    path = os.path.join(base, name)
    if os.path.isfile(path) and (name.endswith(".ldb") or name.endswith(".log")):
        with open(path, "rb") as f:
            data += f.read()

idx = data.find(b'"name":"IceKing"')
print("idx", idx)
start = data.rfind(b'{"id":', max(0, idx - 80), idx)
print("start", start)

i = start
depth = 0
end = None
in_str = False
esc = False
quote = ord('"')
bslash = ord("\\")
while i < len(data):
    c = data[i]
    if in_str:
        if esc:
            esc = False
        elif c == bslash:
            esc = True
        elif c == quote:
            in_str = False
    else:
        if c == quote:
            in_str = True
        elif c == ord("{"):
            depth += 1
        elif c == ord("}"):
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    i += 1

raw = data[start:end].decode("utf-8", errors="replace")
obj = json.loads(raw)
patch = obj["patch"]
keys = [
    "drive", "crush", "driveMode", "filterDrive", "filterResonance", "filterCutoff",
    "filterModel", "filterType", "delayFeedback", "delayMix", "delayFreeze", "delayFbDrive",
    "delayMode", "punch", "glueMakeup", "glueOutGain", "glueUseAdvanced", "glueMode",
    "reverbMix", "reverbFreeze", "phaserFeedback", "phaserMix", "chorusMix",
    "masterGain", "unison", "unisonDetune", "oscALevel", "oscBLevel", "oscCLevel",
    "subLevel", "noiseLevel", "fmAmount", "fmFeedback", "fmEngine", "warpMode", "warpAmount",
    "spectralMode", "spectralMix", "ampAttack", "ampRelease", "mono", "hardSync",
    "chipAcidMix", "ringAmount", "stereoWidth", "filterEnvAmount", "filterEnvResoAmount",
]
print("name", obj["name"], "id", obj["id"])
for k in keys:
    if k in patch:
        print(f"  {k}: {patch[k]}")

hots = []
skip = {
    "filterCutoff", "tone", "reverbSize", "reverbHighCut", "ringFreq",
    "lfo1Rate", "lfo2Rate", "delayTime", "fmOp2Ratio", "fmOp3Ratio", "fmOp4Ratio",
    "reverbDiffusion", "oscAPos", "oscBPos", "oscCPos",
}
for k, v in patch.items():
    if isinstance(v, (int, float)) and abs(v) > 0.7 and k not in skip:
        hots.append((k, v))
print("HOT (>0.7):")
for k, v in sorted(hots, key=lambda x: -abs(x[1]))[:50]:
    print(f"  {k}: {v}")

out = os.path.join(
    r"C:\Users\Zero\Desktop\Sony_Project\audio-playground",
    "scripts",
    "iceking-dump.json",
)
with open(out, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2)
print("wrote", out)
